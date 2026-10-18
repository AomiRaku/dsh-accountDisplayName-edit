# dsh-accountdisplayname-edit

Replaces the sidebar account label — the phone number or email DeepSeek Harness
shows at the bottom-left — with text you choose, so screenshots do not expose it.

The edit entry is a new **Edit display name** row in the account menu, the one you
open by clicking that label.

## What it does

- Replaces the account label text in the sidebar footer with a display name you set.
- Adds an **Edit display name** / **编辑显示名称** row to the account menu, directly
  under Settings.
- Opens a small editor dialog: Save, Cancel, Use default. `Enter` saves, `Esc` cancels.
- Saving an empty value restores the account's own text (the phone number or email).
- Stores the value per browser in `localStorage` under
  `dsh.account-display-name-edit.alias`.
- Display only. The account, the credentials and the profile are never read or
  changed, and the plugin makes no network requests of its own.

## Requirements

Built and verified against DSH `0.2.0-rc.2`. The host half imports nothing and the
browser half fails soft, so a build whose DOM has moved on degrades to "no alias,
no extra row" rather than an error — see [Compatibility](#compatibility).

## Install

### From the desktop app

The `desktop` profile is managed exclusively by the Electron application, so install
it there through the app's own plugin surface (Settings → Plugins, or `dshmarket`);
the CLI refuses that profile by design.

### From the CLI, for any profile the app does not own

```sh
dsh plugin --profile <profile> add github:AomiRaku/dsh-accountDisplayName-edit
```

There is **no build step and no `prepare` script**: the browser half is committed as
`lib/client.js`, so pnpm never asks for build approval and the install is a plain
file copy.

### Manually, which is exactly what the commands above do

1. Put the package where the profile resolves its bundles —
   `<DSH_HOME>/profiles/<profile>/node_modules/dsh-accountdisplayname-edit`.
   A directory junction/symlink to a checkout works.
2. Add this to `<DSH_HOME>/profiles/<profile>/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: account-display-name-edit
         name: dsh-accountdisplayname-edit
   ```

   That patch layer is watched, so it applies live — no restart needed.

## Use

1. Click the account row at the bottom of the sidebar.
2. Choose **Edit display name**.
3. Type the name you want and save. Save an empty value to go back to the
   account's own text.

## Uninstall

Remove the insert from `cordis.patch.yml` and delete the package directory. The
stored display name stays in the browser's `localStorage` until you clear it; the
plugin writes nothing else.

## How it works

A dual-face plugin whose host half does almost nothing.

- **Host half — `lib/index.js`.** Deliberately import-free. Its only job is to be a
  Loader entry, so the host's client-module scanner reads `dsh.client` from
  `package.json` and serves `./client` to the browser. With no dependencies and no
  `peerDependencies`, it cannot fail to load because of a missing, renamed or
  version-mismatched peer package.
- **Browser half — `lib/client.js`.** A hand-written single-file bundle, already in
  the `window.__ModuleLoader__.load({ id, factory })` form the module system serves
  verbatim, so the package needs no build. It requires only `react`, which the shell
  seeds as a platform module — which is why `react` is not a dependency either.

### Why the menu row is done in the DOM

`@deepseek-ai/dsh-client-ui-settings-account` renders that menu from a hard-coded
`items` array, and its only slot (`settings.launcher`, a `single` slot) is the
launcher row itself. Occupying that slot would delete 设置 / 意见反馈 / 退出登录, which
this plugin must not do. There is no menu-item slot to add to.

So the row is appended to the **open** menu's list, cloned from a shipped row — it
therefore inherits that build's exact markup, classes and styling. Appending one
node leaves React's own children untouched, and the row is removed with the menu
because React never tracked it.

Selectors use only stable identifiers, never the hashed CSS-module class prefixes:

- the launcher is `button[aria-haspopup="menu"][data-signed-out]`, an attribute the
  account component always writes; its text node is found by the `_label` suffix
  CSS modules keeps, falling back to "the last span in the button";
- the menu is a `div[role="menu"]` that the `Menu` primitive portals to `<body>`,
  identified as the one that appeared after the launcher was activated.

### Failing soft

Every DOM probe runs inside `try`/`catch`; when a probe misses, the plugin does
nothing — it never edits another node and never throws into the shell's plugin
loader. Clearing the name hands the account plugin's own text back.

The label is written through React's own text node (`nodeValue`, not
`textContent`), so later account refreshes stay observable instead of updating a
node React no longer owns.

## Compatibility

- `dsh.client.immediately: true` is required: the plugin works through side effects
  registered when its bundle materializes, so it belongs in the boot graph's
  immediate tier.
- No `engines.dsh` range is declared, on purpose. node-semver only admits a
  prerelease version when some comparator in the range shares its exact
  `major.minor.patch` tuple and itself carries a prerelease tag, so any range would
  silently exclude a later prerelease of the harness — the failure mode the
  awesome-dsh-plugin contributing guide warns about. Failing soft is the safer
  contract here.

## Verification

```sh
npm install
npm test
```

51 checks against a real DOM (jsdom + React 18.3.1):

- `test/dom.test.mjs` — 35 checks: the bundle wrapper contract, `apply()`
  registration, label replacement, re-application after the account half re-renders,
  menu-row injection (label, icon, dropped shortcut, insertion position, shipped rows
  untouched), row activation closing the menu and opening the dialog, save and reset,
  and disposal.
- `test/robustness.test.mjs` — 16 checks over the fail-soft paths: the account row
  gone entirely, the `_label` class renamed, the collapsed rail where the avatar is
  the only span, an English locale, a menu rendered before its rows exist, no
  `document.body`, the account span replaced by a React remount, and disposal after
  the account row was removed.

It was also verified in a live DSH `0.2.0-rc.2`: the host entry reaches
`fiberPhase: active`, and the running Web GUI's slot tree lists the plugin's
`shell.overlay` entry as active, which means the host served the bundle and the page
materialized and ran it.

## Store listing

The awesome-dsh-plugin entry is ready to copy:

```text
store-entry/data/plugins/AomiRaku__dsh-accountDisplayName-edit.yml
  -> data/plugins/AomiRaku__dsh-accountDisplayName-edit.yml
```

That one file, added to a fork of
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), is
the whole submission — do not edit the generated READMEs by hand.

Screenshots are optional. When you have them, add a `screenshots.json` next to
`package.json` listing 1–8 repository-relative image paths; storefronts show them in
that order and fall back to images in this README when the file is absent.

```json
["assets/screenshot-1.png", "assets/screenshot-2.png"]
```

## Known limitations

- The menu row depends on the shipped account-menu DOM. A future release that
  restructures it silently drops the row (the label replacement keeps working until
  the launcher markup changes too); nothing breaks.
- The display name lives in this browser's `localStorage`, so it is per-origin and
  not synced across machines. It never reaches the account.
- Only Simplified Chinese and English strings are bundled; the row follows the
  client locale and falls back to Chinese.

## License

MIT
