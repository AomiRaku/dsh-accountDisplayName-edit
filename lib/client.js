/**
 * dsh-accountdisplayname-edit — browser half.
 *
 * Hand-bundled on purpose: the module system serves `lib/client.js` verbatim, so
 * this file is already in the `window.__ModuleLoader__.load({ id, factory })`
 * form and needs no build step. Only `react` is required, which the shell seeds
 * as a platform module.
 *
 * What it does
 *   1. Replaces the sidebar account launcher's label text with the user's alias.
 *   2. Adds an "编辑显示名称" row to the account menu that launcher opens.
 *   3. Hosts the editor dialog on the `shell.overlay` slot.
 *
 * Why the menu row is DOM work
 *   `@deepseek-ai/dsh-client-ui-settings-account` renders that menu from a
 *   hard-coded `items` array and its only slot (`settings.launcher`, a `single`
 *   slot) is the launcher row itself — replacing it would delete 设置 /
 *   意见反馈 / 退出登录, which this plugin must not do. So the row is appended to
 *   the *open* menu's list, cloned from a shipped row so it inherits that build's
 *   exact markup and styling. Appending one node leaves React's own children
 *   untouched, and the row disappears with the menu because it is never tracked.
 *
 *   Every DOM probe is written to fail soft: a changed selector degrades to "no
 *   alias, no extra row", never to a broken tree or a thrown error.
 */
