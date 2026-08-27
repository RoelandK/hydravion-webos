// Smoke test: loads scripts in index.html order with DOM stubs, verifies
// AppCtx registry wiring (views registered, no reference errors at load).
// Usage: node scripts/smoke-load.js  (from repo root)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Minimal DOM/global stubs sufficient for top-level code (script load only).
const elements = {};
const makeEl = () => ({
	classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
	addEventListener() {},
	querySelector: () => null,
	querySelectorAll: () => [],
	appendChild() {},
	removeChild() {},
	setAttribute() {},
	style: {},
	focus() {},
	click() {},
	textContent: "",
	innerHTML: "",
	scrollWidth: 0,
	clientWidth: 0,
});
const documentStub = {
	getElementById: (id) => elements[id] || (elements[id] = makeEl()),
	querySelector: () => null,
	querySelectorAll: () => [],
	createElement: () => makeEl(),
	addEventListener() {},
	activeElement: null,
};
const windowStub = {
	addEventListener() {},
	setInterval: () => 0,
	clearInterval() {},
	setTimeout: () => 0,
	clearTimeout() {},
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
};
windowStub.window = windowStub;
windowStub.document = documentStub;

const sandbox = {
	window: windowStub,
	document: documentStub,
	localStorage: {
		getItem: () => null,
		setItem() {},
		removeItem() {},
		key: () => null,
		length: 0,
	},
	Promise,
	WeakMap,
	JSON,
	Date,
	Math,
	console,
	setInterval: () => 0,
	clearInterval() {},
	setTimeout: () => 0,
	clearTimeout() {},
	webOS: undefined,
	LiveView: { exit() {} },
	HydravionPlayer: {
		getPlayer: () => null,
		getLastUrl: () => "",
		play() {},
		pause() {},
	},
	FloatplaneAPI: { isLoggedIn: () => false },
	WebOSKeys: undefined, // set by keymap.js
	AppCtx: undefined, // set by app-ctx.js
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox; // in a browser, window IS the global object
vm.createContext(sandbox);

// Load order mirrors index.html
const scripts = [
	"js/keymap.js",
	"js/app-ctx.js",
	"js/api.js",
	"js/player.js",
	"js/chat.js",
	"js/live.js",
	"js/sidebar.js",
	"js/views/login.js",
	"js/views/notifications.js",
	"js/views/browse.js",
	"js/views/creator.js",
	"js/views/details.js",
	"js/views/history.js",
	"js/views/watchlater.js",
	"js/views/activity.js",
	"js/views/account.js",
	"js/views/discover.js",
	"js/views/player.js",
	"js/views/search.js",
	"js/views/settings.js",
	"js/app.js",
];
for (const rel of scripts) {
	const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
	try {
		vm.runInContext(code, sandbox, { filename: rel });
		console.log("OK   " + rel);
	} catch (e) {
		console.error("FAIL " + rel + ": " + e.message);
		process.exit(1);
	}
}

const ctx = sandbox.AppCtx;
const ok =
	ctx &&
	ctx.views.settings &&
	typeof ctx.views.settings.showSettings === "function" &&
	typeof ctx.views.settings.hideSettings === "function" &&
	ctx.views.login &&
	typeof ctx.views.login.startLogin === "function" &&
	ctx.views.notifications &&
	typeof ctx.views.notifications._startNotificationPolling === "function" &&
	typeof ctx.views.notifications._stopNotificationPolling === "function" &&
	ctx.views.search &&
	typeof ctx.views.search.doSearch === "function" &&
	typeof ctx.views.search.doCreatorSearch === "function" &&
	ctx.views.details &&
	typeof ctx.views.details.showDetails === "function" &&
	typeof ctx.views.details.showResolutionPicker === "function" &&
	ctx.views.creator &&
	typeof ctx.views.creator.showCreator === "function" &&
	ctx.views.browse &&
	typeof ctx.views.browse.renderBrowse === "function" &&
	typeof ctx.views.browse._loadMore === "function" &&
	ctx.views.history &&
	typeof ctx.views.history.showHistory === "function" &&
	ctx.views.watchlater &&
	typeof ctx.views.watchlater.showWatchLater === "function" &&
	ctx.views.activity &&
	typeof ctx.views.activity.showActivity === "function" &&
	ctx.views.account &&
	typeof ctx.views.account.showAccount === "function" &&
	ctx.views.discover &&
	typeof ctx.views.discover.showDiscover === "function" &&
	typeof ctx.util._clearResume === "function" &&
	ctx.views.player &&
	typeof ctx.views.player.startPlayback === "function" &&
	typeof ctx.views.player.stopPlayback === "function" &&
	ctx.views.app &&
	typeof ctx.views.app.loadSubscriptions === "function" &&
	typeof sandbox.WebOSKeys.name === "function";
console.log(ok ? "WIRING_OK" : "WIRING_FAIL");
if (!ok) process.exit(1);

// ── Static call-site check ────────────────────────────────────────────
// Scan every app source file for references to cross-file globals and
// verify each referenced member actually exists on the loaded object.
// Catches typos like FloatplaneAPI.getAcessToken() and the double-prefix
// pattern AppCtx.views.details.AppCtx.views.details.showDetails(...).
// (AppCtx.state.* keys are skipped: several are created lazily at runtime.)
const callSiteFiles = [];
(function collect() {
	for (const rel of scripts) callSiteFiles.push(rel);
	for (const f of ["js/api.js"])
		if (!callSiteFiles.includes(f)) callSiteFiles.push(f);
})();
const ident = "[A-Za-z_$][\\w$]*";
const reFloat = new RegExp("FloatplaneAPI\\.(" + ident + ")", "g");
const reView = new RegExp(
	"AppCtx\\.views\\.(" + ident + ")\\.(" + ident + ")",
	"g",
);
const reUtil = new RegExp("AppCtx\\.util\\.(" + ident + ")", "g");

let failures = 0;
const bad = (file, msg) => {
	failures++;
	console.error("FAIL " + file + ": " + msg);
};
for (const rel of callSiteFiles) {
	const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
	let m;
	reFloat.lastIndex = 0;
	while ((m = reFloat.exec(code))) {
		if (!(m[1] in sandbox.FloatplaneAPI))
			bad(rel, "FloatplaneAPI." + m[1] + " does not exist");
	}
	reView.lastIndex = 0;
	while ((m = reView.exec(code))) {
		const view = ctx.views[m[1]];
		const prop = m[2];
		if (!view) {
			bad(rel, "AppCtx.views." + m[1] + " is not registered");
			continue;
		}
		if (!(prop in view))
			bad(rel, "AppCtx.views." + m[1] + "." + prop + " does not exist");
	}
	reUtil.lastIndex = 0;
	while ((m = reUtil.exec(code))) {
		if (!(m[1] in ctx.util))
			bad(rel, "AppCtx.util." + m[1] + " does not exist");
	}
}
console.log(
	failures === 0 ? "CALLSITES_OK" : "CALLSITES_FAIL (" + failures + ")",
);
process.exit(failures === 0 ? 0 : 1);
