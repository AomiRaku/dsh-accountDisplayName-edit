/**
 * Robustness verification: the plugin must degrade to "no alias, no extra row"
 * when the shipped DOM is not what it expects, and must never throw into the
 * shell's plugin loader.
 *
 * Each scenario gets a fresh jsdom, a fresh copy of the bundle closure, and a
 * fresh stub context.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const CLIENT = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const SOURCE = fs.readFileSync(CLIENT, 'utf8');
const require = createRequire(import.meta.url);
const React = require('react');

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` -> ${detail}`}`);
  }
}

const LAUNCHER = (labelSpan) => `
<div class="ET65mq_root">
  <span class="Menu_root ET65mq_anchor">
    <button type="button" class="ET65mq_trigger" aria-label="菜单" aria-haspopup="menu"
            aria-expanded="false" data-collapsed="false" data-signed-out="false">
      <span class="ET65mq_avatar"></span>${labelSpan}
    </button>
  </span>
</div>`;

const MENU_ROWS = `
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"><svg class="gear"></svg></span><span class="Menu_itemLabel">设置</span></button></div>
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"><svg class="logout"></svg></span><span class="Menu_itemLabel">退出登录</span></button></div>`;

const MENU = `
<div class="MenuSurface_surface Menu_list Menu_portal" role="menu" data-menu-material="translucent">
  <div aria-hidden="true" class="MenuSurface_material"></div>
  <div class="Menu_viewport" role="presentation">${MENU_ROWS}</div>
</div>`;

/** Build a fresh world, load the bundle into it, and hand back a driver. */
function scenario(bodyHtml, options = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://127.0.0.1:19387/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'KeyboardEvent', 'MouseEvent', 'Element', 'HTMLElement', 'Node']) {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: window.requestAnimationFrame.bind(window),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: window.cancelAnimationFrame.bind(window),
    configurable: true,
    writable: true,
  });

  let captured = null;
  window.__ModuleLoader__ = { load: (entry) => { captured = entry; } };
  window.eval(SOURCE);

  if (options.alias !== undefined) window.localStorage.setItem('dsh.account-display-name-edit.alias', options.alias);

  const slots = [];
  const disposers = [];
  const warnings = [];
  let applied = false;
  const ctx = {
    get: (name) => (name === 'locale' ? { getLocale: () => ({ id: options.locale ?? 'zh-CN' }) } : undefined),
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
    slots: {
      inject: (_key, callback) => callback(),
      register: (definition, component) => { slots.push({ definition, component }); return () => {}; },
    },
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return () => {}; },
  };

  const frames = async (count) => {
    for (let i = 0; i < count; i += 1) await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return {
    dom,
    window,
    document: window.document,
    ctx,
    slots,
    disposers,
    warnings,
    frames,
    get applied() { return applied; },
    apply() {
      applied = true;
      captured.factory((specifier) => {
        if (specifier === 'react') return React;
        throw new Error(`unexpected require(${specifier})`);
      }).apply(ctx);
    },
    openMenu() {
      const trigger = window.document.querySelector('button[aria-haspopup="menu"]');
      trigger.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
      trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      const host = window.document.createElement('div');
      host.innerHTML = MENU;
      const menu = host.firstElementChild;
      window.document.body.appendChild(menu);
      return menu;
    },
  };
}