window.__ModuleLoader__.load({
  id: "dsh-accountdisplayname-edit",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";

    var React = require("react");

    // --------------------------------------------------------------- constants

    var PLUGIN_ID = "dsh-accountdisplayname-edit";
    var STORAGE_KEY = "dsh.account-display-name-edit.alias";
    var AVATAR_KEY = "dsh.account-display-name-edit.avatar";
    var MAX_LENGTH = 32;

    /**
     * Avatar limits. A picked image is centre-cropped square and drawn at
     * `AVATAR_DIMENSION`, which keeps the stored data URL in the low tens of KB
     * so it fits comfortably in the page's `localStorage` quota.
     */
    var AVATAR_DIMENSION = 128;
    var AVATAR_MAX_FILE_BYTES = 10 * 1024 * 1024;
    var AVATAR_MAX_STORED_CHARS = 512 * 1024;

    /**
     * The account launcher is the only menu trigger the shell marks with a
     * signed-in/out flag; `data-collapsed` is the same component's second
     * always-present flag, kept as a fallback for a future rename.
     */
    var TRIGGER_SELECTOR = 'button[aria-haspopup="menu"][data-signed-out]';
    var TRIGGER_FALLBACK = 'button[aria-haspopup="menu"][data-collapsed]';

    /** Marks our injected row, so it is never injected twice. */
    var ROW_ATTR = "data-dsh-accountdisplayname-edit-row";

    /**
     * Marks the launcher's avatar span while a custom image is applied. The
     * scoped stylesheet hides the span's real children and sizes the background
     * image, so no React-owned node is ever removed or replaced.
     */
    var AVATAR_ATTR = "data-dsh-accountdisplayname-edit-avatar";
    var STYLE_ATTR = "data-dsh-accountdisplayname-edit-style";

    /** How many animation frames to wait for the menu React renders after a click. */
    var MENU_POLL_FRAMES = 24;

    var TEXT = {
      zh: {
        row: "编辑显示名称",
        title: "编辑名称与头像",
        hint: "只修改本地显示，留空则为默认。",
        placeholder: "显示名称",
        nameClear: "清除名称",
        avatarChoose: "选择图片…",
        avatarClear: "清除头像",
        avatarTooLarge: "图片太大，请换一张 10 MB 以内、尺寸小一些的。",
        avatarFailed: "这张图片读不出来，换一张试试。",
        cropTitle: "裁剪头像",
        cropHint: "拖动图像选择区域，滑动滑块调整缩放。",
        cropZoom: "缩放",
        cropApply: "使用",
        cropCancel: "取消",
        cropLoading: "正在读取图片…",
        saveFailed: "保存失败：本地存储已满或被禁用，刚才的改动没有写进去。",
        save: "保存",
        cancel: "取消"
      },
      en: {
        row: "Edit display name",
        title: "Edit name and avatar",
        hint: "Shown on this device only. Leave it empty to use the default.",
        placeholder: "Display name",
        nameClear: "Clear name",
        avatarChoose: "Choose image…",
        avatarClear: "Clear avatar",
        avatarTooLarge: "That image is too large — pick one under 10 MB and smaller in pixels.",
        avatarFailed: "That image could not be read. Try another one.",
        cropTitle: "Crop avatar",
        cropHint: "Drag the image to choose the area; use the slider to zoom.",
        cropZoom: "Zoom",
        cropApply: "Use",
        cropCancel: "Cancel",
        cropLoading: "Reading the image…",
        saveFailed: "Could not save: local storage is full or disabled, so nothing was written.",
        save: "Save",
        cancel: "Cancel"
      }
    };

    var EDIT_ICON =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4.5 19.5h3.6L18.9 8.7a1.9 1.9 0 0 0 0-2.7l-1.8-1.8a1.9 1.9 0 0 0-2.7 0L3.6 15.9v3.6Z"/>' +
      '<path d="M13.2 6.1 17.9 10.8"/></svg>';

    /**
     * Trash glyph for the avatar clear button. The wording stays on the button's
     * `aria-label` and `title`, so the control reads the same to a screen reader
     * without spending a third of the row on a text label.
     */
    var TRASH_ICON = React.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 16,
        height: 16,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true"
      },
      React.createElement("path", { d: "M4 7h16" }),
      React.createElement("path", { d: "M9.5 7V5.2h5V7" }),
      React.createElement("path", { d: "M6.6 7l.7 12h9.4l.7-12" }),
      React.createElement("path", { d: "M10.2 10.8v5.4M13.8 10.8v5.4" })
    );

    /**
     * The empty-state preview reuses the shell's own sprite, so it matches the
     * account row's placeholder exactly instead of approximating the glyph.
     */
    var AVATAR_PLACEHOLDER = React.createElement(
      "svg",
      { width: 24, height: 24, "aria-hidden": "true", focusable: "false" },
      React.createElement("use", { href: "#dsw-icon-user-outline-medium" })
    );

    /** Cross glyph for the name field's clear button. */
    var CLEAR_ICON = React.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        width: 14,
        height: 14,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        "aria-hidden": "true"
      },
      React.createElement("path", { d: "M6 6l12 12" }),
      React.createElement("path", { d: "M18 6L6 18" })
    );

    // ------------------------------------------------------------------ helpers

    /** Run `fn`, returning `fallback` if it throws. */
    function safe(fn, fallback) {
      try {
        return fn();
      } catch (_error) {
        return fallback;
      }
    }

    function elementOf(target) {
      return target instanceof Element ? target : null;
    }

    // -------------------------------------------------------------------- state

    var state = { alias: "", avatar: "", open: false };
    var listeners = [];
    var locale = null;

    function emit() {
      var current = listeners.slice();
      for (var i = 0; i < current.length; i++) {
        safe(function () {
          current[i]();
        }, null);
      }
    }

    function subscribe(listener) {
      listeners.push(listener);
      return function () {
        var at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    }

    function getAlias() {
      return state.alias;
    }

    function getAvatar() {
      return state.avatar;
    }

    function isEditorOpen() {
      return state.open;
    }

    function setEditorOpen(open) {
      if (state.open === open) return;
      state.open = open;
      emit();
    }

    /**
     * Persist the display name. Returns false when it cannot be written, for the
     * same reason as `setAvatar`: a name that would vanish on reload must not be
     * shown as saved.
     */
    function setAlias(next) {
      var value = typeof next === "string" ? next.slice(0, MAX_LENGTH) : "";
      var writtenOk = safe(function () {
        if (value === "") window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, value);
        return true;
      }, false);
      if (writtenOk !== true) return false;
      state.alias = value;
      emit();
      reconcile();
      return true;
    }

    /**
     * Persist the avatar data URL. Returns false when the value is too large or
     * cannot be written, so the dialog can keep itself open and say so instead of
     * accepting an edit that would silently vanish on reload.
     */
    function setAvatar(next) {
      var value = typeof next === "string" ? next : "";
      if (value.length > AVATAR_MAX_STORED_CHARS) return false;
      var writtenOk = safe(function () {
        if (value === "") window.localStorage.removeItem(AVATAR_KEY);
        else window.localStorage.setItem(AVATAR_KEY, value);
        return true;
      }, false);
      if (writtenOk !== true) return false;
      state.avatar = value;
      emit();
      reconcile();
      return true;
    }

    function loadAvatar() {
      var stored = safe(function () {
        return window.localStorage.getItem(AVATAR_KEY);
      }, null);
      state.avatar = typeof stored === "string" && stored.indexOf("data:image/") === 0 ? stored : "";
    }

    function loadAlias() {
      var stored = safe(function () {
        return window.localStorage.getItem(STORAGE_KEY);
      }, null);
      state.alias = typeof stored === "string" ? stored.slice(0, MAX_LENGTH) : "";
    }

    /** The active copy, chosen from the client locale id; Simplified Chinese by default. */
    function strings() {
      var id = "";
      safe(function () {
        if (locale === null) return;
        var snapshot = typeof locale.getLocale === "function" ? locale.getLocale() : locale.getSnapshot();
        id = String((snapshot && (snapshot.id || snapshot.locale)) || "");
      }, null);
      return id.toLowerCase().indexOf("en") === 0 ? TEXT.en : TEXT.zh;
    }

    // ------------------------------------------------- the account launcher label

    var written = null; // text this plugin last wrote (null when it owns nothing)
    var shipped = null; // the text the account plugin last rendered

    var cachedTrigger = null; // the launcher, so the hot path never scans the document

    function accountTrigger() {
      // `reconcile` runs on every body mutation — during a streaming reply that is
      // every frame — so this must stay O(1) while the launcher is still in the tree.
      if (cachedTrigger !== null && cachedTrigger.isConnected) return cachedTrigger;
      cachedTrigger = safe(function () {
        return document.querySelector(TRIGGER_SELECTOR) || document.querySelector(TRIGGER_FALLBACK);
      }, null);
      return cachedTrigger;
    }

    /**
     * The launcher's text node holder: the button's own label span, found by the
     * stable `_label` suffix CSS modules appends to a authored class name, with a
     * positional fallback (the label is the last of the button's spans).
     */
    function labelNode(trigger) {
      var named = safe(function () {
        return trigger.querySelector(':scope > span[class*="_label"]');
      }, null);
      if (named !== null) return named;
      var spans = [];
      for (var i = 0; i < trigger.children.length; i++) {
        if (trigger.children[i].tagName === "SPAN") spans.push(trigger.children[i]);
      }
      return spans.length >= 2 ? spans[spans.length - 1] : null;
    }

    /**
     * Write through React's own text node where possible. Replacing the span's
     * whole content would detach the node React still holds, so a later account
     * refresh would update a detached node and leave this plugin with a stale
     * "shipped" text to restore.
     */
    function writeText(node, text) {
      var only = node.childNodes.length === 1 ? node.firstChild : null;
      if (only !== null && only.nodeType === 3) only.nodeValue = text;
      else node.textContent = text;
    }

    function applyLabel(trigger) {
      var node = labelNode(trigger);
      if (node === null) return;
      var text = node.textContent;
      if (text !== written) shipped = text;

      if (state.alias !== "") {
        if (text !== state.alias) {
          writeText(node, state.alias);
          written = state.alias;
        }
        return;
      }

      // No alias: give the shipped text back exactly once.
      if (written !== null && text === written) {
        writeText(node, shipped === null ? "" : shipped);
        written = null;
      }
    }

    // ------------------------------------------------ the account launcher avatar

    var avatarApplied = null; // data URL currently painted on the avatar span
    var styleTag = null; // the scoped stylesheet, removed on dispose

    /**
     * The launcher's avatar holder: a span carrying the `_avatar` CSS-module
     * suffix. It only exists while signed in — a signed-out launcher renders an
     * ellipsis glyph instead — so a miss is normal, never an error.
     */
    function avatarNode(trigger) {
      var named = safe(function () {
        return trigger.querySelector(':scope > span[class*="_avatar"]');
      }, null);
      if (named !== null) return named;
      var first = trigger.children.length > 0 ? trigger.children[0] : null;
      return first !== null && first.tagName === "SPAN" ? first : null;
    }

    /**
     * Paint the custom avatar as the span's background image. The real avatar
     * element React renders stays in the tree, merely hidden by the scoped rule
     * for `AVATAR_ATTR`, so nothing React owns is detached or replaced.
     */
    function applyAvatar(trigger) {
      var node = avatarNode(trigger);
      if (node === null) return;

      if (state.avatar === "") {
        if (avatarApplied !== null) {
          node.removeAttribute(AVATAR_ATTR);
          node.style.backgroundImage = "";
          avatarApplied = null;
        }
        return;
      }

      if (avatarApplied === state.avatar && node.getAttribute(AVATAR_ATTR) === "1") return;
      node.setAttribute(AVATAR_ATTR, "1");
      node.style.backgroundImage = 'url("' + state.avatar + '")';
      avatarApplied = state.avatar;
    }

    /** One scoped stylesheet: sizes the background image and hides the real avatar. */
    function injectStyles() {
      var present = safe(function () {
        return document.querySelector("style[" + STYLE_ATTR + "]");
      }, null);
      if (present !== null) return null;
      var tag = document.createElement("style");
      tag.setAttribute(STYLE_ATTR, "1");
      tag.textContent =
        // Avatar paint: size the background image and hide the real avatar child.
        "[" + AVATAR_ATTR + '="1"]>*{display:none !important}' +
        "[" + AVATAR_ATTR + '="1"]{background-size:cover !important;background-position:50% 50% !important;background-repeat:no-repeat !important}' +
        // Dialog buttons mirror the shell's own Button: same tokens, states and
        // geometry. `--dsw-alias-brand-primary` is NOT the button fill — in the dark
        // theme it is near-white, which is how a white-on-white label happened.
        ".dsh-adn-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;" +
        "height:32px;padding:0 12px;border:0;border-radius:var(--dsw-radius-md,8px);cursor:pointer;font:inherit;" +
        "font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,inherit);background:transparent}" +
        ".dsh-adn-btn:disabled{cursor:not-allowed;opacity:.4}" +
        ".dsh-adn-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid " +
        "var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px}" +
        ".dsh-adn-btn--primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);" +
        "color:var(--dsw-alias-label-primary-foreground,#fff)}" +
        ".dsh-adn-btn--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#5b78ff)}" +
        ".dsh-adn-btn--ghost{color:var(--dsw-alias-label-secondary,inherit)}" +
        ".dsh-adn-btn--icon{width:32px;padding:0;flex:none}" +
        ".dsh-adn-input-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);" +
        "width:24px;height:24px;padding:0;border-radius:50%;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.9))}" +
        ".dsh-adn-btn--ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18))}" +
        ".dsh-adn-btn--ghost:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(128,128,128,.26))}";
      safe(function () {
        document.head.appendChild(tag);
      }, null);
      return tag;
    }

    /**
     * Draw the square the user framed into the stored avatar.
     *
     * `view` is the crop the preview showed: `x`/`y` are the image's top-left
     * offset inside the square viewport (so both are <= 0), `scale` is the
     * multiplier the preview applied, and `size` is the viewport's edge in CSS
     * pixels. Every number comes from the same layout the user saw, so the
     * stored result matches the preview instead of re-deriving a centre crop.
     */
    function cropAvatar(dataUrl, view, done) {
      var image = new Image();
      image.onerror = function () {
        done(null, "avatarFailed");
      };
      image.onload = function () {
        var canvas = document.createElement("canvas");
        var context = null;
        safe(function () {
          context = canvas.getContext("2d");
        }, null);
        if (context === null) {
          // No 2D canvas available: keep the picked bytes rather than fail.
          done(dataUrl);
          return;
        }
        var size = AVATAR_DIMENSION;
        canvas.width = size;
        canvas.height = size;
        var scale = view.scale > 0 ? view.scale : 1;
        var edge = view.size > 0 ? view.size : 1;
        safe(function () {
          context.drawImage(
            image,
            -view.x / scale,
            -view.y / scale,
            edge / scale,
            edge / scale,
            0,
            0,
            size,
            size
          );
        }, null);
        var encoded = safe(function () {
          return canvas.toDataURL("image/png");
        }, null);
        done(typeof encoded === "string" && encoded.indexOf("data:image/") === 0 ? encoded : dataUrl);
      };
      image.src = dataUrl;
    }

    /** Read one picked file into its original data URL, reporting a localized failure key. */
    function readAvatarSource(file, done) {
      var type = String((file && file.type) || "");
      if (type.indexOf("image/") !== 0) {
        done(null, "avatarFailed");
        return;
      }
      if (file.size > AVATAR_MAX_FILE_BYTES) {
        done(null, "avatarTooLarge");
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        done(null, "avatarFailed");
      };
      reader.onload = function () {
        var dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (dataUrl === "") {
          done(null, "avatarFailed");
          return;
        }
        done(dataUrl);
      };
      reader.readAsDataURL(file);
    }

    // ------------------------------------------------------ the account menu row

    var currentMenu = null; // the open account menu we injected into
    var knownMenus = []; // menus already open when the launcher was pressed
    var sawPointerDown = false; // whether `knownMenus` is an authoritative snapshot
    var suppressTriggerClick = false; // set while closeMenu toggles the launcher itself
    var domAlive = false; // whether the mounted DOM effect may still touch the page
    var currentFrame = 0; // pending rAF handle

    /**
     * Open lists the Menu primitive portals. A portal makes the list a direct child of
     * <body>, so this walks that short list — O(body children) — and is the only scan
     * the click path performs. Submenus stay nested and are skipped.
     */
    function portaledMenus() {
      var menus = [];
      var children = document.body === null ? null : document.body.children;
      if (children === null) return menus;
      for (var i = 0; i < children.length; i++) {
        if (children[i].getAttribute("role") === "menu") menus.push(children[i]);
      }
      return menus;
    }

    /** Document-wide search, kept for a list rendered somewhere other than <body>. */
    function anyMenus() {
      return safe(function () {
        return Array.prototype.slice.call(document.querySelectorAll('div[role="menu"]'));
      }, []);
    }

    /**
     * `deep` stays false on every hot path — the pointerdown snapshot and the first
     * frames of a menu watch — because those are exactly the moments when no menu is
     * open, and a document-wide scan there is the cost this plugin used to pay on
     * every click. Only a watch that keeps missing escalates to the deep search.
     */
    function openMenus(deep) {
      var menus = portaledMenus();
      if (menus.length > 0 || deep !== true) return menus;
      return anyMenus();
    }

    /** Among candidates, the one rendered closest to the trigger — i.e. its own menu. */
    function nearestMenu(trigger, menus) {
      if (menus.length <= 1) return menus.length === 1 ? menus[0] : null;
      var anchorRect = safe(function () {
        return trigger.getBoundingClientRect();
      }, null);
      if (anchorRect === null) return menus[0];
      var best = menus[0];
      var bestDistance = Infinity;
      for (var i = 0; i < menus.length; i++) {
        var rect = safe(function () {
          return menus[i].getBoundingClientRect();
        }, null);
        if (rect === null) continue;
        var dx = Math.max(0, Math.max(anchorRect.left - rect.right, rect.left - anchorRect.right));
        var dy = Math.max(0, Math.max(anchorRect.top - rect.bottom, rect.top - anchorRect.bottom));
        var distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = menus[i];
        }
      }
      return best;
    }

    function injectRow(menu) {
      if (menu.querySelector("[" + ROW_ATTR + "]") !== null) return;
      var viewport = menu.querySelector('div[role="presentation"]');
      if (viewport === null) return;
      var sample = viewport.querySelector('button[role="menuitem"]');
      if (sample === null) return;
      var wrapper = sample.parentElement;
      if (wrapper === null || wrapper.parentElement !== viewport) return;

      // Cloning a shipped row inherits this build's exact markup, classes and
      // styles, so the new row is indistinguishable from the native ones.
      var clone = wrapper.cloneNode(true);
      var button = clone.querySelector('button[role="menuitem"]');
      if (button === null) return;

      var icon = clone.querySelector('[class*="_itemIcon"]');
      var label = clone.querySelector('[class*="_itemLabel"]');
      if (label === null) {
        var spans = [];
        for (var i = 0; i < button.children.length; i++) {
          var child = button.children[i];
          if (child.tagName === "SPAN" && !/_shortcut/.test(String(child.className))) spans.push(child);
        }
        label = spans.length >= 2 ? spans[spans.length - 1] : null;
        if (icon === null) icon = spans.length >= 1 ? spans[0] : null;
      }
      // Some builds drop the `_itemIcon` wrapper and put the glyph straight in
      // the button; adopt that element so the row still gets our pencil.
      if (icon === null && label !== null) {
        var glyphs = button.querySelectorAll("svg");
        for (var g = 0; g < glyphs.length; g++) {
          if (!label.contains(glyphs[g])) {
            icon = glyphs[g].parentElement !== null && glyphs[g].parentElement !== button ? glyphs[g].parentElement : glyphs[g];
            break;
          }
        }
      }

      // Drop the shipped keyboard shortcut and nothing else. A plain
      // `[aria-hidden="true"]` fallback also matched the row's own icon `<svg
      // aria-hidden="true">` on newer builds and removed the whole icon holder,
      // which left the injected row with text but no icon. The fallback now
      // skips anything inside — or containing — the icon or label node.
      var shortcut = clone.querySelector('[class*="_shortcut"]');
      if (shortcut === null) {
        var hidden = clone.querySelectorAll('[aria-hidden="true"]');
        for (var k = 0; k < hidden.length; k++) {
          var candidate = hidden[k];
          if (icon !== null && (candidate === icon || icon.contains(candidate) || candidate.contains(icon))) continue;
          if (label !== null && (candidate === label || label.contains(candidate) || candidate.contains(label))) continue;
          shortcut = candidate;
          break;
        }
      }
      if (shortcut !== null && shortcut.parentElement !== null) shortcut.parentElement.removeChild(shortcut);

      if (label !== null) label.textContent = strings().row;
      if (icon !== null) {
        // Replacing an `<svg>` node itself keeps the artwork well-formed;
        // writing into it would nest a second svg.
        if (icon.namespaceURI === "http://www.w3.org/2000/svg") icon.outerHTML = EDIT_ICON;
        else icon.innerHTML = EDIT_ICON;
      }
      // Removing the attribute is what makes the clone clickable again; the `disabled`
      // property mirrors it, so setting both would be the same write twice.
      button.removeAttribute("aria-keyshortcuts");
      button.removeAttribute("disabled");
      clone.setAttribute(ROW_ATTR, "1");
      button.addEventListener("click", onRowActivate, true);

      // Sit directly under 设置, matching the order the shipped rows read in.
      var rows = viewport.children;
      if (rows.length >= 2) viewport.insertBefore(clone, rows[1]);
      else viewport.appendChild(clone);
    }

    /**
     * Close the menu before opening the editor.
     *
     * The Menu primitive's only close paths are a document-level Escape and an
     * outside pointerdown — both synthetic document-wide events that every other
     * listener would also act on. Clicking the launcher again is the same toggle a
     * user would use, and it reaches exactly one component, so that is the primary
     * path. The menu is necessarily open while our row is clickable, so the toggle
     * can only close it.
     */
    function closeMenu() {
      var menu = currentMenu;
      currentMenu = null;
      var trigger = accountTrigger();
      if (trigger !== null) {
        // `HTMLElement.click()` dispatches synchronously, so this flag cannot leak
        // past the call that needs it.
        suppressTriggerClick = true;
        safe(function () {
          trigger.click();
        }, null);
        suppressTriggerClick = false;
      }
      if (menu === null) return;
      window.setTimeout(function () {
        if (!menu.isConnected) return;
        // The toggle did not take. Drop our row and leave the menu rather than fire
        // a document-wide Escape, which unrelated global handlers would also see.
        safe(function () {
          var rows = menu.querySelectorAll("[" + ROW_ATTR + "]");
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].parentElement !== null) rows[i].parentElement.removeChild(rows[i]);
          }
        }, null);
      }, 0);
    }

    function onRowActivate(event) {
      if (event !== undefined) {
        event.preventDefault();
        event.stopPropagation();
      }
      closeMenu();
      setEditorOpen(true);
    }

    var menuWatch = null; // { trigger, useSnapshot } while waiting for the launcher's menu
    var menuRowObserver = null; // watches only the open menu, so idle pages cost nothing

    /**
     * Watch the open menu alone instead of scanning every frame: if a React re-render
     * drops our row, this microtask puts it back before the frame paints. The observer
     * lives only while the menu is open, so a page that is idle or streaming costs the
     * plugin nothing.
     */
    function watchMenuRows(menu) {
      if (menuRowObserver !== null) menuRowObserver.disconnect();
      menuRowObserver = new MutationObserver(function () {
        if (currentMenu === null || !currentMenu.isConnected) {
          stopWatchingMenuRows();
          return;
        }
        injectRow(currentMenu);
      });
      menuRowObserver.observe(menu, { childList: true, subtree: true });
    }

    function stopWatchingMenuRows() {
      if (menuRowObserver === null) return;
      menuRowObserver.disconnect();
      menuRowObserver = null;
    }

    /**
     * The Menu primitive re-measures on `window` resize/scroll, and otherwise only on its
     * own animation frame. A list committed before the surrounding layout settles paints
     * once at a stale position — a `side: "top"` menu ends up clamped to the bottom edge —
     * and jumps into place a frame later. Asking the primitive to re-place synchronously
     * folds that correction into the same frame, before it is painted.
     */
    function nudgeMenuPlacement() {
      safe(function () {
        var Ctor = window.Event || Event;
        window.dispatchEvent(new Ctor("resize"));
      }, null);
    }

    /**
     * Inject into the menu that appeared for the watched launcher, if it is there.
     * Runs synchronously from the body observer, i.e. after React commits the
     * portal but before the frame paints — so the menu's first paint is already
     * sized for our row instead of growing (and shifting) a moment later.
     */
    function attemptMenuInjection() {
      var watch = menuWatch;
      if (watch === null || !domAlive) return true;
      var menus = openMenus(watch.deep === true);
      var candidates = [];
      for (var i = 0; i < menus.length; i++) {
        if (!watch.useSnapshot || knownMenus.indexOf(menus[i]) < 0) candidates.push(menus[i]);
      }
      var menu = nearestMenu(watch.trigger, candidates);
      if (menu === null) return false;
      menuWatch = null;
      currentMenu = menu;
      knownMenus = [];
      // Re-place now, in this microtask: the list is committed but nothing has painted,
      // so a stale first measurement can still be corrected invisibly.
      nudgeMenuPlacement();
      // Insert only after the menu has had its first paint. The primitive measures and
      // reveals the list inside its own commit, so inserting during that window changes
      // its height mid-flight and forces the region underneath (the account row itself)
      // to be rasterised again — which reads as the row blinking for a frame. Letting
      // the menu appear exactly as shipped, then adding the row, keeps its opening frame
      // untouched.
      requestAnimationFrame(function () {
        if (!domAlive || currentMenu !== menu || !menu.isConnected) return;
        injectRow(menu);
        // Fold our own height change into this frame rather than the next one.
        nudgeMenuPlacement();
        watchMenuRows(menu);
      });
      return true;
    }

    /**
     * Wait for the launcher's menu. Only a menu that was *not* open when the
     * launcher was pressed qualifies; when no pointerdown was seen (keyboard
     * activation) there is no snapshot and any open menu is a candidate. The
     * snapshot is never used as a fallback: latching onto an already-open unrelated
     * menu would put the row in the wrong list.
     *
     * The frame loop is only a fallback for a menu that arrives without a body
     * mutation we can observe; the observer path normally injects before paint.
     */
    function watchForMenu(trigger, useSnapshot) {
      menuWatch = { trigger: trigger, useSnapshot: useSnapshot, deep: false };
      if (attemptMenuInjection()) return;
      var frames = 0;
      var step = function () {
        if (menuWatch === null) return;
        if (attemptMenuInjection()) return;
        frames += 1;
        if (!domAlive || frames >= MENU_POLL_FRAMES) {
          menuWatch = null;
          knownMenus = [];
          return;
        }
        // Escalate to the document-wide search only after the cheap path keeps missing.
        if (frames >= 2) menuWatch.deep = true;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // ------------------------------------------------------------- DOM lifetime

    var bodyObserver = null;
    var triggerObserver = null;
    var observedTrigger = null;

    function schedule() {
      if (currentFrame !== 0) return;
      currentFrame = requestAnimationFrame(function () {
        currentFrame = 0;
        reconcile();
      });
    }

    function observeTrigger(trigger) {
      if (trigger === observedTrigger) return;
      if (triggerObserver !== null) {
        triggerObserver.disconnect();
        triggerObserver = null;
      }
      observedTrigger = trigger;
      if (trigger === null) return;
      // The launcher button is a handful of nodes, so watching its text here is
      // far cheaper than watching character data across the whole document.
      triggerObserver = new MutationObserver(function () {
        // The launcher re-rendered, and React may have replaced the label or avatar
        // node — which drops our text and the avatar attribute. Re-apply right here:
        // this microtask runs after the commit but before the frame paints, so the
        // shipped value never gets a painted frame of its own (no one-frame flash).
        if (observedTrigger !== null && observedTrigger.isConnected) {
          applyLabel(observedTrigger);
          applyAvatar(observedTrigger);
        }
        schedule();
      });
      triggerObserver.observe(trigger, { childList: true, characterData: true, subtree: true });
    }

    function reconcile() {
      var trigger = accountTrigger();
      observeTrigger(trigger);
      if (trigger !== null) {
        applyLabel(trigger);
        applyAvatar(trigger);
      }
      // The open menu is not re-injected here: its own observer repairs a dropped row,
      // and the body observer releases it once it closes. Keeping a third path here only
      // made the row's lifetime depend on unrelated reconciles.
    }

    function onPointerDown(event) {
      var target = elementOf(event.target);
      if (target === null) return;
      var trigger = safe(function () {
        return target.closest(TRIGGER_SELECTOR) || target.closest(TRIGGER_FALLBACK);
      }, null);
      if (trigger === null) return;
      // Snapshot before React renders the menu, so the new one is identifiable.
      knownMenus = openMenus();
      sawPointerDown = true;
    }

    function onClick(event) {
      // Our own toggle in closeMenu must not be mistaken for a user opening the menu.
      if (suppressTriggerClick) return;
      var target = elementOf(event.target);
      if (target === null) return;
      var trigger = safe(function () {
        return target.closest(TRIGGER_SELECTOR) || target.closest(TRIGGER_FALLBACK);
      }, null);
      if (trigger === null) return;
      var useSnapshot = sawPointerDown;
      sawPointerDown = false;
      // Keyboard activation leaves no snapshot to compare against.
      if (!useSnapshot) knownMenus = [];
      watchForMenu(trigger, useSnapshot);
    }

    function mountDom() {
      domAlive = true;
      bodyObserver = new MutationObserver(function () {
        // The launcher *itself* can be replaced, not just its children. That takes the
        // trigger observer down with the old node, so nothing would repaint our text and
        // avatar until the next frame — one visible flash. This O(1) identity check
        // catches exactly that case and repaints in this microtask, before the paint.
        if (cachedTrigger === null) schedule(); // still looking for the launcher
        else if (!cachedTrigger.isConnected) reconcile();
        // Release a menu the user has closed. Nothing else would now that there is no
        // per-frame reconcile, and holding it would pin the detached subtree and keep
        // its row observer alive until the next open.
        if (currentMenu !== null && !currentMenu.isConnected) {
          currentMenu = null;
          stopWatchingMenuRows();
        }
        // A menu portal lands in this task; inject now, before the frame paints.
        attemptMenuInjection();
        // Deliberately no scheduled reconcile here: content changes are the trigger
        // observer's job and the row repair is the open menu's own observer's job, so
        // unrelated page mutations (every streamed token) wake nothing.
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("click", onClick, true);
      styleTag = injectStyles();
      reconcile();
      return function () {
        domAlive = false;
        if (currentFrame !== 0) cancelAnimationFrame(currentFrame);
        currentFrame = 0;
        if (bodyObserver !== null) bodyObserver.disconnect();
        if (triggerObserver !== null) triggerObserver.disconnect();
        bodyObserver = null;
        triggerObserver = null;
        observedTrigger = null;
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("click", onClick, true);
        // Remove the injected row and hand the shipped text back untouched.
        safe(function () {
          var rows = document.querySelectorAll("[" + ROW_ATTR + "]");
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].parentElement !== null) rows[i].parentElement.removeChild(rows[i]);
          }
        }, null);
        safe(function () {
          var trigger = accountTrigger();
          if (trigger === null) return;
          var node = labelNode(trigger);
          if (node === null) return;
          if (written !== null && node.textContent === written) writeText(node, shipped === null ? "" : shipped);
          written = null;
        }, null);
        // Hand the real avatar back and drop the scoped stylesheet.
        safe(function () {
          var trigger = accountTrigger();
          if (trigger === null) return;
          var node = avatarNode(trigger);
          if (node === null) return;
          node.removeAttribute(AVATAR_ATTR);
          node.style.backgroundImage = "";
        }, null);
        safe(function () {
          if (styleTag !== null && styleTag.parentNode !== null) styleTag.parentNode.removeChild(styleTag);
        }, null);
        avatarApplied = null;
        styleTag = null;
        stopWatchingMenuRows();
        currentMenu = null;
        menuWatch = null;
        cachedTrigger = null;
        knownMenus = [];
        sawPointerDown = false;
        // The overlay is disposed with the plugin; leaving this set would make a
        // later re-enable open the dialog the user never asked to reopen.
        state.open = false;
      };
    }

    // ------------------------------------------------------------ editor dialog

    // ------------------------------------------------------------ crop dialog

    /** Edge of the square crop viewport, in CSS pixels, before the small-screen clamp. */
    var CROP_VIEWPORT_SIZE = 300;
    /** How far past the cover scale the zoom slider may go. */
    var CROP_MAX_ZOOM = 6;
    /** No image measured yet: the crop dialog renders its loading state. */
    var EMPTY_CROP_VIEW = { scale: 1, x: 0, y: 0, size: 0, min: 1, imgW: 0, imgH: 0 };

    var CROP_ROOT_STYLE = {
      position: "fixed",
      inset: "0",
      zIndex: 1300,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "max(24px, var(--dsh-frame-overlay-top, 24px)) 24px"
    };
    var CROP_CARD_STYLE = {
      position: "relative",
      zIndex: 1,
      boxSizing: "border-box",
      width: "min(360px, 100%)",
      maxHeight: "100%",
      minHeight: "0",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      padding: "20px 20px 16px",
      font: "inherit",
      color: "var(--dsw-alias-label-primary, inherit)",
      background: "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-overlay, #2b2b2b))",
      border: "1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.25))",
      borderRadius: "var(--dsw-radius-panel, 14px)",
      boxShadow: "var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.35))"
    };
    var CROP_VIEW_STYLE = {
      position: "relative",
      flex: "none",
      // A fixed square: the crop math and the layout then use the same number, so
      // no measurement drift can leave an uncovered strip.
      width: CROP_VIEWPORT_SIZE + "px",
      maxWidth: "100%",
      aspectRatio: "1 / 1",
      overflow: "hidden",
      // The avatar is rendered in a circle, so the crop viewport is one too: what
      // the user frames is exactly what the round preview will show.
      borderRadius: "50%",
      boxShadow: "inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
      background: "var(--dsw-alias-bg-base, #111)",
      cursor: "grab",
      touchAction: "none",
      userSelect: "none"
    };
    /** Centres the round viewport inside the card without relying on auto margins. */
    var CROP_VIEW_FRAME_STYLE = { display: "flex", justifyContent: "center", width: "100%" };
    var CROP_ZOOM_ROW_STYLE = { display: "flex", alignItems: "center", gap: "10px" };
    var CROP_ZOOM_LABEL_STYLE = {
      flex: "none",
      fontSize: "12px",
      lineHeight: "18px",
      color: "var(--dsw-alias-label-secondary, inherit)"
    };
    var CROP_RANGE_STYLE = {
      flex: "1 1 auto",
      minWidth: "0",
      accentColor: "var(--dsw-alias-button-primary-fill, #4d6bfe)"
    };

    /**
     * The preview surface: the picture is drawn here rather than laid out as an
     * element.
     *
     * A DOM `<img>` obeys the box it lands in, so a viewport that measured
     * differently from its final layout left uncovered strips. Drawing with the
     * same numbers the crop uses removes that class of failure: what is painted
     * is `drawImage(image, x, y, w, h)` over a square, exactly like the export.
     */
    var CROP_CANVAS_STYLE = { display: "block", width: "100%", height: "100%" };

    var ROOT_STYLE = {
      position: "fixed",
      inset: "0",
      zIndex: 1200,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      // Same overlay inset the shell's own Modal uses, so the mask stays clear
      // of the native window caption while still blocking clicks behind it.
      padding: "max(24px, var(--dsh-frame-overlay-top, 24px)) 24px"
    };
    var PAINT_STYLE = {
      position: "absolute",
      inset: "var(--dsh-frame-chrome-top, 0px) 0 0",
      background: "var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.35))",
      backdropFilter: "var(--dsw-mask-blur, blur(2px))"
    };
    var CARD_STYLE = {
      position: "relative",
      zIndex: 1,
      boxSizing: "border-box",
      width: "min(380px, 100%)",
      // The root already pads for the frame's overlay inset, so `100%` is the real
      // available height; scrolling here keeps a short window from clipping the
      // footer instead of pushing the card out of view.
      maxHeight: "100%",
      minHeight: "0",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      padding: "20px 20px 16px",
      font: "inherit",
      color: "var(--dsw-alias-label-primary, inherit)",
      background: "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-overlay, #2b2b2b))",
      border: "1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.25))",
      borderRadius: "var(--dsw-radius-panel, 14px)",
      boxShadow: "var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.35))"
    };
    var TITLE_STYLE = { margin: "0", fontSize: "15px", lineHeight: "22px", fontWeight: 500 };
    var INPUT_STYLE = {
      boxSizing: "border-box",
      width: "100%",
      padding: "7px 34px 7px 10px",
      font: "inherit",
      fontSize: "14px",
      lineHeight: "20px",
      color: "var(--dsw-alias-label-primary, inherit)",
      background: "var(--dsw-alias-bg-base, transparent)",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
      borderRadius: "var(--dsw-radius-md, 8px)",
      outline: "none"
    };
    var INPUT_WRAP_STYLE = { position: "relative", display: "flex", width: "100%" };
    var HINT_STYLE = {
      fontSize: "12px",
      lineHeight: "18px",
      color: "var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 1))"
    };
    var FOOTER_STYLE = { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" };
    var SPACER_STYLE = { flex: "1 1 auto" };
    /**
     * Buttons are classed rather than inline-styled: inline styles cannot express
     * hover/active/focus, and these classes carry the shell's own Button tokens.
     */
    var BUTTON_PRIMARY_CLASS = "dsh-adn-btn dsh-adn-btn--primary";
    var BUTTON_GHOST_CLASS = "dsh-adn-btn dsh-adn-btn--ghost";
    var AVATAR_ROW_STYLE = { display: "flex", alignItems: "center", gap: "12px" };
    var AVATAR_ACTIONS_STYLE = { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" };
    var FILE_INPUT_STYLE = { display: "none" };
    var ERROR_STYLE = {
      fontSize: "12px",
      lineHeight: "18px",
      color: "var(--dsw-alias-state-error-primary, #e5484d)"
    };

    /** The 48px round preview: the pending image, or an empty placeholder disc. */
    function avatarPreviewStyle(dataUrl) {
      return {
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: "48px",
        height: "48px",
        // A square box with a circular clip: without the explicit ratio and the
        // hidden overflow a flex row can compress the box and the circle reads as
        // flattened at the top and bottom.
        aspectRatio: "1 / 1",
        overflow: "hidden",
        lineHeight: 0,
        borderRadius: "50%",
        border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
        color: "var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.9))",
        backgroundColor:
          dataUrl === "" ? "var(--dsw-alias-bg-skeleton, rgba(128, 128, 128, 0.18))" : "transparent",
        backgroundImage: dataUrl === "" ? "none" : 'url("' + dataUrl + '")',
        backgroundPosition: "50% 50%",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat"
      };
    }

    /**
     * The editor, mounted on `shell.overlay` and inert until the menu row opens
     * it. It renders nothing (and registers nothing) while closed, so it costs
     * one empty slot entry at rest.
     */
    function DisplayNameOverlay() {
      var alias = React.useSyncExternalStore(subscribe, getAlias, getAlias);
      var avatar = React.useSyncExternalStore(subscribe, getAvatar, getAvatar);
      var open = React.useSyncExternalStore(subscribe, isEditorOpen, isEditorOpen);
      var draftState = React.useState("");
      var draft = draftState[0];
      var setDraft = draftState[1];
      var draftAvatarState = React.useState("");
      var draftAvatar = draftAvatarState[0];
      var setDraftAvatar = draftAvatarState[1];
      var errorState = React.useState(null);
      var avatarError = errorState[0];
      var setAvatarError = errorState[1];
      var inputRef = React.useRef(null);
      var fileRef = React.useRef(null);
      var cardRef = React.useRef(null);
      var chooseRef = React.useRef(null);
      var cropCardRef = React.useRef(null);
      var cropApplyRef = React.useRef(null);
      var cropViewRef = React.useRef(null);
      var cropCanvasRef = React.useRef(null);
      var cropImgRef = React.useRef(null);
      var cropDragRef = React.useRef(null);
      var cropImageInfoRef = React.useRef(null);
      var cropState = React.useState(null);
      var crop = cropState[0];
      var setCrop = cropState[1];
      var cropViewState = React.useState(EMPTY_CROP_VIEW);
      var cropView = cropViewState[0];
      var setCropView = cropViewState[1];
      /**
       * The latest crop layout, readable from listeners created on an earlier
       * render (ResizeObserver, resize). Reading the render closure there would
       * re-lay the picture from a stale viewport size.
       */
      var cropViewLiveRef = React.useRef(cropView);
      cropViewLiveRef.current = cropView;
      /**
       * Whether the crop dialog is in front. The document-level key handler is
       * registered once for the editor, so it reads this ref instead of closing
       * over a value that would be stale.
       */
      var croppingRef = React.useRef(false);
      croppingRef.current = crop !== null;

      React.useEffect(
        function () {
          if (!open) return;
          setDraft(alias);
          setDraftAvatar(avatar);
          setAvatarError(null);
        },
        [open, alias, avatar]
      );

      React.useEffect(
        function () {
          if (!open) return undefined;
          var input = inputRef.current;
          if (input !== null) {
            safe(function () {
              input.focus();
              input.select();
            }, null);
          }
          // Capture on document: closes the dialog and keeps the Escape from
          // reaching the frame's own shortcuts while a dialog is in front.
          var onKeyDown = function (event) {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              // The crop dialog sits in front: Escape dismisses it and leaves the
              // editor (and its drafts) exactly where they were.
              if (croppingRef.current) setCrop(null);
              else setEditorOpen(false);
              return;
            }
            if (event.key !== "Tab") return;
            var card = croppingRef.current ? cropCardRef.current : cardRef.current;
            if (card === null) return;
            // Keep Tab inside the dialog: everything behind the mask is still in
            // the tab order, so without this focus walks out of a modal.
            var focusable = [];
            var candidates = card.querySelectorAll("button, input");
            for (var i = 0; i < candidates.length; i++) {
              var element = candidates[i];
              if (element.disabled || element.tabIndex < 0) continue;
              focusable.push(element);
            }
            if (focusable.length === 0) {
              event.preventDefault();
              return;
            }
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            var active = document.activeElement;
            var inside = card.contains(active) === true;
            if (event.shiftKey) {
              if (!inside || active === first) {
                event.preventDefault();
                last.focus();
              }
              return;
            }
            if (!inside || active === last) {
              event.preventDefault();
              first.focus();
            }
          };
          document.addEventListener("keydown", onKeyDown, true);
          return function () {
            document.removeEventListener("keydown", onKeyDown, true);
          };
        },
        [open]
      );

      // Focus follows whichever card is in front: the crop dialog while it is
      // open, then back to the picker button that opened it.
      var cropWasOpen = React.useRef(false);
      React.useEffect(
        function () {
          if (crop !== null) {
            cropWasOpen.current = true;
            if (cropApplyRef.current !== null) cropApplyRef.current.focus();
            return;
          }
          if (!cropWasOpen.current) return;
          cropWasOpen.current = false;
          if (!open) return;
          if (chooseRef.current !== null) chooseRef.current.focus();
        },
        [open, crop]
      );

      // The crop card can settle to a different width after its first frame
      // (font swap, scrollbar, a short window). Re-lay the picture when it does,
      // instead of leaving the image sized for the earlier, smaller viewport.
      React.useEffect(
        function () {
          if (crop === null) return undefined;
          var node = cropViewRef.current;
          if (node === null) return undefined;
          var remeasure = function () {
            applyCropSize(measureCropView());
          };
          if (typeof ResizeObserver === "function") {
            var observer = new ResizeObserver(remeasure);
            observer.observe(node);
            return function () {
              observer.disconnect();
            };
          }
          window.addEventListener("resize", remeasure);
          return function () {
            window.removeEventListener("resize", remeasure);
          };
        },
        [crop]
      );

      /** Paint the current crop into the preview canvas. */
      var drawCropPreview = function () {
        var canvas = cropCanvasRef.current;
        var image = cropImgRef.current;
        var view = cropViewLiveRef.current;
        if (canvas === null || image === null || view.imgW <= 0) return;
        var ratio =
          typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0
            ? window.devicePixelRatio
            : 1;
        var edge = CROP_VIEWPORT_SIZE;
        var pixels = Math.round(edge * ratio);
        if (canvas.width !== pixels || canvas.height !== pixels) {
          canvas.width = pixels;
          canvas.height = pixels;
        }
        var context = safe(function () {
          return canvas.getContext("2d");
        }, null);
        if (context === null) return;
        // The layout is in viewport units; the canvas is drawn in its own fixed
        // square, so scale by the ratio between them. Cover is preserved either way.
        var unit = edge / (view.size > 0 ? view.size : edge);
        safe(function () {
          if (typeof context.setTransform === "function") context.setTransform(ratio, 0, 0, ratio, 0, 0);
          if (typeof context.clearRect === "function") context.clearRect(0, 0, edge, edge);
          context.drawImage(
            image,
            view.x * unit,
            view.y * unit,
            view.imgW * view.scale * unit,
            view.imgH * view.scale * unit
          );
        }, null);
      };

      // Redraw whenever the framing changes. Declared before the closed-editor
      // early return so the hook count stays constant across renders.
      React.useEffect(
        function () {
          if (crop === null) return;
          drawCropPreview();
        },
        [crop, cropView]
      );

      if (!open) return null;
      var text = strings();

      var chooseAvatar = function () {
        var input = fileRef.current;
        if (input === null) return;
        safe(function () {
          input.click();
        }, null);
      };
      var clearAvatar = function () {
        setDraftAvatar("");
        setAvatarError(null);
      };
      var onAvatarFile = function (event) {
        var input = event.target;
        var file = input.files !== null && input.files.length > 0 ? input.files[0] : null;
        // Clear the control so picking the same file twice still fires a change.
        safe(function () {
          input.value = "";
        }, null);
        if (file === null) return;
        setAvatarError(null);
        readAvatarSource(file, function (dataUrl, failure) {
          if (dataUrl === null) {
            var copy = strings();
            setAvatarError(copy[failure] || copy.avatarFailed);
            return;
          }
          // Open the crop dialog instead of applying the pick: nothing reaches the
          // draft until the user confirms the square they framed.
          setCropView(EMPTY_CROP_VIEW);
          setCrop({ src: dataUrl });
        });
      };

      /** Keep the picture covering the square: never leave an empty edge. */
      var clampCropView = function (next) {
        var width = next.imgW * next.scale;
        var height = next.imgH * next.scale;
        return {
          scale: next.scale,
          x: Math.min(0, Math.max(next.size - width, next.x)),
          y: Math.min(0, Math.max(next.size - height, next.y)),
          size: next.size,
          min: next.min,
          imgW: next.imgW,
          imgH: next.imgH
        };
      };

      /** Zoom around the square's centre, so the framed point stays put. */
      var zoomCropTo = function (target) {
        var view = cropView;
        if (view.imgW <= 0 || view.size <= 0) return;
        var scale = Math.min(view.min * CROP_MAX_ZOOM, Math.max(view.min, target));
        var centre = view.size / 2;
        var imageX = (centre - view.x) / view.scale;
        var imageY = (centre - view.y) / view.scale;
        setCropView(
          clampCropView({
            scale: scale,
            x: centre - imageX * scale,
            y: centre - imageY * scale,
            size: view.size,
            min: view.min,
            imgW: view.imgW,
            imgH: view.imgH
          })
        );
      };

      /** The viewport's laid-out edge, or 0 while the dialog is not rendered yet. */
      var measureCropView = function () {
        var node = cropViewRef.current;
        if (node === null) return 0;
        var rect = node.getBoundingClientRect();
        return Math.round((rect.width || 0) * 100) / 100;
      };

      /**
       * Lay the picture out for a viewport of `size` pixels.
       *
       * The first call centres it at the cover scale; later calls keep the same
       * framing while the viewport resizes (window resize, scrollbar, font load),
       * because a stale size is what left the picture short of the circle's right
       * and bottom edges.
       */
      var applyCropSize = function (size) {
        var view = cropViewLiveRef.current;
        var info = cropImageInfoRef.current;
        if (info === null || size <= 0) return;
        if (view.imgW <= 0 || view.size <= 0) {
          var cover = Math.max(size / info.width, size / info.height);
          setCropView({
            scale: cover,
            x: (size - info.width * cover) / 2,
            y: (size - info.height * cover) / 2,
            size: size,
            min: cover,
            imgW: info.width,
            imgH: info.height
          });
          return;
        }
        if (Math.abs(size - view.size) < 0.5) return;
        var ratio = size / view.size;
        setCropView({
          scale: view.scale * ratio,
          x: view.x * ratio,
          y: view.y * ratio,
          size: size,
          min: view.min * ratio,
          imgW: view.imgW,
          imgH: view.imgH
        });
      };

      var onCropImageLoad = function (event) {
        var image = event.currentTarget;
        var naturalWidth = image.naturalWidth || image.width || 0;
        var naturalHeight = image.naturalHeight || image.height || 0;
        if (naturalWidth <= 0 || naturalHeight <= 0) return;
        cropImgRef.current = image;
        cropImageInfoRef.current = { width: naturalWidth, height: naturalHeight };
        // Measure after the current frame: the first commit can run before the
        // card reaches its final width, and a size read there is what made the
        // picture stop short of the circle's bottom-right. If the viewport still
        // reports no width (a detached or unlaid-out tree), fall back to the
        // designed size once instead of spinning on animation frames.
        var attempts = 0;
        var settle = function () {
          var size = measureCropView();
          if (size <= 0 && attempts < 1) {
            attempts += 1;
            requestAnimationFrame(settle);
            return;
          }
          applyCropSize(size > 0 ? size : CROP_VIEWPORT_SIZE);
        };
        settle();
      };

      var onCropPointerDown = function (event) {
        if (cropView.imgW <= 0) return;
        cropDragRef.current = {
          pointer: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          x: cropView.x,
          y: cropView.y
        };
        safe(function () {
          event.currentTarget.setPointerCapture(event.pointerId);
        }, null);
      };

      var onCropPointerMove = function (event) {
        var drag = cropDragRef.current;
        var view = cropView;
        if (drag === null || drag.pointer !== event.pointerId || view.imgW <= 0) return;
        // The drag arrives in CSS pixels; the layout is in viewport units. Convert
        // with the viewport's current width so the picture tracks the pointer even
        // if it was measured at a different size.
        var actual = measureCropView();
        var unit = actual > 0 ? view.size / actual : 1;
        setCropView(
          clampCropView({
            scale: view.scale,
            x: drag.x + (event.clientX - drag.startX) * unit,
            y: drag.y + (event.clientY - drag.startY) * unit,
            size: view.size,
            min: view.min,
            imgW: view.imgW,
            imgH: view.imgH
          })
        );
      };

      var onCropPointerUp = function (event) {
        var drag = cropDragRef.current;
        if (drag === null || drag.pointer !== event.pointerId) return;
        cropDragRef.current = null;
        safe(function () {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }, null);
      };

      var onCropWheel = function (event) {
        if (cropView.imgW <= 0) return;
        event.preventDefault();
        zoomCropTo(cropView.scale * Math.exp(-event.deltaY * 0.0015));
      };

      var closeCrop = function () {
        // Cancel is a true no-op: the draft avatar keeps whatever it had before
        // the picker opened, and the editor stays open behind it.
        setCrop(null);
      };

      var applyCrop = function () {
        var view = cropView;
        var pending = crop;
        if (view.imgW <= 0 || pending === null) return;
        cropAvatar(pending.src, view, function (dataUrl, failure) {
          var copy = strings();
          if (dataUrl === null) {
            setAvatarError(copy[failure] || copy.avatarFailed);
            setCrop(null);
            return;
          }
          if (dataUrl.length > AVATAR_MAX_STORED_CHARS) {
            setAvatarError(copy.avatarTooLarge);
            setCrop(null);
            return;
          }
          setDraftAvatar(dataUrl);
          setAvatarError(null);
          setCrop(null);
        });
      };

      var commit = function () {
        var copy = strings();
        // The avatar is validated first so a rejected image never half-saves the name.
        if (!setAvatar(draftAvatar)) {
          setAvatarError(copy.avatarTooLarge);
          return;
        }
        var nextAlias = String(draft).replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
        if (!setAlias(nextAlias)) {
          setAvatarError(copy.saveFailed);
          return;
        }
        setEditorOpen(false);
      };
      var cancel = function () {
        setEditorOpen(false);
      };
      var clearName = function () {
        setDraft("");
        if (inputRef.current !== null) {
          safe(function () {
            inputRef.current.focus();
          }, null);
        }
      };

      return React.createElement(
        "div",
        {
          style: ROOT_STYLE,
          onMouseDown: function (event) {
            if (event.target === event.currentTarget) cancel();
          }
        },
        React.createElement("div", { style: PAINT_STYLE, "aria-hidden": "true" }),
        React.createElement(
          "div",
          {
            ref: cardRef,
            style: CARD_STYLE,
            role: "dialog",
            "aria-modal": "true",
            "aria-label": text.title
          },
          React.createElement("div", { style: TITLE_STYLE }, text.title),
          React.createElement(
            "div",
            { style: AVATAR_ROW_STYLE },
            React.createElement(
              "div",
              {
                style: avatarPreviewStyle(draftAvatar),
                "aria-hidden": "true",
                "data-dsh-avatar-preview": draftAvatar === "" ? "empty" : "set"
              },
              draftAvatar === "" ? AVATAR_PLACEHOLDER : null
            ),
            React.createElement(
              "div",
              { style: AVATAR_ACTIONS_STYLE },
              React.createElement("button", { ref: chooseRef, type: "button", className: BUTTON_GHOST_CLASS, onClick: chooseAvatar }, text.avatarChoose),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: BUTTON_GHOST_CLASS + " dsh-adn-btn--icon",
                  onClick: clearAvatar,
                  disabled: draftAvatar === "",
                  "aria-label": text.avatarClear,
                  title: text.avatarClear
                },
                TRASH_ICON
              )
            ),
            React.createElement("input", {
              ref: fileRef,
              type: "file",
              accept: "image/*",
              style: FILE_INPUT_STYLE,
              onChange: onAvatarFile,
              "aria-label": text.avatarChoose,
              tabIndex: -1
            })
          ),
          React.createElement(
            "div",
            { style: INPUT_WRAP_STYLE },
            React.createElement("input", {
              ref: inputRef,
              type: "text",
              value: draft,
              maxLength: MAX_LENGTH,
              spellCheck: false,
              autoComplete: "off",
              placeholder: text.placeholder,
              style: INPUT_STYLE,
              onChange: function (event) {
                setDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }
            }),
            draft === ""
              ? null
              : React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "dsh-adn-btn dsh-adn-btn--ghost dsh-adn-input-clear",
                    onClick: clearName,
                    "aria-label": text.nameClear,
                    title: text.nameClear
                  },
                  CLEAR_ICON
                )
          ),
          React.createElement("div", { style: HINT_STYLE }, text.hint),
          avatarError === null ? null : React.createElement("div", { style: ERROR_STYLE, role: "alert" }, avatarError),
          React.createElement(
            "div",
            { style: FOOTER_STYLE },
            React.createElement("span", { style: SPACER_STYLE }),
            React.createElement("button", { type: "button", className: BUTTON_GHOST_CLASS, onClick: cancel }, text.cancel),
            React.createElement("button", { type: "button", className: BUTTON_PRIMARY_CLASS, onClick: commit }, text.save)
          )
        ),
        crop === null
          ? null
          : React.createElement(
              "div",
              {
                style: CROP_ROOT_STYLE,
                onMouseDown: function (event) {
                  if (event.target === event.currentTarget) closeCrop();
                }
              },
              React.createElement("div", { style: PAINT_STYLE, "aria-hidden": "true" }),
              React.createElement(
                "div",
                {
                  ref: cropCardRef,
                  style: CROP_CARD_STYLE,
                  role: "dialog",
                  "aria-modal": "true",
                  "aria-label": text.cropTitle
                },
                React.createElement("div", { style: TITLE_STYLE }, text.cropTitle),
                React.createElement(
                  "div",
                  { style: CROP_VIEW_FRAME_STYLE },
                  React.createElement(
                    "div",
                    {
                      ref: cropViewRef,
                      style: CROP_VIEW_STYLE,
                      "data-dsh-crop-view": "1",
                      onPointerDown: onCropPointerDown,
                      onPointerMove: onCropPointerMove,
                      onPointerUp: onCropPointerUp,
                      onPointerCancel: onCropPointerUp,
                      onWheel: onCropWheel
                    },
                    React.createElement("canvas", {
                      ref: cropCanvasRef,
                      style: CROP_CANVAS_STYLE,
                      "aria-hidden": "true"
                    }),
                    React.createElement("img", {
                      ref: cropImgRef,
                      src: crop.src,
                      alt: "",
                      draggable: false,
                      onLoad: onCropImageLoad,
                      style: { display: "none" }
                    })
                  )
                ),
                cropView.imgW <= 0 ? React.createElement("div", { style: HINT_STYLE }, text.cropLoading) : null,
                React.createElement(
                  "div",
                  { style: CROP_ZOOM_ROW_STYLE },
                  React.createElement("span", { style: CROP_ZOOM_LABEL_STYLE }, text.cropZoom),
                  React.createElement("input", {
                    type: "range",
                    min: "1",
                    max: String(CROP_MAX_ZOOM),
                    step: "0.01",
                    value: cropView.imgW <= 0 ? 1 : cropView.scale / cropView.min,
                    disabled: cropView.imgW <= 0,
                    "aria-label": text.cropZoom,
                    style: CROP_RANGE_STYLE,
                    onChange: function (event) {
                      zoomCropTo(cropView.min * Number(event.target.value));
                    }
                  })
                ),
                React.createElement("div", { style: HINT_STYLE }, text.cropHint),
                React.createElement(
                  "div",
                  { style: FOOTER_STYLE },
                  React.createElement("span", { style: SPACER_STYLE }),
                  React.createElement("button", { type: "button", className: BUTTON_GHOST_CLASS, onClick: closeCrop }, text.cropCancel),
                  React.createElement(
                    "button",
                    {
                      ref: cropApplyRef,
                      type: "button",
                      className: BUTTON_PRIMARY_CLASS,
                      onClick: applyCrop,
                      disabled: cropView.imgW <= 0
                    },
                    text.cropApply
                  )
                )
              )
            )
      );
    }

    // -------------------------------------------------------------- plugin face

    var name = "account-display-name-edit";
    var inject = ["slots"];

    /** Entry id from cordis.patch.yml; only used for diagnostics. */
    var ENTRY_ID = "account-display-name-edit";

    function apply(ctx) {
      locale = safe(function () {
        return ctx.get("locale");
      }, null);
      loadAlias();
      loadAvatar();

      var disposers = [];
      safe(function () {
        disposers.push(
          ctx.slots.inject("shell.overlay", function () {
            return ctx.slots.register(
              {
                name: "shell.overlay",
                id: PLUGIN_ID + "-overlay",
                order: 50,
                inject: function () {
                  return {};
                }
              },
              DisplayNameOverlay
            );
          })
        );
      }, null);

      var disposeDom = null;
      safe(function () {
        if (document.body === null) return;
        disposeDom = mountDom();
      }, null);
      if (disposeDom === null) {
        safe(function () {
          ctx.logger.warn(ENTRY_ID + ": no document body to mount into; alias disabled");
        }, null);
      }

      ctx.effect(
        function () {
          return function () {
            safe(disposeDom, null);
            for (var i = 0; i < disposers.length; i++) safe(disposers[i], null);
          };
        },
        PLUGIN_ID + ": account label and avatar override, menu row and editor overlay"
      );
    }

    module.exports = { name: name, inject: inject, apply: apply };
    return module.exports;
  }
});
