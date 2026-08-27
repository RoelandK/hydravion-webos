/**
 * @fileoverview Left rail sidebar (Plex/YouTube-TV style drawer).
 * Collapsed by default on browse/creator/details; opens when focus reaches
 * the left edge (Left at the leftmost element), closes when focus moves back
 * to content (Right/Back) or via the ✕ hide button. Never on player/live.
 * Registers into AppCtx.sidebar.
 */
(() => {
	/** Views where the rail may open */
	var RAIL_VIEWS = [
		"browse",
		"creator",
		"details",
		"history",
		"watchlater",
		"activity",
		"account",
		"discover",
		"discover-detail",
	];

	/** @private {?string} cid of the last-focused creator item */
	var _lastCreatorId = null;

	/** @private {?HTMLElement} content element to return focus to on close */
	var _prevFocus = null;

	/**
	 * View changed. On rail-capable views the mini rail (icons + hamburger)
	 * is always visible; full rail only when opened. Hidden on player/live.
	 * @param {string} viewId e.g. "browse" or "player"
	 */
	function showForView(viewId) {
		var rail = document.getElementById("sidebar");
		if (!rail) return;
		var on = RAIL_VIEWS.indexOf(viewId) !== -1;
		if (on) {
			rail.classList.remove("hidden");
			rail.classList.add("rail-mini");
			document.body.classList.add("rail-mini-open");
			document.body.classList.remove("rail-open");
		} else {
			rail.classList.add("hidden");
			rail.classList.remove("rail-mini");
			document.body.classList.remove("rail-open", "rail-mini-open");
		}
		_prevFocus = null;
		if (on) _renderCreators();
	}

	/** @returns {boolean} */
	function isOpen() {
		var rail = document.getElementById("sidebar");
		return !!(
			rail &&
			!rail.classList.contains("hidden") &&
			!rail.classList.contains("rail-mini")
		);
	}

	/**
	 * Open the rail to full width and focus it. Remembers the content
	 * element that had focus so closing can return to it.
	 */
	function open() {
		var rail = document.getElementById("sidebar");
		if (!rail) return;
		if (_prevFocus === null) _prevFocus = document.activeElement;
		rail.classList.remove("hidden", "rail-mini");
		document.body.classList.add("rail-open");
		document.body.classList.remove("rail-mini-open");
		_renderCreators();
		// Content narrows by 188px - snap any over-scrolled rows back after
		// the width transition (deferred, or rows jump mid-animation)
		if (AppCtx.util._reclampRows)
			setTimeout(() => AppCtx.util._reclampRows(), 230);
		var items = _railItems();
		if (!items.length) return;
		var target = null;
		if (_lastCreatorId) {
			target = items.find(
				(el) =>
					el.classList.contains("side-creator") &&
					el.dataset.cid === _lastCreatorId,
			);
		}
		if (!target) target = items[0];
		target.focus();
	}

	/** Collapse the rail back to mini (icons only); optionally restore focus. */
	function close(restoreFocus) {
		var rail = document.getElementById("sidebar");
		if (rail) {
			rail.classList.remove("hidden");
			rail.classList.add("rail-mini");
		}
		document.body.classList.add("rail-mini-open");
		document.body.classList.remove("rail-open");
		// Content widens by 188px - re-clamp rows so they fill the space
		// (deferred until the width transition finishes)
		if (AppCtx.util._reclampRows)
			setTimeout(() => AppCtx.util._reclampRows(), 230);
		if (restoreFocus !== false) {
			var prev = _prevFocus;
			_prevFocus = null;
			if (prev && prev.isConnected) {
				prev.focus();
				return;
			}
			// Fall back to first focusable in the current view
			var viewEl = document.getElementById("view-" + AppCtx.state.CURRENT_VIEW);
			var fb = viewEl ? viewEl.querySelector('[tabindex="0"], button') : null;
			if (fb) fb.focus();
		}
	}

	/**
	 * Build the creator list section from subscriptions.
	 * Live creators get a red LIVE badge.
	 */
	function _renderCreators() {
		var host = document.getElementById("side-creators");
		if (!host) return;
		host.innerHTML = "";
		var subs = AppCtx.state.SUBS || [];
		if (!subs.length) {
			var none = document.createElement("div");
			none.className = "side-section-label";
			none.textContent = "No subscriptions";
			host.appendChild(none);
			return;
		}
		subs.forEach((sub) => {
			var cid = sub.creator || (sub.plan && sub.plan.id);
			if (!cid) return;
			var info = AppCtx.state.CREATOR_INFO[cid] || {};
			var btn = document.createElement("button");
			btn.className = "side-creator";
			btn.tabIndex = "0";
			btn.setAttribute("data-cid", cid);
			var iconPath = info.icon ? AppCtx.util._thumb(info.icon, 100) : "";
			var isLive =
				info._isLive === true && info.liveStream && info.liveStream.id;
			var title = info.title || "Creator";
			btn.innerHTML =
				(iconPath
					? '<img class="side-c-icon" src="' + iconPath + '" decoding="async">'
					: '<span class="side-c-icon">' + (title[0] || "?") + "</span>") +
				'<span class="side-c-title"></span>' +
				(isLive ? '<span class="side-live-badge">● LIVE</span>' : "");
			btn.querySelector(".side-c-title").textContent = title;
			btn.addEventListener("click", () => {
				_lastCreatorId = cid;
				AppCtx.views.creator.showCreator(cid);
			});
			host.appendChild(btn);
		});
	}

	/**
	 * All focusable rail elements (menu items + creator items), DOM order.
	 * @returns {Array<HTMLElement>}
	 */
	function _railItems() {
		var rail = document.getElementById("sidebar");
		if (!rail) return [];
		return Array.prototype.slice.call(rail.querySelectorAll('[tabindex="0"]'));
	}

	/**
	 * True when the focused element lives inside the rail.
	 * @returns {boolean}
	 */
	function isFocusedInRail() {
		var rail = document.getElementById("sidebar");
		return !!(rail && rail.contains(document.activeElement));
	}

	/**
	 * Move focus within the rail. Called from app.js handleKey.
	 * @param {number} dir 1 = down, -1 = up
	 */
	function move(dir) {
		var items = _railItems();
		if (!items.length) return;
		var idx = items.indexOf(document.activeElement);
		var ni = (idx + dir + items.length) % items.length;
		items[ni].focus();
	}

	/** Activate the focused rail item (Enter/Play). */
	function activate() {
		var active = document.activeElement;
		if (!active || !active.classList) return;
		if (
			active.classList.contains("side-item") ||
			active.classList.contains("side-creator") ||
			active.classList.contains("side-close")
		) {
			active.click();
		}
	}

	/** Run the action for a rail menu item by data-action name. */
	function _runAction(action) {
		switch (action) {
			case "toggle": {
				// Hamburger: collapse/expand between full rail and icon-only mini rail
				var rail = document.getElementById("sidebar");
				if (!rail) return;
				var mini = rail.classList.toggle("rail-mini");
				document.body.classList.toggle("rail-mini-open", mini);
				document.body.classList.toggle("rail-open", !mini);
				break;
			}
			case "home":
				close(false);
				if (AppCtx.state.CURRENT_VIEW !== "browse") {
					AppCtx.views.browse.renderBrowse();
				} else {
					var container = document.getElementById("browse-rows");
					var first = container
						? container.querySelector('[tabindex="0"], button')
						: null;
					if (first) {
						first.focus();
						first.scrollIntoView({ block: "start" });
					}
				}
				break;
			case "history":
				close(false);
				AppCtx.views.history.showHistory();
				break;
			case "watchlater":
				close(false);
				AppCtx.views.watchlater.showWatchLater();
				break;
			case "activity":
				close(false);
				AppCtx.views.activity.showActivity();
				break;
			case "account":
				close(false);
				AppCtx.views.account.showAccount();
				break;
			case "discover":
				close(false);
				AppCtx.views.discover.showDiscover();
				break;
			case "live": {
				var subs = AppCtx.state.SUBS || [];
				var liveSub = null;
				for (var i = 0; i < subs.length; i++) {
					var cid = subs[i].creator || (subs[i].plan && subs[i].plan.id);
					var info = AppCtx.state.CREATOR_INFO[cid] || {};
					if (info._isLive === true && info.liveStream && info.liveStream.id) {
						liveSub = { cid: cid, info: info };
						break;
					}
				}
				close(false);
				if (liveSub) {
					LiveView.enter(
						liveSub.info.liveStream,
						liveSub.cid,
						liveSub.info.title || "Creator",
						true,
					);
				} else {
					AppCtx.util._toast("No one is live right now");
				}
				break;
			}
			case "search": {
				close(false);
				// Inside a creator's context (creator page, or details opened
				// from a creator) the search is that creator's header search -
				// jump back to the creator page and focus it. Anywhere else
				// the browse search applies.
				var si = null;
				var searchCid =
					AppCtx.state.CURRENT_CREATOR || AppCtx.state._lastDetailsCreator;
				var inCreatorCtx =
					AppCtx.state.CURRENT_VIEW === "creator" ||
					AppCtx.state.CURRENT_VIEW === "details";
				if (inCreatorCtx && searchCid && AppCtx.state.CREATOR_INFO[searchCid]) {
					if (AppCtx.state.CURRENT_VIEW !== "creator")
						AppCtx.views.creator.showCreator(searchCid);
					si = document.getElementById("creator-search-input");
				} else {
					if (AppCtx.state.CURRENT_VIEW !== "browse")
						AppCtx.views.browse.renderBrowse();
					si = document.getElementById("search-input");
				}
				if (si) {
					si.focus();
					si.scrollIntoView({ block: "center" });
				}
				break;
			}
			case "settings":
				close(false);
				AppCtx.views.settings.showSettings();
				break;
		}
	}

	// Wire static menu items once (module load).
	// NOTE: use `function` + `this`, not an arrow closing over the loop var -
	// an arrow capturing `items[i]` reads items.length (undefined) on click.
	(function _wireStatic() {
		var items = document.querySelectorAll(".side-item, .side-close");
		for (var i = 0; i < items.length; i++) {
			items[i].addEventListener("click", function () {
				_runAction(this.getAttribute("data-action"));
			});
		}
	})();

	AppCtx.sidebar = {
		showForView: showForView,
		isOpen: isOpen,
		open: open,
		close: close,
		isFocusedInRail: isFocusedInRail,
		move: move,
		activate: activate,
	};
})();
