/**
 * Edge-case / bug-hunt suite: the behaviours that only show up when things go
 * wrong — a failure path, a teardown racing an in-flight timer, and a re-enable
 * after a disable. Each check asserts the behaviour the plugin *should* have.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const CLIENT = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const require = createRequire(import.meta.url);

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
const section = (t) => console.log(`\n== ${t}`);

const ALIAS_KEY = 'dsh.account-display-name-edit.alias';
const AVATAR_KEY = 'dsh.account-display-name-edit.avatar';
const ROW_ATTR = 'data-dsh-accountdisplayname-edit-row';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const LAUNCHER = `
<div class="ET65mq_root">
  <span class="Menu_root ET65mq_anchor">
    <button type="button" class="ET65mq_trigger" aria-label="菜单" aria-haspopup="menu"
            aria-expanded="false" data-collapsed="false" data-signed-out="false">
      <span class="ET65mq_avatar"><span class="inner">A</span></span>
      <span class="ET65mq_label">181******40</span>
    </button>
  </span>
</div>`;

const MENU_HTML = `
<div class="MenuSurface_surface Menu_list Menu_portal" role="menu">
  <div aria-hidden="true" class="MenuSurface_material"></div>
  <div class="Menu_viewport" role="presentation">
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"></span><span class="Menu_itemLabel">设置</span></button></div>
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"></span><span class="Menu_itemLabel">退出登录</span></button></div>
  </div>
</div>`;

let React;
let ReactDOMClient;
let act;
function ensureReact() {
  if (React !== undefined) return;
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  act = React.act ?? require('react-dom/test-utils').act;
}

function boot(bodyHtml, seed) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url: 'http://127.0.0.1:19387/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'KeyboardEvent', 'MouseEvent', 'Element', 'HTMLElement', 'Node', 'Image', 'FileReader']) {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: window.requestAnimationFrame.bind(window), configurable: true, writable: true });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: window.cancelAnimationFrame.bind(window), configurable: true, writable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ensureReact();
  for (const [k, v] of Object.entries(seed ?? {})) window.localStorage.setItem(k, v);

  let captured = null;
  window.__ModuleLoader__ = { load: (entry) => { captured = entry; } };
  window.eval(fs.readFileSync(CLIENT, 'utf8'));
  const moduleExports = captured.factory((s) => {
    if (s === 'react') return require('react');
    throw new Error(`unexpected require(${s})`);
  });

  const slots = [];
  const disposers = [];
  const ctx = {
    get: (name) => (name === 'locale' ? { getLocale: () => ({ id: 'zh-CN' }) } : undefined),
    logger: { warn: () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (def, component) => { slots.push({ def, component }); return () => {}; },
    },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return () => {}; },
  };

  const frames = async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => window.requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 0));
  };

  return {
    window,
    document: window.document,
    slots,
    frames,
    moduleExports,
    apply: () => moduleExports.apply(ctx),
    dispose: () => { for (const d of disposers) d(); },
  };
}

const labelOf = (doc) => doc.querySelector('span[class*="_label"]');
const mountOverlay = async (world, index) => {
  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  let root = null;
  await act(async () => {
    root = ReactDOMClient.createRoot(host);
    root.render(React.createElement(world.slots[index ?? 0].component));
  });
  return { host, root };
};
const appendMenu = (world) => {
  const holder = world.document.createElement('div');
  holder.innerHTML = MENU_HTML;
  const menu = holder.firstElementChild;
  world.document.body.appendChild(menu);
  return menu;
};
const pressLauncher = (world) => {
  const trigger = world.document.querySelector('button[aria-haspopup="menu"]');
  trigger.dispatchEvent(new world.window.MouseEvent('pointerdown', { bubbles: true }));
  trigger.dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
};
const openEditor = async (world, host) => {
  pressLauncher(world);
  const menu = appendMenu(world);
  await world.frames(4);
  const row = menu.querySelector(`[${ROW_ATTR}]`);
  if (row === null) return null;
  await act(async () => {
    row.querySelector('button[role="menuitem"]').dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(2);
  return host.querySelector('[role="dialog"]');
};

// ---------------------------------------------------------------------------
section('teardown must stop the in-flight menu poll');
{
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice' });
  world.apply();
  await world.frames(2);

  pressLauncher(world); // starts the rAF poll; no menu exists yet
  world.dispose(); // plugin disabled before the menu appears
  const menu = appendMenu(world);
  await world.frames(30);

  check('no row is injected after disposal', menu.querySelector(`[${ROW_ATTR}]`) === null);
}

// ---------------------------------------------------------------------------
section('a re-enable must not resurrect the dialog');
{
  const world = boot(LAUNCHER, {});
  world.apply();
  await world.frames(2);

  const first = await mountOverlay(world, 0);
  const dialog = await openEditor(world, first.host);
  check('dialog opened before disabling', dialog !== null);

  world.dispose();
  await act(async () => {
    first.root.unmount(); // the shell tears the slot entry down with the plugin
  });

  world.apply();
  await world.frames(2);
  const second = await mountOverlay(world, 1);
  await world.frames(2);
  check('re-enabled plugin starts closed', second.host.querySelector('[role="dialog"]') === null);
}

// ---------------------------------------------------------------------------
section('a name that cannot be persisted must not pretend it was');
{
  const world = boot(LAUNCHER, {});
  world.apply();
  await world.frames(2);

  // Replace the page's storage wholesale with one that refuses exactly the name
  // key, so the readback/apply path is exercised against a real failure.
  const backing = new Map();
  Object.defineProperty(world.window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => {
        if (key === ALIAS_KEY) throw new Error('QuotaExceededError');
        backing.set(key, value);
      },
      removeItem: (key) => {
        backing.delete(key);
      },
      key: (index) => Array.from(backing.keys())[index] ?? null,
      get length() {
        return backing.size;
      },
    },
  });

  const overlay = await mountOverlay(world, 0);
  const dialog = await openEditor(world, overlay.host);
  const input = dialog.querySelector('input[type="text"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(world.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '新名字');
    input.dispatchEvent(new world.window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    [...overlay.host.querySelectorAll('button')].find((b) => b.textContent === '保存')
      .dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(2);

  check('the sidebar label is not changed', labelOf(world.document).textContent === '181******40', labelOf(world.document).textContent);
  check('the dialog stays open and reports the failure', overlay.host.querySelector('[role="alert"]') !== null);
}

// ---------------------------------------------------------------------------
section('collapse, sign-out and resume');
{
  // Alias set while the rail is collapsed: there is only an avatar span.
  const world = boot(
    `<div class="ET65mq_root"><span class="Menu_root ET65mq_anchor">
       <button type="button" aria-label="菜单" aria-haspopup="menu" data-collapsed="true" data-signed-out="false">
         <span class="ET65mq_avatar"><span class="inner">A</span></span>
       </button></span></div>`,
    { [ALIAS_KEY]: 'Alice', [AVATAR_KEY]: PNG }
  );
  world.apply();
  await world.frames(3);
  check('avatar applies on the collapsed rail', world.document.querySelector('span[class*="_avatar"]').getAttribute('data-dsh-accountdisplayname-edit-avatar') === '1');
  check('no label node is invented on the collapsed rail', world.document.querySelector('span[class*="_label"]') === null);

  // The rail expands: the label span appears and must pick the alias up.
  const label = world.document.createElement('span');
  label.className = 'ET65mq_label';
  label.textContent = '181******40';
  world.document.querySelector('button[aria-haspopup="menu"]').appendChild(label);
  await world.frames(4);
  check('alias applies once the label span appears', label.textContent === 'Alice', label.textContent);
}

// ---------------------------------------------------------------------------
section('double teardown and re-apply');
{
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice' });
  world.apply();
  await world.frames(2);
  let threw = null;
  try {
    world.dispose();
    world.dispose();
  } catch (error) {
    threw = error;
  }
  check('disposing twice does not throw', threw === null, String(threw));

  threw = null;
  try {
    world.apply();
  } catch (error) {
    threw = error;
  }
  await world.frames(2);
  check('re-applying after disposal does not throw', threw === null, String(threw));
  check('alias is applied again after re-apply', labelOf(world.document).textContent === 'Alice', labelOf(world.document).textContent);
  const tags = world.document.querySelectorAll('style[data-dsh-accountdisplayname-edit-style]');
  check('exactly one scoped stylesheet after re-apply', tags.length === 1, String(tags.length));
}

// ---------------------------------------------------------------------------
section('the dialog contains the keyboard and never overflows');
{
  const world = boot(LAUNCHER, {});
  world.apply();
  await world.frames(2);

  const overlay = await mountOverlay(world, 0);
  const dialog = await openEditor(world, overlay.host);
  check('dialog opened', dialog !== null);

  check(
    'the card scrolls instead of overflowing a short window',
    dialog.style.maxHeight === '100%' && dialog.style.overflowY === 'auto',
    `${dialog.style.maxHeight} / ${dialog.style.overflowY}`
  );

  const fileInput = dialog.querySelector('input[type="file"]');
  const controls = [...dialog.querySelectorAll('button, input')].filter((el) => !el.disabled && el.tabIndex >= 0);
  check('the hidden file input is out of the tab order', !controls.includes(fileInput));

  const first = controls[0];
  const last = controls[controls.length - 1];

  last.focus();
  world.document.dispatchEvent(new world.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  check('Tab on the last control wraps to the first', world.document.activeElement === first);

  first.focus();
  world.document.dispatchEvent(new world.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  check('Shift+Tab on the first control wraps to the last', world.document.activeElement === last);
}

// ---------------------------------------------------------------------------
section('opening the menu stays off the whole-document hot path');
{
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice' });
  world.apply();
  await world.frames(2);

  // Grab the launcher before the spy goes in: the harness's own lookup must not be
  // counted as the plugin's work.
  const launcher = world.document.querySelector('button[aria-haspopup="menu"]');

  // From here on, count document-wide queries. The launcher is cached and the menu is
  // looked up among <body>'s children, so opening the menu must not scan the document
  // — the previous implementation scanned it on every click and every frame.
  const doc = world.document;
  let wideQueries = 0;
  const originalQS = doc.querySelector.bind(doc);
  const originalQSA = doc.querySelectorAll.bind(doc);
  Object.defineProperty(doc, 'querySelector', {
    configurable: true,
    writable: true,
    value: function (...args) { wideQueries += 1; return originalQS(...args); },
  });
  Object.defineProperty(doc, 'querySelectorAll', {
    configurable: true,
    writable: true,
    value: function (...args) { wideQueries += 1; return originalQSA(...args); },
  });
  doc.querySelector('body');
  check('the query spy is live', wideQueries === 1, String(wideQueries));
  wideQueries = 0;

  launcher.dispatchEvent(new world.window.MouseEvent('pointerdown', { bubbles: true }));
  launcher.dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  const menu = appendMenu(world);
  // Flush microtasks only, with no animation frame: the observer must have injected.
  await Promise.resolve();
  await Promise.resolve();
  check('the menu opens with its shipped frame untouched (no row yet)', menu.querySelector(`[${ROW_ATTR}]`) === null);
  await world.frames(2);
  check('the row lands on a later frame', menu.querySelector(`[${ROW_ATTR}]`) !== null);
  check('opening the menu performs no document-wide query', wideQueries === 0, String(wideQueries));

  await world.frames(3);
  check('exactly one injected row after settling', menu.querySelectorAll(`[${ROW_ATTR}]`).length === 1);
}

// ---------------------------------------------------------------------------
section('a launcher re-render must not flash the shipped value');
{
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice', [AVATAR_KEY]: PNG });
  world.apply();
  await world.frames(3);

  const doc = world.document;
  const AVATAR_ATTR = 'data-dsh-accountdisplayname-edit-avatar';
  const oldAvatar = doc.querySelector('span[class*="_avatar"]');
  const freshAvatar = oldAvatar.cloneNode(false); // same classes, no children
  // cloneNode copies attributes too; a React re-creation would not carry ours.
  freshAvatar.removeAttribute(AVATAR_ATTR);
  freshAvatar.style.backgroundImage = '';
  oldAvatar.parentElement.replaceChild(freshAvatar, oldAvatar);

  // Microtasks only: no animation frame may be needed to repaint it.
  await Promise.resolve();
  await Promise.resolve();
  check(
    'a replaced avatar span is repainted before the next frame',
    freshAvatar.getAttribute(AVATAR_ATTR) === '1' && String(freshAvatar.style.backgroundImage).includes('data:image/png'),
    `${freshAvatar.getAttribute(AVATAR_ATTR)} / ${String(freshAvatar.style.backgroundImage).slice(0, 40)}`
  );

  const oldLabel = doc.querySelector('span[class*="_label"]');
  const freshLabel = oldLabel.cloneNode(false);
  freshLabel.textContent = '181******40';
  oldLabel.parentElement.replaceChild(freshLabel, oldLabel);
  await Promise.resolve();
  await Promise.resolve();
  check('a replaced label span takes the alias before the next frame', freshLabel.textContent === 'Alice', freshLabel.textContent);
}

// ---------------------------------------------------------------------------
section('a replaced launcher button must not flash either');
{
  const AVATAR_ATTR = 'data-dsh-accountdisplayname-edit-avatar';
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice', [AVATAR_KEY]: PNG });
  world.apply();
  await world.frames(3);
  const doc = world.document;

  // React can replace the whole button, which takes our trigger observer with it.
  const oldButton = doc.querySelector('button[aria-haspopup="menu"]');
  const freshButton = oldButton.cloneNode(false);
  const freshAvatar = doc.createElement('span');
  freshAvatar.className = 'ET65mq_avatar';
  freshAvatar.innerHTML = '<span class="inner">A</span>';
  const nextLabel = doc.createElement('span');
  nextLabel.className = 'ET65mq_label';
  nextLabel.textContent = '181******40';
  freshButton.appendChild(freshAvatar);
  freshButton.appendChild(nextLabel);
  oldButton.parentElement.replaceChild(freshButton, oldButton);

  // Microtasks only: the body observer must repaint without waiting for a frame.
  await Promise.resolve();
  await Promise.resolve();
  check('alias is repainted on a replaced launcher before the next frame', nextLabel.textContent === 'Alice', nextLabel.textContent);
  check(
    'avatar is repainted on a replaced launcher before the next frame',
    freshAvatar.getAttribute(AVATAR_ATTR) === '1' && String(freshAvatar.style.backgroundImage).includes('data:image/png'),
    String(freshAvatar.getAttribute(AVATAR_ATTR))
  );

  // The trigger observer must have been re-attached to the new button.
  nextLabel.textContent = '181******40';
  await world.frames(2);
  check('the re-attached observer still guards the new button', nextLabel.textContent === 'Alice', nextLabel.textContent);
}

// ---------------------------------------------------------------------------
section('a row dropped by a menu re-render is restored before the next frame');
{
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice' });
  world.apply();
  await world.frames(2);
  pressLauncher(world);
  const menu = appendMenu(world);
  await world.frames(2);
  const injected = menu.querySelector(`[${ROW_ATTR}]`);
  check('row injected once the menu has painted', injected !== null);

  // React re-renders the list and our node is gone; only the open menu is observed,
  // so this must come back without waiting for a frame.
  injected.remove();
  await Promise.resolve();
  await Promise.resolve();
  check('row restored before the next frame', menu.querySelectorAll(`[${ROW_ATTR}]`).length === 1);
}

// ---------------------------------------------------------------------------
section('the menu is asked to re-place before it paints');
{
  const world = boot(LAUNCHER, { [ALIAS_KEY]: 'Alice' });
  world.apply();
  await world.frames(2);

  let resizes = 0;
  const original = world.window.dispatchEvent.bind(world.window);
  Object.defineProperty(world.window, 'dispatchEvent', {
    configurable: true,
    writable: true,
    value: function (event) {
      if (event != null && event.type === 'resize') resizes += 1;
      return original(event);
    },
  });

  pressLauncher(world);
  const menu = appendMenu(world);
  await Promise.resolve();
  await Promise.resolve();
  check('a resize nudge is sent the moment the menu appears', resizes >= 1, String(resizes));

  await world.frames(2);
  check('inserting the row nudges placement again, in the same frame', resizes >= 2, String(resizes));
  check('the row is still there afterwards', menu.querySelectorAll(`[${ROW_ATTR}]`).length === 1);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('failed checks:');
  for (const n of failures) console.log(` - ${n}`);
  process.exitCode = 1;
}
