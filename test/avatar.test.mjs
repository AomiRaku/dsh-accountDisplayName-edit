/**
 * Real-DOM verification of the avatar half: the launcher's avatar span is
 * repainted from a stored image, the editor dialog exposes the picker, and
 * clearing hands the real avatar back.
 *
 * jsdom has no 2D canvas and never decodes images, so picking a *file* cannot be
 * exercised here; what is asserted is everything around it — persistence,
 * application, the scoped stylesheet, the draft/commit semantics, and disposal.
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
const section = (title) => console.log(`\n== ${title}`);

const LANE = 'dsh.account-display-name-edit.alias';
const AVATAR = 'dsh.account-display-name-edit.avatar';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const AVATAR_ATTR = 'data-dsh-accountdisplayname-edit-avatar';

const LAUNCHER = `
<div class="ET65mq_root">
  <span class="Menu_root ET65mq_anchor">
    <button type="button" class="ET65mq_trigger" aria-label="菜单" aria-haspopup="menu"
            aria-expanded="false" data-collapsed="false" data-signed-out="false">
      <span class="ET65mq_avatar"><span class="account-avatar-inner">A</span></span>
      <span class="ET65mq_label">181******40</span>
    </button>
  </span>
</div>`;

const MENU = `
<div class="MenuSurface_surface Menu_list Menu_portal" role="menu" data-menu-material="translucent">
  <div aria-hidden="true" class="MenuSurface_material"></div>
  <div class="Menu_viewport" role="presentation">
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"></span><span class="Menu_itemLabel">设置</span></button></div>
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"></span><span class="Menu_itemLabel">退出登录</span></button></div>
  </div>
</div>`;

// react-dom decides once, at load time, whether a DOM exists. Loading it before
// the first jsdom sends it down the legacy IE value-change polyfill, which then
// throws inside focus(); so it is initialised only after boot() published globals.
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

  for (const [key, value] of Object.entries(seed ?? {})) window.localStorage.setItem(key, value);

  let captured = null;
  window.__ModuleLoader__ = { load: (entry) => { captured = entry; } };
  window.eval(fs.readFileSync(CLIENT, 'utf8'));

  const slots = [];
  const disposers = [];
  const ctx = {
    get: (name) => (name === 'locale' ? { getLocale: () => ({ id: 'zh-CN' }) } : undefined),
    logger: { warn: () => {} },
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
    window,
    document: window.document,
    slots,
    disposers,
    frames,
    apply: () => captured.factory((s) => { if (s === 'react') return require('react'); throw new Error(`unexpected require(${s})`); }).apply(ctx),
  };
}

const avatarSpan = (doc) => doc.querySelector('span[class*="_avatar"]');
const backgroundOf = (el) => String(el.style.backgroundImage || '');

async function openEditor(world, host) {
  const trigger = world.document.querySelector('button[aria-haspopup="menu"]');
  trigger.dispatchEvent(new world.window.MouseEvent('pointerdown', { bubbles: true }));
  trigger.dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  const menuHost = world.document.createElement('div');
  menuHost.innerHTML = MENU;
  const menu = menuHost.firstElementChild;
  world.document.body.appendChild(menu);
  await world.frames(4);
  const row = menu.querySelector('[data-dsh-accountdisplayname-edit-row]');
  if (row === null) return null;
  await act(async () => {
    row.querySelector('button[role="menuitem"]').dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(2);
  return host.querySelector('[role="dialog"]');
}

// ---------------------------------------------------------------------------
section('a stored avatar is painted on the launcher');
{
  const world = boot(LAUNCHER, { [AVATAR]: PNG, [LANE]: 'Alice' });
  world.apply();
  await world.frames(3);

  const span = avatarSpan(world.document);
  check('launcher avatar carries the marker attribute', span.getAttribute(AVATAR_ATTR) === '1', span.getAttribute(AVATAR_ATTR));
  check('launcher avatar shows the stored image', backgroundOf(span).includes('data:image/png'), backgroundOf(span).slice(0, 60));
  check('the real avatar element is left in the tree', span.querySelector('.account-avatar-inner') !== null);

  const style = world.document.querySelector('style[data-dsh-accountdisplayname-edit-style]');
  check('a scoped stylesheet is installed', style !== null);
  check('the stylesheet hides the real avatar child', (style?.textContent ?? '').includes('[data-dsh-accountdisplayname-edit-avatar="1"]>*{display:none'));
  check('the stylesheet sizes the background image', (style?.textContent ?? '').includes('background-size:cover'));

  // The commit path must not fight a later account re-render.
  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  let root = null;
  await act(async () => {
    root = ReactDOMClient.createRoot(host);
    root.render(React.createElement(world.slots[0].component));
  });
  check('overlay registers a component', typeof world.slots[0]?.component === 'function');

  // ------------------------------------------------------------- the dialog
  section('the dialog offers the avatar controls');
  const dialog = await openEditor(world, host);
  check('dialog opens', dialog !== null);
  check('dialog is titled 编辑名称与头像', dialog?.getAttribute('aria-label') === '编辑名称与头像', dialog?.getAttribute('aria-label'));

  const fileInput = dialog?.querySelector('input[type="file"]');
  check('dialog has a file input', fileInput !== null);
  check('the file input accepts images', (fileInput?.getAttribute('accept') ?? '').includes('image/'), fileInput?.getAttribute('accept'));
  check('the file input is visually hidden', fileInput?.style.display === 'none', fileInput?.style.display);

  const buttons = dialog === null ? [] : [...dialog.querySelectorAll('button')];
  const label = (text) => buttons.find((b) => b.textContent === text);
  check('dialog has 选择图片…', label('选择图片…') !== undefined);
  check('dialog has 清除头像', label('清除头像') !== undefined);

  const preview = dialog?.querySelector('[data-dsh-avatar-preview]');
  check('preview starts from the stored avatar', preview?.getAttribute('data-dsh-avatar-preview') === 'set', preview?.getAttribute('data-dsh-avatar-preview'));
  check('preview paints the stored image', String(preview?.style.backgroundImage ?? '').includes('data:image/png'), preview?.style.backgroundImage);

  // -------------------------------------------------- clearing is draft-only
  section('clearing is a draft until Save');
  await act(async () => {
    label('清除头像').dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(1);
  const clearedPreview = host.querySelector('[data-dsh-avatar-preview]');
  check('preview empties immediately', clearedPreview?.getAttribute('data-dsh-avatar-preview') === 'empty');
  check('storage is untouched before Save', world.window.localStorage.getItem(AVATAR) === PNG);
  check('launcher image survives until Save', backgroundOf(avatarSpan(world.document)).includes('data:image/png'));

  await act(async () => {
    [...host.querySelectorAll('button')].find((b) => b.textContent === '保存').dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(2);
  check('saving clears the stored avatar', world.window.localStorage.getItem(AVATAR) === null, String(world.window.localStorage.getItem(AVATAR)));
  check('launcher avatar marker removed', avatarSpan(world.document).getAttribute(AVATAR_ATTR) === null);
  check('launcher background image cleared', backgroundOf(avatarSpan(world.document)) === '', backgroundOf(avatarSpan(world.document)));
  check('dialog closed after saving', host.querySelector('[role="dialog"]') === null);

  // -------------------------------------------------------------- teardown
  section('disposal');
  await act(async () => {
    world.window.localStorage.setItem(AVATAR, PNG);
    for (const dispose of world.disposers) dispose();
  });
  check('scoped stylesheet removed on dispose', world.document.querySelector('style[data-dsh-accountdisplayname-edit-style]') === null);
}

// ---------------------------------------------------------------------------
section('a launcher without an avatar span (signed out)');
{
  const world = boot(
    `<div class="ET65mq_root"><span class="Menu_root ET65mq_anchor">
       <button type="button" aria-label="菜单" aria-haspopup="menu" data-collapsed="false" data-signed-out="true">
         <svg class="ellipsis"></svg>
       </button></span></div>`,
    { [AVATAR]: PNG }
  );
  let threw = null;
  try {
    world.apply();
  } catch (error) {
    threw = error;
  }
  await world.frames(3);
  check('apply() does not throw', threw === null, String(threw));
  check('no avatar marker is placed on a non-avatar element', world.document.querySelector(`[${AVATAR_ATTR}]`) === null);
}

// ---------------------------------------------------------------------------
section('a corrupted stored value is ignored');
{
  const world = boot(LAUNCHER, { [AVATAR]: 'not-a-data-url' });
  world.apply();
  await world.frames(3);
  const span = avatarSpan(world.document);
  check('a non-image value is not applied', span.getAttribute(AVATAR_ATTR) === null, span.getAttribute(AVATAR_ATTR));
  check('no background image is painted', backgroundOf(span) === '');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('failed checks:');
  for (const name of failures) console.log(` - ${name}`);
  process.exitCode = 1;
}
