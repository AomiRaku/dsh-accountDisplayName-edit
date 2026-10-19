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
        nameLabel: "显示名称",
        hint: "只改本机显示，不会同步到账号。留空保存即恢复显示账号原名。",
        placeholder: "例如：小明",
        avatarLabel: "头像",
        avatarChoose: "选择图片…",
        avatarClear: "清除头像",
        avatarHint: "PNG / JPG / WebP，会自动裁成正方形并缩小后保存在本机。",
        avatarTooLarge: "图片太大，请换一张 10 MB 以内、尺寸小一些的。",
        avatarFailed: "这张图片读不出来，换一张试试。",
        save: "保存",
        cancel: "取消",
        reset: "恢复默认"
      },
      en: {
        row: "Edit display name",
        title: "Edit name and avatar",
        nameLabel: "Display name",
        hint: "Shown on this device only. Save an empty value to show the account name again.",
        placeholder: "e.g. Alex",
        avatarLabel: "Avatar",
        avatarChoose: "Choose image…",
        avatarClear: "Clear avatar",
        avatarHint: "PNG / JPG / WebP. Cropped square, downscaled, and kept on this device.",
        avatarTooLarge: "That image is too large — pick one under 10 MB and smaller in pixels.",
        avatarFailed: "That image could not be read. Try another one.",
        save: "Save",
        cancel: "Cancel",
        reset: "Use default"
      }
    };

    var EDIT_ICON =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4.5 19.5h3.6L18.9 8.7a1.9 1.9 0 0 0 0-2.7l-1.8-1.8a1.9 1.9 0 0 0-2.7 0L3.6 15.9v3.6Z"/>' +
      '<path d="M13.2 6.1 17.9 10.8"/></svg>';

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

    function setAlias(next) {
      var value = typeof next === "string" ? next.slice(0, MAX_LENGTH) : "";
      state.alias = value;
      safe(function () {
        if (value === "") window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, value);
      }, null);
      emit();
      reconcile();
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

    function accountTrigger() {
      return safe(function () {
        return document.querySelector(TRIGGER_SELECTOR) || document.querySelector(TRIGGER_FALLBACK);
      }, null);
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
        "[" + AVATAR_ATTR + '="1"]>*{display:none !important}' +
        "[" + AVATAR_ATTR + '="1"]{background-size:cover !important;background-position:50% 50% !important;background-repeat:no-repeat !important}';
      safe(function () {
        document.head.appendChild(tag);
      }, null);
      return tag;
    }

    /** Centre-crop a decoded image square and re-encode it small enough to store. */
    function shrinkAvatar(dataUrl, done) {
      var image = new Image();
      image.onerror = function () {
        done(null, "avatarFailed");
      };
      image.onload = function () {
        var width = image.naturalWidth || image.width || 0;
        var height = image.naturalHeight || image.height || 0;
        if (width <= 0 || height <= 0) {
          done(null, "avatarFailed");
          return;
        }
        var canvas = document.createElement("canvas");
        var context = null;
        safe(function () {
          context = canvas.getContext("2d");
        }, null);
        if (context === null) {
          // No 2D canvas available: keep the original bytes rather than fail.
          done(dataUrl);
          return;
        }
        var size = AVATAR_DIMENSION;
        canvas.width = size;
        canvas.height = size;
        var scale = Math.max(size / width, size / height);
        var drawWidth = Math.round(width * scale);
        var drawHeight = Math.round(height * scale);
        safe(function () {
          context.drawImage(image, Math.round((size - drawWidth) / 2), Math.round((size - drawHeight) / 2), drawWidth, drawHeight);
        }, null);
        var encoded = safe(function () {
          return canvas.toDataURL("image/png");
        }, null);
        done(typeof encoded === "string" && encoded.indexOf("data:image/") === 0 ? encoded : dataUrl);
      };
      image.src = dataUrl;
    }

    /** Read one picked file into a storable avatar, reporting a localized failure key. */
    function readAvatarFile(file, done) {
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
        shrinkAvatar(dataUrl, function (result, failure) {
          if (result !== null && result.length > AVATAR_MAX_STORED_CHARS) {
            done(null, "avatarTooLarge");
            return;
          }
          done(result, failure);
        });
      };
      reader.readAsDataURL(file);
    }

    // ------------------------------------------------------ the account menu row

    var currentMenu = null; // the open account menu we injected into
    var knownMenus = []; // menus already open when the launcher was pressed
    var sawPointerDown = false; // whether `knownMenus` is an authoritative snapshot
    var currentFrame = 0; // pending rAF handle

    /** Menus the Menu primitive portals to <body>; submenus stay nested and are skipped. */
    function openMenus() {
      var found = safe(function () {
        return Array.prototype.slice.call(document.querySelectorAll('div[role="menu"]'));
      }, []);
      var portaled = [];
      for (var i = 0; i < found.length; i++) {
        var host = found[i].parentElement;
        if (host === document.body || String(found[i].className).indexOf("_portal") >= 0) portaled.push(found[i]);
      }
      return portaled.length > 0 ? portaled : found;
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

      var shortcut = clone.querySelector('[class*="_shortcut"]') || clone.querySelector('[aria-hidden="true"]');
      if (shortcut !== null && shortcut.parentElement !== null) shortcut.parentElement.removeChild(shortcut);

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

      if (label !== null) label.textContent = strings().row;
      if (icon !== null) icon.innerHTML = EDIT_ICON;
      button.removeAttribute("aria-keyshortcuts");
      button.removeAttribute("disabled");
      button.disabled = false;
      clone.setAttribute(ROW_ATTR, "1");
      button.addEventListener("click", onRowActivate, true);

      // Sit directly under 设置, matching the order the shipped rows read in.
      var rows = viewport.children;
      if (rows.length >= 2) viewport.insertBefore(clone, rows[1]);
      else viewport.appendChild(clone);
    }

    /**
     * Close the menu before opening the editor. The Menu primitive closes on a
     * document-level Escape (it also returns focus to the launcher), with a
     * synthetic outside pointerdown as the fallback if something swallowed it.
     */
    function closeMenu() {
      var menu = currentMenu;
      currentMenu = null;
      safe(function () {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }, null);
      if (menu === null) return;
      window.setTimeout(function () {
        if (!menu.isConnected) return;
        safe(function () {
          var Ctor = window.PointerEvent || window.MouseEvent;
          if (typeof Ctor !== "function") return;
          document.body.dispatchEvent(new Ctor("pointerdown", { bubbles: true }));
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

    /**
     * The launcher's menu is portaled to <body> after the click, so it is found by
     * polling. Only a menu that was *not* open when the launcher was pressed
     * qualifies; when no pointerdown was seen (keyboard activation) there is no
     * snapshot and any open menu is a candidate. The snapshot is never used as a
     * fallback: latching onto an already-open unrelated menu would put the row in
     * the wrong list.
     */
    function pollForMenu(trigger, attempt, useSnapshot) {
      var menus = openMenus();
      var candidates = [];
      for (var i = 0; i < menus.length; i++) {
        if (!useSnapshot || knownMenus.indexOf(menus[i]) < 0) candidates.push(menus[i]);
      }

      var menu = nearestMenu(trigger, candidates);
      if (menu !== null) {
        currentMenu = menu;
        knownMenus = [];
        injectRow(menu);
        return;
      }
      if (attempt < MENU_POLL_FRAMES) {
        requestAnimationFrame(function () {
          pollForMenu(trigger, attempt + 1, useSnapshot);
        });
      } else {
        knownMenus = [];
      }
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
      triggerObserver = new MutationObserver(schedule);
      triggerObserver.observe(trigger, { childList: true, characterData: true, subtree: true });
    }

    function reconcile() {
      var trigger = accountTrigger();
      observeTrigger(trigger);
      if (trigger !== null) {
        applyLabel(trigger);
        applyAvatar(trigger);
      }
      if (currentMenu !== null && currentMenu.isConnected) injectRow(currentMenu);
      else currentMenu = null;
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
      pollForMenu(trigger, 0, useSnapshot);
    }

    function mountDom() {
      bodyObserver = new MutationObserver(schedule);
      bodyObserver.observe(document.body, { childList: true, subtree: true });
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("click", onClick, true);
      styleTag = injectStyles();
      reconcile();
      return function () {
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
        currentMenu = null;
        knownMenus = [];
        sawPointerDown = false;
      };
    }

    // ------------------------------------------------------------ editor dialog

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
      padding: "7px 10px",
      font: "inherit",
      fontSize: "14px",
      lineHeight: "20px",
      color: "var(--dsw-alias-label-primary, inherit)",
      background: "var(--dsw-alias-bg-base, transparent)",
      border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
      borderRadius: "var(--dsw-radius-md, 8px)",
      outline: "none"
    };
    var HINT_STYLE = {
      fontSize: "12px",
      lineHeight: "18px",
      color: "var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 1))"
    };
    var FOOTER_STYLE = { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" };
    var SPACER_STYLE = { flex: "1 1 auto" };
    var BUTTON_BASE = {
      appearance: "none",
      border: "0",
      cursor: "pointer",
      font: "inherit",
      fontSize: "14px",
      lineHeight: "20px",
      padding: "6px 14px",
      borderRadius: "var(--dsw-radius-md, 8px)"
    };
    var PRIMARY_STYLE = Object.assign({}, BUTTON_BASE, {
      background: "var(--dsw-alias-brand-primary, #4d6bfe)",
      color: "#ffffff"
    });
    var GHOST_STYLE = Object.assign({}, BUTTON_BASE, {
      padding: "6px 12px",
      background: "transparent",
      color: "var(--dsw-alias-label-secondary, inherit)"
    });
    var DISABLED_GHOST_STYLE = Object.assign({}, GHOST_STYLE, {
      cursor: "default",
      opacity: "0.45"
    });
    var CAPTION_STYLE = {
      fontSize: "12px",
      lineHeight: "18px",
      fontWeight: 500,
      color: "var(--dsw-alias-label-secondary, inherit)",
      marginBottom: "-4px"
    };
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
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))",
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
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setEditorOpen(false);
          };
          document.addEventListener("keydown", onKeyDown, true);
          return function () {
            document.removeEventListener("keydown", onKeyDown, true);
          };
        },
        [open]
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
        readAvatarFile(file, function (dataUrl, failure) {
          if (dataUrl === null) {
            var copy = strings();
            setAvatarError(copy[failure] || copy.avatarFailed);
            return;
          }
          setDraftAvatar(dataUrl);
        });
      };

      var commit = function () {
        // The avatar is validated first so a rejected image never half-saves the name.
        if (!setAvatar(draftAvatar)) {
          setAvatarError(strings().avatarTooLarge);
          return;
        }
        setAlias(String(draft).replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH));
        setEditorOpen(false);
      };
      var cancel = function () {
        setEditorOpen(false);
      };
      var reset = function () {
        setAvatar("");
        setAlias("");
        setEditorOpen(false);
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
            style: CARD_STYLE,
            role: "dialog",
            "aria-modal": "true",
            "aria-label": text.title
          },
          React.createElement("div", { style: TITLE_STYLE }, text.title),
          React.createElement("div", { style: CAPTION_STYLE }, text.avatarLabel),
          React.createElement(
            "div",
            { style: AVATAR_ROW_STYLE },
            React.createElement("div", {
              style: avatarPreviewStyle(draftAvatar),
              "aria-hidden": "true",
              "data-dsh-avatar-preview": draftAvatar === "" ? "empty" : "set"
            }),
            React.createElement(
              "div",
              { style: AVATAR_ACTIONS_STYLE },
              React.createElement("button", { type: "button", style: GHOST_STYLE, onClick: chooseAvatar }, text.avatarChoose),
              React.createElement(
                "button",
                {
                  type: "button",
                  style: draftAvatar === "" ? DISABLED_GHOST_STYLE : GHOST_STYLE,
                  onClick: clearAvatar,
                  disabled: draftAvatar === ""
                },
                text.avatarClear
              )
            ),
            React.createElement("input", {
              ref: fileRef,
              type: "file",
              accept: "image/png,image/jpeg,image/webp,image/gif,image/avif",
              style: FILE_INPUT_STYLE,
              onChange: onAvatarFile,
              "aria-label": text.avatarChoose,
              tabIndex: -1
            })
          ),
          React.createElement("div", { style: HINT_STYLE }, text.avatarHint),
          React.createElement("div", { style: CAPTION_STYLE }, text.nameLabel),
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
          React.createElement("div", { style: HINT_STYLE }, text.hint),
          avatarError === null ? null : React.createElement("div", { style: ERROR_STYLE, role: "alert" }, avatarError),
          React.createElement(
            "div",
            { style: FOOTER_STYLE },
            React.createElement("button", { type: "button", style: GHOST_STYLE, onClick: reset }, text.reset),
            React.createElement("span", { style: SPACER_STYLE }),
            React.createElement("button", { type: "button", style: GHOST_STYLE, onClick: cancel }, text.cancel),
            React.createElement("button", { type: "button", style: PRIMARY_STYLE, onClick: commit }, text.save)
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
