/**
 * dsh-accountdisplayname-edit — host half.
 *
 * The whole feature lives in the browser half: the sidebar account row and the
 * menu it opens are rendered by two other client plugins, and neither exposes an
 * extension slot, so the edit row is appended to the open menu's DOM instead.
 * Nothing here needs host state — the display name is stored in the page's
 * `localStorage` — so this half exists purely as the Loader entry the host's
 * client-module scanner reads `dsh.client` from in order to serve `./client`.
 *
 * Deliberately import-free: the package declares no dependencies and no
 * peerDependencies, so it cannot fail to load because of a missing, renamed, or
 * version-mismatched peer package.
 */

/** Loader-visible plugin name; must match the entry id in cordis.patch.yml. */
export const name = 'account-display-name-edit';

/**
 * No host services are required. Declared explicitly so the intent is obvious
 * and a future host-side need shows up as a diff rather than a silent addition.
 */
export const inject = [];

/**
 * Inert on purpose. Activation is not required for the browser half to load:
 * `dsh.client.immediately` in package.json puts the bundle in the boot graph's
 * immediate tier on its own.
 */
export function apply() {}