// ---------------------------------------------------------------------------
console.log('\n== S1: the shipped account launcher is gone');
{
  const world = scenario('<div id="app"><span>unrelated</span></div>', { alias: 'Alice' });
  let threw = null;
  try {
    world.apply();
  } catch (error) {
    threw = error;
  }
  check('apply() does not throw', threw === null, String(threw));
  check('still registers the overlay slot', world.slots.length === 1);
  await world.frames(3);
  check('injects no row', world.document.querySelector('[data-dsh-accountdisplayname-edit-row]') === null);
  check('warns nothing (nothing is wrong)', world.warnings.length === 0, world.warnings.join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n== S2: the label span lost its `_label` class');
{
  const world = scenario(LAUNCHER('<span class="ET65mq_who">181******40</span>'), { alias: 'Alice' });
  world.apply();
  await world.frames(3);
  check('positional fallback still finds the label', world.document.querySelector('.ET65mq_who').textContent === 'Alice', world.document.querySelector('.ET65mq_who').textContent);
}

// ---------------------------------------------------------------------------
console.log('\n== S3: collapsed rail (avatar is the only span)');
{
  const world = scenario(LAUNCHER(''), { alias: 'Alice' });
  world.apply();
  await world.frames(3);
  const avatar = world.document.querySelector('.ET65mq_avatar');
  check('the avatar span is never used as the label', avatar.textContent === '', JSON.stringify(avatar.textContent));
}

// ---------------------------------------------------------------------------
console.log('\n== S4: English locale');
{
  const world = scenario(LAUNCHER('<span class="ET65mq_label">181******40</span>'), { alias: 'Alice', locale: 'en-US' });
  world.apply();
  await world.frames(2);
  const menu = world.openMenu();
  await world.frames(4);
  const row = menu.querySelector('[data-dsh-accountdisplayname-edit-row]');
  check('row label follows the locale', row?.querySelector('[class*="_itemLabel"]')?.textContent === 'Edit display name', row?.querySelector('[class*="_itemLabel"]')?.textContent);
}

// ---------------------------------------------------------------------------
console.log('\n== S5: the menu renders before its rows exist');
{
  const world = scenario(LAUNCHER('<span class="ET65mq_label">181******40</span>'), { alias: 'Alice' });
  world.apply();
  await world.frames(2);

  const trigger = world.document.querySelector('button[aria-haspopup="menu"]');
  trigger.dispatchEvent(new world.window.MouseEvent('pointerdown', { bubbles: true }));
  trigger.dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  const host = world.document.createElement('div');
  host.innerHTML = `
<div class="MenuSurface_surface Menu_list Menu_portal" role="menu" data-menu-material="translucent">
  <div aria-hidden="true" class="MenuSurface_material"></div>
  <div class="Menu_viewport" role="presentation"></div>
</div>`;
  const menu = host.firstElementChild;
  world.document.body.appendChild(menu);
  await world.frames(30);
  check('empty menu is left alone', menu.querySelector('[data-dsh-accountdisplayname-edit-row]') === null && menu.querySelectorAll('[role="menuitem"]').length === 0);

  // React fills the rows in: the row must appear without another launcher click.
  menu.querySelector('[role="presentation"]').innerHTML = MENU_ROWS;
  await world.frames(4);
  const row = menu.querySelector('[data-dsh-accountdisplayname-edit-row]');
  check('row appears once the rows render', row !== null);
  check('row is placed after the first shipped row', menu.querySelectorAll('[role="presentation"] > *')[1] === row);
}

// ---------------------------------------------------------------------------
console.log('\n== S6: no document body to mount into');
{
  const world = scenario('<div id="app"></div>', { alias: 'Alice' });
  const realDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    value: { body: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    configurable: true,
    writable: true,
  });
  let threw = null;
  try {
    world.apply();
  } catch (error) {
    threw = error;
  }
  Object.defineProperty(globalThis, 'document', { value: realDocument, configurable: true, writable: true });
  check('apply() does not throw', threw === null, String(threw));
  check('a diagnostic warning is logged', world.warnings.length === 1 && world.warnings[0].includes('no document body'), world.warnings.join(' | '));
  check('the overlay slot is still registered', world.slots.length === 1);
}

// ---------------------------------------------------------------------------
console.log('\n== S7: the account span is replaced by a React remount');
{
  const world = scenario(LAUNCHER('<span class="ET65mq_label">181******40</span>'), { alias: 'Alice' });
  world.apply();
  await world.frames(2);
  check('alias applied initially', world.document.querySelector('.ET65mq_label').textContent === 'Alice');

  // React swaps the whole span for a new element carrying the shipped text.
  const old = world.document.querySelector('.ET65mq_label');
  const fresh = world.document.createElement('span');
  fresh.className = 'ET65mq_label';
  fresh.textContent = '181******40';
  old.parentElement.replaceChild(fresh, old);
  await world.frames(4);
  check('alias re-applied to the new span', world.document.querySelector('.ET65mq_label').textContent === 'Alice', world.document.querySelector('.ET65mq_label').textContent);
}

// ---------------------------------------------------------------------------
console.log('\n== S8: disposal on a changed DOM');
{
  const world = scenario(LAUNCHER('<span class="ET65mq_label">181******40</span>'), { alias: 'Alice' });
  world.apply();
  await world.frames(2);
  // Remove the launcher entirely, then dispose: this must not throw.
  world.document.querySelector('.ET65mq_root').remove();
  let threw = null;
  try {
    for (const dispose of world.disposers) dispose();
  } catch (error) {
    threw = error;
  }
  check('dispose() does not throw after the launcher is gone', threw === null, String(threw));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('failed checks:');
  for (const name of failures) console.log(` - ${name}`);
  process.exitCode = 1;
}
