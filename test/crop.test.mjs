/**
 * The crop step between picking a file and the editor's preview.
 *
 * jsdom never decodes an image and has no 2D canvas, so this file supplies both
 * ends: a fake `Image` that fires `load` (what `cropAvatar` awaits) and a canvas
 * stub that records the draw call. Everything in between — the dialog, the
 * draft semantics, confirm versus cancel, Escape — is the shipped bundle.
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
const STORED = 'data:image/png;base64,STORED';
const CROPPED = 'data:image/png;base64,CROPPED';

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

let React;
let ReactDOMClient;
let act;
function ensureReact() {
  if (React !== undefined) return;
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  act = React.act ?? require('react-dom/test-utils').act;
}

function boot(seed) {
  const dom = new JSDOM(`<!doctype html><html><body>${LAUNCHER}</body></html>`, {
    url: 'http://127.0.0.1:19387/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // `cropAvatar` waits for an image to load; jsdom never does, so this stand-in
  // fires the callback on the next tick and reports a fixed source size.
  class FakeImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
      this.onload = null;
      this.onerror = null;
    }
    set src(_value) {
      // Synchronous on purpose: `cropAvatar` has already assigned `onload`
      // before it sets `src`, and a synchronous call keeps the confirm path
      // inside the test's act() instead of landing on a later tick.
      if (typeof this.onload === 'function') this.onload();
    }
    get src() {
      return '';
    }
  }
  window.Image = FakeImage;

  const draws = [];
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return { drawImage: (...args) => draws.push(args) };
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => CROPPED;

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
    draws,
    frames,
    apply: () => captured.factory((s) => { if (s === 'react') return require('react'); throw new Error(`unexpected require(${s})`); }).apply(ctx),
  };
}

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

const cropDialogOf = (host) => host.querySelector('[role="dialog"][aria-label="裁剪头像"]');
const previewOf = (host) => host.querySelector('[data-dsh-avatar-preview]');

async function pickFile(world, dialog) {
  const input = dialog.querySelector('input[type="file"]');
  const file = new world.window.File([new Uint8Array([137, 80, 78, 71])], 'pick.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new world.window.Event('change', { bubbles: true }));
    // FileReader resolves off the event loop; wait inside act so the state
    // update it causes is flushed as part of the same update.
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await world.frames(2);
}

async function settleCropImage(world, cropDialog) {
  const image = cropDialog.querySelector('img');
  Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: 600, configurable: true });
  await act(async () => {
    image.dispatchEvent(new world.window.Event('load'));
    // Layout settles on the next frame; keep it inside act so the resulting
    // state update is flushed with the event.
    await world.frames(3);
  });
  return image;
}

const buttonLabelled = (scope, text) => [...scope.querySelectorAll('button')].find((b) => b.textContent === text);

// ---------------------------------------------------------------------------
section('picking a file opens the crop step instead of applying it');
{
  const world = boot({ [AVATAR]: STORED });
  world.apply();
  await world.frames(3);

  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  await act(async () => {
    ReactDOMClient.createRoot(host).render(React.createElement(world.slots[0].component));
  });
  const dialog = await openEditor(world, host);
  check('editor opens', dialog !== null);

  await pickFile(world, dialog);
  const cropDialog = cropDialogOf(host);
  check('crop dialog opens', cropDialog !== null);
  check('editor stays open behind it', host.querySelector('[role="dialog"][aria-label="编辑名称与头像"]') !== null);
  check('draft preview is untouched by the pick', previewOf(host)?.style.backgroundImage.includes('STORED') === true, previewOf(host)?.style.backgroundImage);

  const image = await settleCropImage(world, cropDialog);
  check('the picked image is shown for cropping', String(image.getAttribute('src') ?? '').startsWith('data:image/'), String(image.getAttribute('src') ?? '').slice(0, 30));

  const viewport = cropDialog.querySelector('[data-dsh-crop-view]');
  check('the crop viewport is round, matching the avatar', viewport?.style.borderRadius === '50%', viewport?.style.borderRadius);
  check('the viewport keeps a 1:1 box', viewport?.style.aspectRatio === '1 / 1', viewport?.style.aspectRatio);

  // Adjust the framing, then confirm.
  const applyButton = buttonLabelled(cropDialog, '使用');
  check('crop dialog offers 使用', applyButton !== undefined);
  check('confirm is enabled once the image is measured', applyButton?.disabled === false);

  await act(async () => {
    applyButton.dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(2);

  check('crop dialog closes on confirm', cropDialogOf(host) === null);
  check('confirm writes the cropped result into the draft', String(previewOf(host)?.style.backgroundImage ?? '').includes('CROPPED'), previewOf(host)?.style.backgroundImage);
  check('storage is still untouched before Save', world.window.localStorage.getItem(AVATAR) === STORED);
  // The preview canvas also draws; the export is the 9-argument call sized 128.
  const cropDraws = world.draws.filter((args) => args.length === 9 && args[7] === 128 && args[8] === 128);
  check('exactly one export draw call was made', cropDraws.length === 1, String(cropDraws.length));
  const draw = cropDraws[0] ?? [];
  check('the drawn source region is square', Math.abs(draw[3] - draw[4]) < 0.001, `${draw[3]} x ${draw[4]}`);
  check('the result is the avatar dimension', draw[7] === 128 && draw[8] === 128, `${draw[7]}x${draw[8]}`);
}

// ---------------------------------------------------------------------------
section('cancel leaves the draft exactly as it was');
{
  const world = boot({ [AVATAR]: STORED });
  world.apply();
  await world.frames(3);
  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  await act(async () => {
    ReactDOMClient.createRoot(host).render(React.createElement(world.slots[0].component));
  });
  const dialog = await openEditor(world, host);
  await pickFile(world, dialog);
  const cropDialog = cropDialogOf(host);
  await settleCropImage(world, cropDialog);

  await act(async () => {
    buttonLabelled(cropDialog, '取消').dispatchEvent(new world.window.MouseEvent('click', { bubbles: true }));
  });
  await world.frames(2);

  check('crop dialog closes on cancel', cropDialogOf(host) === null);
  check('the draft keeps the previous avatar', previewOf(host)?.style.backgroundImage.includes('STORED') === true, previewOf(host)?.style.backgroundImage);
  const cropDraws = world.draws.filter((args) => args.length === 9 && args[7] === 128 && args[8] === 128);
  check('no crop was drawn', cropDraws.length === 0, String(cropDraws.length));
  check('the editor is still open', host.querySelector('[role="dialog"][aria-label="编辑名称与头像"]') !== null);
}

// ---------------------------------------------------------------------------
section('Escape dismisses the crop step, not the editor');
{
  const world = boot({ [AVATAR]: STORED });
  world.apply();
  await world.frames(3);
  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  await act(async () => {
    ReactDOMClient.createRoot(host).render(React.createElement(world.slots[0].component));
  });
  const dialog = await openEditor(world, host);
  await pickFile(world, dialog);
  check('crop dialog is in front', cropDialogOf(host) !== null);

  await act(async () => {
    world.document.dispatchEvent(new world.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await world.frames(2);

  check('Escape closes the crop step', cropDialogOf(host) === null);
  check('Escape does not close the editor', host.querySelector('[role="dialog"][aria-label="编辑名称与头像"]') !== null);
  check('the draft is unchanged after Escape', previewOf(host)?.style.backgroundImage.includes('STORED') === true);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('failed checks:');
  for (const name of failures) console.log(` - ${name}`);
  process.exitCode = 1;
}
