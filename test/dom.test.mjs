/**
 * Real-DOM verification of dsh-accountdisplayname-edit's browser half.
 *
 * Loads lib/client.js exactly the way the shell does (through
 * window.__ModuleLoader__.load), runs it against a fixture that reproduces the
 * shipped AccountMenu + Menu markup and CSS-module class naming, and asserts the
 * observable behaviour: label override, label restore, menu-row injection, the
 * row's activation path, the editor dialog round-trip, and disposal.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const CLIENT = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- assertions
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
function section(title) {
  console.log(`\n== ${title}`);
}

// -------------------------------------------------------------------- fixture
const LAUNCHER = `
<div class="ET65mq_root">
  <span class="Menu_root ET65mq_anchor">
    <button type="button" class="ET65mq_trigger" aria-label="菜单" aria-haspopup="menu"
            aria-expanded="false" data-collapsed="false" data-signed-out="false">
      <span class="ET65mq_avatar"></span>
      <span class="ET65mq_label">181******40</span>
    </button>
  </span>
</div>`;

const MENU = `
<div class="MenuSurface_surface Menu_list Menu_portal" role="menu" data-menu-material="translucent">
  <div aria-hidden="true" class="MenuSurface_material"></div>
  <div class="Menu_viewport" role="presentation">
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item" aria-keyshortcuts="Control+,"><span class="Menu_itemIcon"><svg class="gear"></svg></span><span class="Menu_itemLabel">设置</span><span aria-hidden="true" class="Menu_shortcut">Ctrl+,</span></button></div>
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"><svg class="plane"></svg></span><span class="Menu_itemLabel">意见反馈</span></button></div>
    <div class="Menu_itemWrap"><button type="button" role="menuitem" class="Menu_item"><span class="Menu_itemIcon"><svg class="logout"></svg></span><span class="Menu_itemLabel">退出登录</span></button></div>
  </div>
</div>`;

const dom = new JSDOM(`<!doctype html><html><body><div id="app">${LAUNCHER}</div></body></html>`, {
  url: 'http://127.0.0.1:19387/',
  pretendToBeVisual: true,
});
const { window } = dom;

// The bundle reads these as bare globals, exactly as it does in the page.
for (const key of [
  'window',
  'document',
  'navigator',
  'MutationObserver',
  'KeyboardEvent',
  'MouseEvent',
  'PointerEvent',
  'Element',
  'HTMLElement',
  'Node',
]) {
  // Node 24 exposes some of these (navigator) as getter-only globals.
  Object.defineProperty(globalThis, key, {
    value: window[key],
    configurable: true,
    writable: true,
  });
}
// requestAnimationFrame must be callable detached in this Node context.
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const ReactDOMClient = require('react-dom/client');

// ------------------------------------------------------- load the browser half
let captured = null;
window.__ModuleLoader__ = {
  load(entry) {
    captured = entry;
  },
};
window.eval(fs.readFileSync(CLIENT, 'utf8'));
check('bundle registers through __ModuleLoader__.load', captured !== null);
check('bundle id is the package name', captured?.id === 'dsh-accountdisplayname-edit', captured?.id);

const moduleExports = captured.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require(${specifier})`);
});
check('exports a plugin name', moduleExports.name === 'account-display-name-edit', moduleExports.name);
check('exports a slots dependency', Array.isArray(moduleExports.inject) && moduleExports.inject.includes('slots'));
check('exports apply()', typeof moduleExports.apply === 'function');

// ---------------------------------------------------------------- stub context
const slots = [];
const disposers = [];
let slotDisposed = false;
const ctx = {
  get(name) {
    return name === 'locale' ? { getLocale: () => ({ id: 'zh-CN' }) } : undefined;
  },
  logger: { warn: (...args) => console.log('  [plugin warn]', ...args) },
  slots: {
    inject(_key, callback) {
      return callback();
    },
    register(definition, component) {
      slots.push({ definition, component });
      return () => {
        slotDisposed = true;
      };
    },
  },
  effect(fn, label) {
    check('effect() is registered with a label', typeof label === 'string' && label.length > 0);
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
    return () => {};
  },
};

// Pre-existing alias, as if set in an earlier session.
window.localStorage.setItem('dsh.account-display-name-edit.alias', 'Alice');

const labelNode = () => window.document.querySelector('span[class*="_label"]');
const trigger = () => window.document.querySelector('button[aria-haspopup="menu"]');

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
async function frames(count) {
  for (let i = 0; i < count; i += 1) await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const act = React.act ?? require('react-dom/test-utils').act;

// ------------------------------------------------------------------ apply it
section('apply()');
await act(async () => {
  moduleExports.apply(ctx);
});
check('registers exactly one shell.overlay entry', slots.length === 1, String(slots.length));
check('overlay slot name is shell.overlay', slots[0]?.definition.name === 'shell.overlay');
check('overlay component is a function', typeof slots[0]?.component === 'function');

section('sidebar account label');
check('stored alias replaces the phone number', labelNode().textContent === 'Alice', labelNode().textContent);

// The account plugin re-renders its own text; the plugin must win again.
labelNode().firstChild.nodeValue = '181******40';
await frames(3);
check('alias re-applied after a shipped re-render', labelNode().textContent === 'Alice', labelNode().textContent);

check(
  'write reuses the shipped text node (no detached-node drift)',
  labelNode().childNodes.length === 1 && labelNode().firstChild.nodeType === 3,
);

// ------------------------------------------------------------- account menu
section('account menu row');

// Mount the editor overlay first so its store subscription is live.
const host = window.document.createElement('div');
window.document.body.appendChild(host);
let root = null;
await act(async () => {
  root = ReactDOMClient.createRoot(host);
  root.render(React.createElement(slots[0].component));
});
check('overlay renders nothing while closed', host.childNodes.length === 0 || host.textContent === '');

// A keydown listener stands in for the Menu primitive's own Escape handling.
let escapes = 0;
window.document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') escapes += 1;
});

function pressLauncher() {
  const button = trigger();
  // jsdom has no PointerEvent constructor; the plugin listens by event type.
  button.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  button.setAttribute('aria-expanded', 'true');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

pressLauncher();
// The menu is portaled by React *after* the click, which is what the rAF poll is for.
const menuHost = window.document.createElement('div');
menuHost.innerHTML = MENU;
const menu = menuHost.firstElementChild;
window.document.body.appendChild(menu);
await frames(4);

const row = menu.querySelector('[data-dsh-accountdisplayname-edit-row]');
check('a row is injected into the open account menu', row !== null);
check('the injected row is a menuitem button', row?.querySelector('button[role="menuitem"]') !== null);
const rowButton = row?.querySelector('button[role="menuitem"]');
check('row label is 编辑显示名称', row?.querySelector('[class*="_itemLabel"]')?.textContent === '编辑显示名称', row?.querySelector('[class*="_itemLabel"]')?.textContent);
check('row sits directly under the first shipped row', menu.querySelectorAll('[role="presentation"] > *')[1] === row);
check('shipped shortcut span is dropped', row?.querySelector('[class*="_shortcut"]') === null);
check('aria-keyshortcuts is dropped', rowButton?.getAttribute('aria-keyshortcuts') === null);
check('icon replaced with the pencil artwork', row?.querySelector('[class*="_itemIcon"] svg.gear') === null && row?.querySelector('[class*="_itemIcon"] svg path') !== null);
check('shipped rows left untouched', menu.querySelectorAll('button[role="menuitem"]').length === 4 && menu.querySelectorAll('button[role="menuitem"]')[0].textContent.includes('设置'));

// ------------------------------------------------------------ row activation
section('opening the editor from the row');
// Count the launcher toggles the row performs, and prove no document-wide Escape
// is fired (which every other global key handler would also see).
let launcherToggles = 0;
trigger().addEventListener('click', () => {
  launcherToggles += 1;
});
escapes = 0;
await act(async () => {
  rowButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await frames(2);
check('the launcher is toggled closed instead of sending a global Escape', launcherToggles >= 1 && escapes === 0, `toggles=${launcherToggles} escapes=${escapes}`);

const dialog = host.querySelector('[role="dialog"]');
check('the editor dialog opens', dialog !== null);
check('dialog is titled 编辑名称与头像', dialog?.getAttribute('aria-label') === '编辑名称与头像', dialog?.getAttribute('aria-label'));
const input = dialog?.querySelector('input[type="text"]');
check('dialog has the alias pre-filled', input?.value === 'Alice', input?.value);
const dialogButtons = dialog === null ? [] : [...dialog.querySelectorAll('button')];
const buttonLabelled = (label) => dialogButtons.find((b) => b.textContent === label);
check('dialog offers avatar pick + clear', buttonLabelled('选择图片…') !== undefined && buttonLabelled('清除头像') !== undefined);
check('dialog exposes save / cancel / reset', buttonLabelled('保存') !== undefined && buttonLabelled('取消') !== undefined && buttonLabelled('恢复默认') !== undefined);
// Regression: the save button once used --dsw-alias-brand-primary with hardcoded
// white text, which is white-on-white in the dark theme (brand-primary is near-white
// there). It must use the shell Button's own tokens.
check('save button carries the shell primary class', buttonLabelled('保存').className === 'dsh-adn-btn dsh-adn-btn--primary', buttonLabelled('保存').className);
const buttonCss = (window.document.querySelector('style[data-dsh-accountdisplayname-edit-style]')?.textContent) ?? '';
check('primary styling uses the button tokens, not the brand colour', buttonCss.includes('--dsw-alias-button-primary-fill') && buttonCss.includes('--dsw-alias-label-primary-foreground') && !buttonCss.includes('brand-primary'));
check('buttons carry hover and focus states', buttonCss.includes('--dsw-alias-button-primary-hover') && buttonCss.includes(':focus-visible'));

// ------------------------------------------------------------- editor actions
section('saving a new alias');
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '  匿名用户  ');
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
});
await act(async () => {
  buttonLabelled('保存').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await frames(2);
check('alias is stored trimmed', window.localStorage.getItem('dsh.account-display-name-edit.alias') === '匿名用户', window.localStorage.getItem('dsh.account-display-name-edit.alias'));
check('sidebar label updated', labelNode().textContent === '匿名用户', labelNode().textContent);
check('dialog closed after saving', host.querySelector('[role="dialog"]') === null);

section('reset to the account name');
pressLauncher();
const menu2Host = window.document.createElement('div');
menu2Host.innerHTML = MENU;
const menu2 = menu2Host.firstElementChild;
window.document.body.appendChild(menu2);
await frames(4);
const row2 = menu2.querySelector('[data-dsh-accountdisplayname-edit-row]');
check('row injected again on reopen', row2 !== null);
await act(async () => {
  row2.querySelector('button[role="menuitem"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await frames(2);
const dialog2 = host.querySelector('[role="dialog"]');
await act(async () => {
  [...dialog2.querySelectorAll('button')]
    .find((b) => b.textContent === '恢复默认')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await frames(2);
check('alias cleared from storage', window.localStorage.getItem('dsh.account-display-name-edit.alias') === null, String(window.localStorage.getItem('dsh.account-display-name-edit.alias')));
check('shipped text handed back', labelNode().textContent === '181******40', labelNode().textContent);
// This fixture's launcher has no toggle of its own, so the menu cannot be closed by
// the click: the fallback must drop our injected row rather than leave it behind.
check('the fallback drops the row when the toggle cannot close the menu', menu2.querySelector('[data-dsh-accountdisplayname-edit-row]') === null);

// -------------------------------------------------------------------- dispose
section('disposal');
// Open the menu once more so a live row exists for the teardown to clean up.
pressLauncher();
const menu3Host = window.document.createElement('div');
menu3Host.innerHTML = MENU;
const menu3 = menu3Host.firstElementChild;
window.document.body.appendChild(menu3);
await frames(4);
const liveRow = menu3.querySelector('[data-dsh-accountdisplayname-edit-row]');
check('row exists before disposal', liveRow !== null);
for (const dispose of disposers) {
  await act(async () => {
    dispose();
  });
}
check('injected row removed on dispose', window.document.querySelector('[data-dsh-accountdisplayname-edit-row]') === null);
check('overlay slot released', slotDisposed);

// ---------------------------------------------------------------------- report
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('failed checks:');
  for (const name of failures) console.log(` - ${name}`);
  process.exitCode = 1;
}
