/**
 * @fileoverview AppCtx - shared registry for the Hydravion webOS TV app.
 * Loaded BEFORE app.js. Holds cross-view shared state, utility helpers, and
 * the per-view modules (js/views/*.js) so views can call each other without
 * one giant closure in app.js.
 *
 * Pattern: per-view file split (Hydravion-Smart-TV structure), webOS-only.
 */
window.AppCtx = {
	/** Shared mutable state - app.js owns the values, views read/write here. */
	state: {},
	/** Shared utility helpers (DOM, formatting, caching, resume). */
	util: {},
	/**
	 * Per-view modules, registered by js/views/*.js as IIFEs.
	 * Typo guard: reading an unregistered view throws a clear error instead
	 * of the opaque "is not a function" crash. Views only SET here at load,
	 * so get-before-set can't happen during script loading.
	 */
	views: new Proxy(
		{},
		{
			get(t, p) {
				if (typeof p === "symbol" || p in t) return t[p];
				throw new TypeError("AppCtx.views." + String(p) + " is not registered");
			},
			set(t, p, v) {
				t[p] = v;
				return true;
			},
		},
	),
};
