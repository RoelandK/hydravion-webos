/**
 * @fileoverview Main application logic for Hydravion webOS TV app.
 * Floatplane-style UI with browse, channel navigation, search, and player controls.
 */
var App = (() => {
	/** @private {Array} User's subscription list */
	AppCtx.state.SUBS = [];

	/** @private {Object<string, Array>} Cache: creatorId -> videos */
	AppCtx.state.VIDEOS = {};

	/** @private {Array<string>} Insertion order for AppCtx.state.VIDEOS cache eviction */
	var _cacheOrder = [];

	/** @private {number} Max AppCtx.state.VIDEOS cache entries before eviction */
	var _MAX_CACHE = 200;

	/** @private {?Array} Cached focusable elements for arrow navigation */
	var _focusCache = null;

	/** @private {?string} View name that _focusCache was built for */
	AppCtx.state._focusCacheView = null;

	/**
	 * Logical (unscaled) bounding rect of an element. Focused cards scale
	 * 1.15x around their center (.video-card:focus), which inflates
	 * getBoundingClientRect and breaks spatial-nav geometry math. For scaled
	 * cards, shrink the rect back around its center so Up/Down comparisons
	 * use the element's true layout position.
	 * @param {HTMLElement} el
	 * @returns {{top:number,bottom:number,left:number,right:number}}
	 */
	function _unscaledRect(el) {
		var r = el.getBoundingClientRect();
		// Only .video-card carries the 1.15x focus scale; everything else is 1.
		if (!el.classList || !el.classList.contains("video-card")) return r;
		var cx = (r.left + r.right) / 2;
		var cy = (r.top + r.bottom) / 2;
		var w = r.width / 1.15;
		var h = r.height / 1.15;
		return {
			left: cx - w / 2,
			right: cx + w / 2,
			top: cy - h / 2,
			bottom: cy + h / 2,
		};
	}

	/** @private {WeakMap} Per-row scroll offset for GPU-accelerated translate3d scrolling */
	var _rowOffsets = new WeakMap();

	/**
	 * Scroll a row container using GPU-composited translate3d instead of scrollLeft.
	 * Avoids synchronous layout flush that scrollLeft triggers on webOS Chrome 68.
	 * @param {HTMLElement} parent The .row-cards container
	 * @param {number} delta Pixels to scroll (negative = left)
	 */
	function _scrollRow(parent, delta) {
		var current = _rowOffsets.get(parent) || 0;
		var next = current + delta;
		var maxScroll = parent.scrollWidth - parent.clientWidth;
		next = Math.max(-maxScroll, Math.min(0, next));
		_rowOffsets.set(parent, next);
		var val = "translate3d(" + next + "px, 0, 0)";
		parent.style.transform = val;
		parent.style.webkitTransform = val;
	}

	/**
	 * Re-clamp every row's scroll offset to the current maxScroll.
	 * Called after the rail toggles (mini<->full) so rows that were scrolled
	 * beyond the now-narrower width snap back instead of showing empty space.
	 */
	function _reclampRows() {
		// Query live row elements (avoid WeakMap iteration - unsupported on
		// webOS Chrome 68) and re-clamp each from its stored offset.
		var rows = document.querySelectorAll(
			".row-cards, .grid-cards, [class*=cards]",
		);
		for (var ri = 0; ri < rows.length; ri++) {
			var parent = rows[ri];
			var offset = _rowOffsets.get(parent) || 0;
			var maxScroll = parent.scrollWidth - parent.clientWidth;
			var next = Math.max(-maxScroll, Math.min(0, offset));
			if (next !== offset) {
				_rowOffsets.set(parent, next);
				var val = "translate3d(" + next + "px, 0, 0)";
				parent.style.transform = val;
				parent.style.webkitTransform = val;
			}
		}
	}

	/** Set a cache entry and evict oldest if over cap. */
	function _setCache(key, val) {
		if (AppCtx.state.VIDEOS[key] === undefined) {
			_cacheOrder.push(key);
			if (_cacheOrder.length > _MAX_CACHE) {
				var old = _cacheOrder.shift();
				if (old !== undefined) delete AppCtx.state.VIDEOS[old];
			}
		}
		AppCtx.state.VIDEOS[key] = val;
	}

	/** @private {Object<string, Object>} Cache: creatorId -> creator info */
	AppCtx.state.CREATOR_INFO = {};

	/** @private {string} Current view name */
	AppCtx.state.CURRENT_VIEW = "loading";

	/** @private {?string} Currently viewed creator ID */
	AppCtx.state.CURRENT_CREATOR = null;

	/** @private {?string} Active channel filter in creator page */
	AppCtx.state.CURRENT_CHANNEL_FILTER = null;

	/** @private {number} Saved scroll position for back navigation */
	AppCtx.state._savedScrollPos = 0;

	/** @private {Array} Current video queue for auto-play */
	AppCtx.state._playQueue = [];

	/** @private {number} Current index in AppCtx.state._playQueue */
	AppCtx.state._playIndex = -1;

	/** @private {number} Consecutive auto-played videos for still-watching check */
	AppCtx.state._autoPlayCount = 0;

	/** @private {?string} Creator ID from last viewed video details */
	AppCtx.state._lastDetailsCreator = null;

	/** @private {?string} Video ID of the last details page, for restoring focus */
	AppCtx.state._lastDetailsVideoId = null;

	/** @private {?number} Deferred play button focus timer, cleared on early navigation */
	AppCtx.state._focusTimer = null;

	/** @private {?number} Still-watching auto-close timer, cleared on user action */
	AppCtx.state._stillWatchingTimer = null;

	/** @private {Object<string,number>} Resume lookup: videoId -> percent watched (0-100) */
	AppCtx.state._resumePct = {};

	/** @private {number} Pagination offset tracker: key -> offset */
	AppCtx.state._OFFSETS = {};

	/** @private {boolean} Prevent concurrent lazy loads */
	AppCtx.state._LOADING_MORE = false;

	/** @private {Array} Cached quality variants from delivery (for HD picker) */
	AppCtx.state._CACHED_VARIANTS = [];

	// =========================================================================
	// HELPERS
	// =========================================================================

	/**
	 * Pick the pre-sized child-image variant closest to (but not under) `w` px.
	 * Falls back to the full-res path when no variants exist.
	 * @param {?Object} img ImageInfo { path, childImages: [{width,path}] }
	 * @param {number} w Target width
	 * @returns {string} Best-fit image URL
	 */
	function _thumb(img, w) {
		if (!img) return "";
		if (!img.childImages || !img.childImages.length) return img.path || "";
		var best = img.path || "";
		var bestScore = Infinity;
		for (var i = 0; i < img.childImages.length; i++) {
			var c = img.childImages[i];
			if (!c || !c.path) continue;
			// Prefer smallest variant >= w; otherwise smallest overall.
			var score = c.width >= w ? c.width - w : w - c.width + 100000;
			if (score < bestScore) {
				bestScore = score;
				best = c.path;
			}
		}
		return best;
	}

	/**
	 * Switch the visible view.
	 * @param {string} id View element ID (without "view-" prefix)
	 */
	function _show(id) {
		// Leaving the player view must stop playback (no background audio)
		if (id !== "view-player" && AppCtx.state.CURRENT_VIEW === "player")
			AppCtx.views.player._stopPlayerResources();
		[
			"view-loading",
			"view-login",
			"view-browse",
			"view-creator",
			"view-details",
			"view-history",
			"view-watchlater",
			"view-activity",
			"view-account",
			"view-discover",
			"view-discover-detail",
			"view-player",
		].forEach((v) => {
			var el = document.getElementById(v);
			if (el) el.classList.toggle("hidden", v !== id);
		});
		// Also hide live view when switching to another view
		if (id !== "view-live") {
			var lv = document.getElementById("view-live");
			if (lv && !lv.classList.contains("hidden")) {
				lv.classList.add("hidden");
				LiveView.exit();
			}
		}
		AppCtx.state.CURRENT_VIEW = id.replace("view-", "");
		// Left rail visibility follows the active view (hidden on player/live)
		if (AppCtx.sidebar) AppCtx.sidebar.showForView(AppCtx.state.CURRENT_VIEW);
	}

	/** Show a toast notification (3.5s). */
	var _toastTimer = null;
	function _toast(msg) {
		var t = document.getElementById("toast");
		clearTimeout(_toastTimer);
		t.textContent = msg;
		t.classList.add("show");
		_toastTimer = setTimeout(() => {
			t.classList.remove("show");
		}, 3500);
	}

	/** Format seconds as H:MM:SS. */
	function _fmtDuration(secs) {
		if (!secs) return "";
		var h = Math.floor(secs / 3600);
		var m = Math.floor((secs % 3600) / 60);
		var s = Math.floor(secs % 60);
		if (h)
			return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
		return m + ":" + (s < 10 ? "0" : "") + s;
	}

	/** Format an ISO date for display (relative under 24h). */
	function _fmtDate(iso) {
		if (!iso) return "";
		var d = new Date(iso);
		// Fresh uploads (< 24h) read better as relative time on a TV.
		var ms = Date.now() - d.getTime();
		if (ms >= 0 && ms < 24 * 60 * 60 * 1000) {
			var mins = Math.floor(ms / 60000);
			if (mins < 60) return mins + (mins === 1 ? " min ago" : " mins ago");
			var hrs = Math.floor(mins / 60);
			return hrs + (hrs === 1 ? " hour ago" : " hours ago");
		}
		return (
			d.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			}) +
			" " +
			d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
		);
	}

	/** Pagination offset key for a creator + channel. */
	function _getOffsetKey(creatorId, chId) {
		return creatorId + (chId ? "_ch_" + chId : "");
	}

	// =========================================================================
	// LOGIN
	// =========================================================================

	/** Clear tokens and return to login. */
	function logout() {
		return FloatplaneAPI.revokeToken()
			.then(() => {
				AppCtx.state.SUBS = [];
				AppCtx.state.VIDEOS = {};
				AppCtx.state.CREATOR_INFO = {};
				_cacheOrder = [];
				AppCtx.state._OFFSETS = {};
				AppCtx.state._resumePct = {};
				AppCtx.views.notifications._stopNotificationPolling();
				AppCtx.views.login.startLogin();
			})
			.catch(() => {
				AppCtx.views.login.startLogin();
			});
	}

	/**
	 * Lightweight GET to verify an IVS M3U8 is actually serving.
	 * IVS returns 200 when streaming, 404 "Can not find channel" when offline.
	 * @param {string} url Full M3U8 URL
	 * @returns {Promise<boolean>}
	 */
	function _verifyIVSStream(url) {
		return new Promise((resolve) => {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", url, true);
			xhr.timeout = 3000;
			xhr.onload = () => {
				resolve(xhr.status === 200);
			};
			xhr.onerror = () => {
				resolve(false);
			};
			xhr.ontimeout = () => {
				resolve(false);
			};
			xhr.send();
		});
	}

	/**
	 * Check if a creator is actually live.
	 * Sets AppCtx.state.CREATOR_INFO[cid]._isLive = true/false.
	 * @param {string} cid Creator GUID
	 * @returns {Promise<boolean>}
	 */
	function _updateLiveStatus(cid) {
		var info = AppCtx.state.CREATOR_INFO[cid];
		if (!info || !info.liveStream || !info.liveStream.id) {
			if (info) info._isLive = false;
			console.log(
				"[LIVE] " + ((info && info.title) || cid) + " - no live stream channel",
			);
			return Promise.resolve(false);
		}
		// Cache: skip if checked within the last 5 minutes
		if (info._liveCheckedAt && Date.now() - info._liveCheckedAt < 300000) {
			return Promise.resolve(info._isLive === true);
		}
		// Timeout delivery call (3s)
		var timeout = new Promise((_, reject) => {
			setTimeout(reject, 3000);
		});
		return Promise.race([
			FloatplaneAPI.getLiveDeliveryInfo(info.liveStream.id),
			timeout,
		])
			.then((url) => {
				if (
					typeof url !== "string" ||
					url.length < 10 ||
					url.indexOf("m3u8") === -1
				) {
					info._isLive = false;
					console.log(
						"[LIVE] " + (info.title || cid) + " is offline (no HLS URL)",
					);
					return false;
				}
				// Delivery returned an IVS URL - verify the M3U8 actually serves
				info._liveCheckedAt = Date.now();
				return _verifyIVSStream(url).then((active) => {
					info._isLive = active;
					if (active) {
						console.log(
							"[LIVE] " +
								(info.title || cid) +
								" is LIVE: " +
								info.liveStream.title,
						);
					} else {
						console.log(
							"[LIVE] " + (info.title || cid) + " is offline (IVS 404)",
						);
					}
					return active;
				});
			})
			.catch(() => {
				info._isLive = false;
				info._liveCheckedAt = Date.now();
				console.log(
					"[LIVE] " +
						(info.title || cid) +
						" is offline (timeout / delivery error)",
				);
				return false;
			});
	}

	/**
	 * Populate the user profile icon + subscription count in the browse header.
	 */

	// =========================================================================

	// SUBSCRIPTIONS  (load data from API)
	// =========================================================================

	/** Load all subscriptions, creator info, and videos. */
	function loadSubscriptions() {
		FloatplaneAPI.getSubscriptions()
			.then((subs) => {
				AppCtx.state.SUBS = subs || [];
				// Empty sub list is a valid state (e.g. no active subscription):
				// still render browse (Continue Watching / Watch History may
				// exist) and start notifications - renderBrowse shows a "no
				// subscriptions" note when nothing is in the grid.
				if (!AppCtx.state.SUBS.length) {
					_toast("No subscriptions");
					// Header search is useless without subscriptions - disable
					// so it can't be typed into or submitted.
					var _si = document.getElementById("search-input");
					var _sb = document.getElementById("search-btn");
					if (_si) _si.disabled = true;
					if (_sb) _sb.disabled = true;
				}
				var tAll = Date.now();
				console.log(
					"[LOAD] loadSubscriptions: " + AppCtx.state.SUBS.length + " creators",
				);
				var promises = AppCtx.state.SUBS.map((sub) => {
					var cid = sub.creator || (sub.plan && sub.plan.id);
					if (!cid) return Promise.resolve();
					var t0 = Date.now();
					return FloatplaneAPI.getCreatorInfo(cid)
						.then((info) => {
							AppCtx.state.CREATOR_INFO[cid] = info;
							// Videos + live check run in parallel - the live check
							// (network + timeouts) must not block the rows.
							return Promise.all([
								AppCtx.views.creator._loadCreatorVideos(cid),
								_updateLiveStatus(cid).catch(() => false),
							]);
						})
						.catch(() => {})
						.then(() => {
							console.log(
								"[LOAD] " + cid + " done in " + (Date.now() - t0) + "ms",
							);
						});
				});
				Promise.all(promises).then(() => {
					console.log("[LOAD] all done in " + (Date.now() - tAll) + "ms");
					AppCtx.views.notifications._startNotificationPolling();
					AppCtx.views.notifications._setupNotifButton();
					// Auto-open favorite creator if set
					var fav = localStorage.getItem("pref_favorite");
					if (fav && AppCtx.state.CREATOR_INFO[fav]) {
						AppCtx.views.creator.showCreator(fav);
						return;
					}
					if (AppCtx.state.SUBS.length === 1) {
						var cid =
							AppCtx.state.SUBS[0].creator ||
							(AppCtx.state.SUBS[0].plan && AppCtx.state.SUBS[0].plan.id);
						if (cid) {
							AppCtx.views.creator.showCreator(cid);
							return;
						}
					}
					AppCtx.views.browse.renderBrowse();
				});
			})
			.catch((err) => {
				if (err.status === 401 || err.status === 403) {
					FloatplaneAPI.clearTokens();
					AppCtx.views.login.startLogin();
				} else _toast("Failed to load");
			});
	}

	/** @param {string} creatorId @returns {Promise} */

	// =========================================================================
	// BROWSE  (subscription grid, one row per creator)
	// =========================================================================

	/** Render the main browse view. */

	/**
	 * Create a video card element for browse rows.
	 * @param {Object} vid
	 * @param {string} creatorId
	 * @param {string} view View name
	 * @param {number} row
	 * @param {number} col
	 * @returns {HTMLElement}
	 */
	function _makeVideoCard(vid, creatorId, view, row, col) {
		var card = document.createElement("div");
		card.className = "video-card";
		card.setAttribute("data-view", view);
		card.setAttribute("data-row", row);
		card.setAttribute("data-col", col);
		card.setAttribute("tabindex", "0");
		var thumbSmall = vid.thumbnail ? _thumb(vid.thumbnail, 400) : "";
		var thumbFull = vid.thumbnail ? vid.thumbnail.path || "" : "";
		var title = vid.title || "Untitled";
		var dur =
			vid.metadata && vid.metadata.videoDuration
				? _fmtDuration(vid.metadata.videoDuration)
				: "";
		var myInt = AppCtx.state.VIDEOS["_myint_" + (vid.id || vid.guid)];
		var myLike = myInt === "like" ? ' <span class="my-like">Liked</span>' : "";
		var myDislike =
			myInt === "dislike" ? ' <span class="my-dislike">Disliked</span>' : "";
		var likes =
			vid.likes != null
				? '<span class="card-like"><svg class="card-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> ' +
					vid.likes +
					"</span>"
				: "";
		var dislikes =
			vid.dislikes != null
				? '<span class="card-dislike"><svg class="card-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg> ' +
					vid.dislikes +
					"</span>"
				: "";
		card.innerHTML =
			'<div class="card-thumb">' +
			(thumbSmall
				? '<img src="' +
					thumbSmall +
					'" data-full="' +
					thumbFull +
					'" loading="lazy" decoding="async" class="card-thumb-img">'
				: "") +
			(dur ? '<span class="card-duration">' + dur + "</span>" : "") +
			"</div>" +
			'<div class="card-meta"><div class="card-title">' +
			title +
			myLike +
			myDislike +
			"</div>" +
			'<div class="card-footer">' +
			_fmtDate(vid.releaseDate) +
			likes +
			dislikes +
			"</div></div>";
		// Progress bar for resume
		var _pct = AppCtx.state._resumePct[vid.id || vid.guid];
		if (_pct) {
			var thumbEl = card.querySelector(".card-thumb");
			if (thumbEl) {
				var bar = document.createElement("div");
				bar.className = "resume-bar";
				bar.style.width = _pct + "%";
				thumbEl.appendChild(bar);
			}
		}
		var _cardLock = false;
		function _openDetails() {
			if (_cardLock) {
				console.log("[NAV] browse card blocked by _cardLock");
				return;
			}
			// Watch-later cards: the view's container delegate handles
			// navigation (correct creator context + remove button). Skip.
			if (vid._wlCard) return;
			_cardLock = true;
			setTimeout(() => {
				_cardLock = false;
			}, 2000);
			try {
				// Continue Watching cards skip details and play directly
				if (vid._skipDetails) {
					delete vid._skipDetails;
					var aid = vid.attachmentOrder && vid.attachmentOrder[0];
					if (aid) {
						AppCtx.views.details.showResolutionPicker(aid, vid.id || vid.guid);
						return;
					}
				}
				console.log(
					"[NAV] browse card _openDetails title=" +
						(vid.title || "").substring(0, 30),
				);
				AppCtx.views.details.showDetails(vid, creatorId);
			} finally {
				_cardLock = false;
			}
		}
		card.addEventListener("click", _openDetails);
		card.addEventListener("keydown", (e) => {
			if (e.keyCode === 13) _openDetails();
		});
		return card;
	}

	/** @param {string} cid @param {string} chId @param {number} [offset] */

	/**
	 * Create a grid card (2-column layout in creator page).
	 * @param {Object} vid
	 * @returns {HTMLElement}
	 */

	// =========================================================================

	// =========================================================================

	/** Navigate back from player. */
	function goBack() {
		// Clean up pending timers on any navigation
		clearTimeout(AppCtx.state._focusTimer);
		clearTimeout(AppCtx.state._stillWatchingTimer);
		if (LiveView.isActive()) {
			LiveView.exit();
			var cid =
				AppCtx.state.CURRENT_CREATOR || AppCtx.state._lastDetailsCreator;
			if (cid && AppCtx.state.CREATOR_INFO[cid]) {
				AppCtx.views.creator.showCreator(cid);
			} else if (cid) {
				_show("view-loading");
				FloatplaneAPI.getCreatorInfo(cid)
					.then((info) => {
						AppCtx.state.CREATOR_INFO[cid] = info;
						return _updateLiveStatus(cid).then(() => {
							AppCtx.views.creator.showCreator(cid);
						});
					})
					.catch(() => AppCtx.views.browse.renderBrowse());
			} else {
				AppCtx.views.browse.renderBrowse();
			}
			return;
		}
		if (AppCtx.state.CURRENT_CREATOR) {
			AppCtx.views.creator.showCreator(AppCtx.state.CURRENT_CREATOR);
			return;
		}
		if (AppCtx.state._lastDetailsCreator) {
			var cid = AppCtx.state._lastDetailsCreator;
			if (AppCtx.state.CREATOR_INFO[cid]) {
				AppCtx.views.creator.showCreator(cid);
				return;
			}
			// Info not cached yet - fetch it then navigate
			_show("view-loading");
			FloatplaneAPI.getCreatorInfo(cid)
				.then((info) => {
					AppCtx.state.CREATOR_INFO[cid] = info;
					return _updateLiveStatus(cid).then(() => {
						AppCtx.views.creator.showCreator(cid);
					});
				})
				.catch(() => {
					AppCtx.views.browse.renderBrowse();
				});
			return;
		}
		AppCtx.views.browse.renderBrowse();
	}

	// =========================================================================

	// =========================================================================
	// NAVIGATION (keyboard/remote)
	// =========================================================================

	/**
	 * Focus an input/textarea and let webOS open its on-screen keyboard.
	 * Scroll is deferred (scrolling synchronously in the keydown can cancel
	 * the IME opening).
	 * @param {HTMLElement} el
	 */
	function _tryShowIme(el) {
		if (!el) return;
		el.focus();
		setTimeout(() => {
			if (!el.isConnected) return;
			var scroller = el.closest(".view") || document.body;
			if (scroller && scroller.scrollTop !== undefined) {
				var rect = el.getBoundingClientRect();
				var sRect = scroller.getBoundingClientRect();
				var targetTop = rect.top - sRect.top - 60;
				var max = scroller.scrollHeight - scroller.clientHeight;
				scroller.scrollTop = Math.max(
					0,
					Math.min(targetTop + scroller.scrollTop, max),
				);
			}
			if (el.scrollIntoView) el.scrollIntoView({ block: "start" });
		}, 100);
	}

	/**
	 * Handle remote control / keyboard input.
	 * @param {KeyboardEvent} e
	 */
	function handleKey(e) {
		// Catch Back (461) FIRST to prevent webOS from swallowing it
		if (WebOSKeys.name(e.keyCode) === "back") {
			e.preventDefault();
			e.stopPropagation();
			// Focus in the left rail → Back closes the rail and returns to content
			if (AppCtx.sidebar && AppCtx.sidebar.isFocusedInRail()) {
				AppCtx.sidebar.close(true);
				return;
			}
			// Settings overlay open → close it
			var sel = document.getElementById("settings-overlay");
			if (sel && !sel.classList.contains("hidden")) {
				AppCtx.views.settings.hideSettings();
				return;
			}
			// Live view → exit
			if (LiveView.isActive()) {
				goBack();
				return;
			}
			// Player with overlay visible → hide overlay
			if (AppCtx.state.CURRENT_VIEW === "player") {
				var ov = document.getElementById("player-overlay");
				if (ov && ov.classList.contains("visible")) {
					ov.classList.remove("visible");
					return;
				}
			}
			if (AppCtx.state.CURRENT_VIEW === "details") {
				goBack();
				return;
			}
			if (AppCtx.state.CURRENT_VIEW === "creator") {
				AppCtx.views.browse.renderBrowse();
				return;
			}
			// History/activity/discover/watch-later - Back returns to browse
			if (
				AppCtx.state.CURRENT_VIEW === "history" ||
				AppCtx.state.CURRENT_VIEW === "watchlater" ||
				AppCtx.state.CURRENT_VIEW === "activity" ||
				AppCtx.state.CURRENT_VIEW === "discover"
			) {
				AppCtx.views.browse.renderBrowse();
				return;
			}
			// Discover detail - Back returns to the discover grid
			if (AppCtx.state.CURRENT_VIEW === "discover-detail") {
				AppCtx.views.discover.showDiscover();
				return;
			}
			// Account: sub-page → account menu; menu → browse
			if (AppCtx.state.CURRENT_VIEW === "account") {
				if (AppCtx.views.account.handleBack()) return;
				AppCtx.views.browse.renderBrowse();
				return;
			}
			if (AppCtx.state.CURRENT_VIEW === "player") {
				AppCtx.views.player.stopPlayback();
				return;
			}
			// Close notification dropdown if open, restore focus to bell
			var ndd = document.getElementById("notif-dropdown");
			var cdd = document.getElementById("creator-notif-dropdown");
			if (ndd && !ndd.classList.contains("hidden")) {
				ndd.classList.add("hidden");
				var bell = document.getElementById("btn-notif");
				if (bell) bell.focus();
				return;
			}
			if (cdd && !cdd.classList.contains("hidden")) {
				cdd.classList.add("hidden");
				var cbell = document.getElementById("creator-btn-notif");
				if (cbell) cbell.focus();
				return;
			}
			// Search results are shown in browse view - Back returns to normal view
			if (document.getElementById("search-back")) {
				document.getElementById("search-back").click();
				return;
			}
			// browse, notifications, search - let webOS handle Back (exit app)
			return;
		}
		// ── Global remote keys (work in any view) ────────────────────────
		// Keycodes come from WebOSKeys (js/keymap.js) - single source of truth.
		switch (WebOSKeys.name(e.keyCode)) {
			case "home": // Home - go to browse, or direct to creator if only 1 sub
				e.preventDefault();
				if (AppCtx.state.CURRENT_VIEW === "player")
					AppCtx.views.player.stopPlayback();
				if (AppCtx.state.SUBS.length === 1) {
					var cid =
						AppCtx.state.SUBS[0].creator ||
						(AppCtx.state.SUBS[0].plan && AppCtx.state.SUBS[0].plan.id);
					if (cid) AppCtx.views.creator.showCreator(cid);
				} else {
					AppCtx.views.browse.renderBrowse();
				}
				return;
			case "exit": // Exit - back to browse from anywhere
				e.preventDefault();
				if (AppCtx.state.CURRENT_VIEW === "player")
					AppCtx.views.player.stopPlayback();
				AppCtx.views.browse.renderBrowse();
				return;
			case "info": // Info - toggle geek panel in player
				if (AppCtx.state.CURRENT_VIEW === "player") {
					e.preventDefault();
					AppCtx.views.player._toggleGeekPanel();
				}
				return;
			case "pageUp": // Page Up - previous element sibling
				if (AppCtx.state.CURRENT_VIEW !== "player") {
					e.preventDefault();
					var cu = document.activeElement;
					if (cu && cu.previousElementSibling)
						cu.previousElementSibling.focus();
				}
				return;
			case "pageDown": // Page Down - next element sibling
				if (AppCtx.state.CURRENT_VIEW !== "player") {
					e.preventDefault();
					var cu = document.activeElement;
					if (cu && cu.nextElementSibling) cu.nextElementSibling.focus();
				}
				return;
			case "cc": // C / CC - toggle subtitles in player
				if (AppCtx.state.CURRENT_VIEW === "player") {
					e.preventDefault();
					var ve = document.getElementById("player-video");
					if (ve && ve.textTracks.length) {
						var anyOn = false;
						for (var ti = 0; ti < ve.textTracks.length; ti++) {
							if (ve.textTracks[ti].mode === "showing") anyOn = true;
						}
						for (var ti = 0; ti < ve.textTracks.length; ti++) {
							ve.textTracks[ti].mode = anyOn ? "disabled" : "showing";
						}
					}
				}
				return;
			case "red": // Red - open settings
				e.preventDefault();
				AppCtx.views.settings.showSettings();
				return;
			case "green": {
				// Green - focus search. Useless (and empty) without any
				// subscriptions, so no-op instead of dropping the user into a
				// search that can never return results.
				if (!AppCtx.state.SUBS.length) {
					_toast("No subscriptions to search");
					return;
				}
				e.preventDefault();
				var si =
					document.getElementById("search-input") ||
					document.getElementById("creator-search-input");
				if (si) si.focus();
				return;
			}
			case "yellow": // Yellow - reserved
			case "blue": // Blue - reserved
				e.preventDefault();
				return;
		}
		// 0-9 digit keys - quick jump to creator by index in browse view
		if (
			AppCtx.state.CURRENT_VIEW === "browse" &&
			e.keyCode >= 48 &&
			e.keyCode <= 57
		) {
			var idx = e.keyCode - 48; // 0 = 10, 1-9 = 1-9
			if (idx === 0)
				idx = 9; // 0 key → 10th
			else idx = idx - 1; // 1 key → 0th
			if (AppCtx.state.SUBS[idx]) {
				e.preventDefault();
				var cid =
					AppCtx.state.SUBS[idx].creator ||
					(AppCtx.state.SUBS[idx].plan && AppCtx.state.SUBS[idx].plan.id);
				if (cid) AppCtx.views.creator.showCreator(cid);
			}
			return;
		}
		// Settings overlay focus trap - trap arrows inside settings buttons
		var settingsOverlay = document.getElementById("settings-overlay");
		if (settingsOverlay && !settingsOverlay.classList.contains("hidden")) {
			var arrows = [37, 38, 39, 40];
			if (arrows.indexOf(e.keyCode) !== -1) {
				e.preventDefault();
				var setBtns = Array.prototype.slice.call(
					settingsOverlay.querySelectorAll(".set-btn, #set-close"),
				);
				var idx = setBtns.indexOf(document.activeElement);
				if (e.keyCode === 38 || e.keyCode === 37)
					idx = idx > 0 ? idx - 1 : setBtns.length - 1;
				else idx = idx < setBtns.length - 1 ? idx + 1 : 0;
				if (setBtns[idx]) setBtns[idx].focus();
				return;
			}
		}
		// ── Details view: arrow nav between action buttons ─────────────
		// MUST come before the universal arrow handler below
		if (AppCtx.state.CURRENT_VIEW === "details") {
			var _detailIds = [
				"btn-play",
				"btn-play-audio",
				"btn-back",
				"btn-clear-resume",
				"dtl-like",
				"dtl-dislike",
			];
			var _detailBtns = [];
			for (var di = 0; di < _detailIds.length; di++) {
				if (document.getElementById(_detailIds[di]))
					_detailBtns.push(_detailIds[di]);
			}
			if (e.keyCode === 37 || e.keyCode === 39) {
				var aid = document.activeElement && document.activeElement.id;
				var bidx = _detailBtns.indexOf(aid);
				if (bidx >= 0) {
					e.preventDefault();
					var ni = e.keyCode === 39 ? bidx + 1 : bidx - 1;
					if (ni >= 0 && ni < _detailBtns.length)
						document.getElementById(_detailBtns[ni]).focus();
					return;
				}
			}
			// Up: inside comments → previous comment, first comment → like/dislike, like → Play
			if (e.keyCode === 38) {
				var _commentsElUp = document.getElementById("comments-section");
				if (
					_commentsElUp &&
					_commentsElUp.contains(document.activeElement)
				) {
					e.preventDefault();
					var _cmtsUp = Array.prototype.slice.call(
						_commentsElUp.querySelectorAll(".comment"),
					);
					var _idxUp = -1;
					for (var _ciUp = 0; _ciUp < _cmtsUp.length; _ciUp++) {
						if (
							_cmtsUp[_ciUp] === document.activeElement ||
							_cmtsUp[_ciUp].contains(document.activeElement)
						) {
							_idxUp = _ciUp;
							break;
						}
					}
					if (_idxUp > 0) {
						_cmtsUp[_idxUp - 1].focus();
						_cmtsUp[_idxUp - 1].scrollIntoView({ block: "nearest" });
					} else if (_idxUp === 0) {
						var _likeUp = document.getElementById("dtl-like");
						if (_likeUp) {
							_likeUp.focus();
							_likeUp.scrollIntoView({ block: "center" });
						}
					} else if (_cmtsUp.length) {
						_cmtsUp[0].focus();
						_cmtsUp[0].scrollIntoView({ block: "nearest" });
					}
					AppCtx.state._focusCacheView = null;
					return;
				}
				var _aid38b = document.activeElement && document.activeElement.id;
				if (_aid38b === "dtl-like" || _aid38b === "dtl-dislike") {
					e.preventDefault();
					var _firstUp = document.getElementById("btn-play");
					if (_firstUp) {
						_firstUp.focus();
						_firstUp.scrollIntoView({ block: "center" });
						return;
					}
					var _audioUp = document.getElementById("btn-play-audio");
					if (_audioUp && _audioUp.offsetParent !== null) {
						_audioUp.focus();
						_audioUp.scrollIntoView({ block: "center" });
						return;
					}
				}
			}
			// Down: action row → like, like/dislike → first comment, comments → next comment
			if (e.keyCode === 40) {
				var _aid40 = document.activeElement && document.activeElement.id;
				var _onAction =
					[
						"btn-play",
						"btn-play-audio",
						"btn-back",
						"btn-clear-resume",
					].indexOf(_aid40) !== -1;
				if (_onAction) {
					e.preventDefault();
					var _likeDown = document.getElementById("dtl-like");
					if (_likeDown) {
						_likeDown.focus();
						_likeDown.scrollIntoView({ block: "center" });
						return;
					}
				}
				if (_aid40 === "dtl-like" || _aid40 === "dtl-dislike") {
					e.preventDefault();
					var _csDown = document.getElementById("comments-section");
					var _firstDown = _csDown && _csDown.querySelector(".comment");
					if (_firstDown) {
						_firstDown.focus();
						_firstDown.scrollIntoView({ block: "center" });
						AppCtx.state._focusCacheView = null;
						return;
					}
				}
				var _commentsElDown = document.getElementById("comments-section");
				if (
					_commentsElDown &&
					_commentsElDown.contains(document.activeElement)
				) {
					e.preventDefault();
					var _cmtsDown = Array.prototype.slice.call(
						_commentsElDown.querySelectorAll(".comment"),
					);
					var _idxDown = -1;
					for (var _ciDown = 0; _ciDown < _cmtsDown.length; _ciDown++) {
						if (
							_cmtsDown[_ciDown] === document.activeElement ||
							_cmtsDown[_ciDown].contains(document.activeElement)
						) {
							_idxDown = _ciDown;
							break;
						}
					}
					if (_idxDown >= 0 && _idxDown < _cmtsDown.length - 1) {
						_cmtsDown[_idxDown + 1].focus();
						_cmtsDown[_idxDown + 1].scrollIntoView({ block: "nearest" });
						AppCtx.state._focusCacheView = null;
					}
					return;
				}
			}
		}
		// Universal arrow + Enter navigation for non-player views
		if (
			AppCtx.state.CURRENT_VIEW !== "player" &&
			AppCtx.state.CURRENT_VIEW !== "loading"
		) {
			// ── Left rail focus handling ──────────────────────────────
			// When focus is inside the rail: Up/Down moves between items,
			// Enter activates, Right/Back closes the rail and returns focus
			// to the content.
			if (AppCtx.sidebar && AppCtx.sidebar.isFocusedInRail()) {
				var railKey = WebOSKeys.name(e.keyCode);
				if (railKey === "up" || railKey === "down") {
					e.preventDefault();
					AppCtx.sidebar.move(railKey === "down" ? 1 : -1);
					return;
				}
				if (railKey === "enter" || railKey === "play") {
					e.preventDefault();
					AppCtx.sidebar.activate();
					return;
				}
				if (railKey === "right" || railKey === "back") {
					e.preventDefault();
					AppCtx.sidebar.close(true);
					return;
				}
			}
			var arrows = [37, 38, 39, 40];
			if (arrows.indexOf(e.keyCode) !== -1) {
				// Don't hijack arrows when an input is focused - let the text caret move
				var ae = document.activeElement;
				if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
					// Left/Right at boundary → blur input so nav takes over
					if (e.keyCode === 37 || e.keyCode === 39) {
						var cp = ae.selectionStart;
						if (
							(e.keyCode === 37 && cp === 0) ||
							(e.keyCode === 39 && cp === ae.value.length)
						) {
							ae.blur();
						} else {
							return; // let caret move normally within the text
						}
					} else {
						// Up/Down - let spatial nav move focus out of the input
						AppCtx.state._focusCacheView = null; // re-query so fresh results are in the cache
					}
				}
				// Down from the header → first focusable in the content area
				// (browse rows / creator content). Deterministic - never
				// bounces between the settings/bell pair.
				if (e.keyCode === 40) {
					var hdrEl = document.activeElement;
					var bHdr = document.getElementById("browse-header");
					var cHdr = document.getElementById("creator-header");
					if (
						hdrEl &&
						((bHdr && bHdr.contains(hdrEl)) || (cHdr && cHdr.contains(hdrEl)))
					) {
						var contentRoot =
							AppCtx.state.CURRENT_VIEW === "creator"
								? document.getElementById("creator-content")
								: document.getElementById("browse-rows");
						var firstContent = contentRoot
							? contentRoot.querySelector('button, input, [tabindex="0"], a')
							: null;
						if (firstContent) {
							e.preventDefault();
							firstContent.focus();
							return;
						}
					}
				}
				e.preventDefault();
				var dir = { 37: -1, 38: -1, 39: 1, 40: 1 }[e.keyCode];
				// Cache focusable elements - re-query on view change OR when the
				// focused element is missing (stale after dynamic grid updates).
				// Without this, Up from a freshly-loaded card sees only the
				// header above it and jumps to the search field.
				var _cacheMiss =
					(_focusCache || []).indexOf(document.activeElement) === -1;
				if (
					AppCtx.state.CURRENT_VIEW !== AppCtx.state._focusCacheView ||
					_cacheMiss
				) {
					var viewEl = document.getElementById(
						"view-" + AppCtx.state.CURRENT_VIEW,
					);
					_focusCache = Array.prototype.slice
						.call(
							(viewEl || document).querySelectorAll(
								'[tabindex="0"], button, input, select, textarea, a',
							),
						)
						.filter((el) => el.offsetParent !== null && el.tabIndex >= 0);
					AppCtx.state._focusCacheView = AppCtx.state.CURRENT_VIEW;
				}
				var active = document.activeElement;
				if (e.keyCode === 38 || e.keyCode === 40) {
					// Vertical spatial nav. Sticky headers sit at the viewport top
					// and their viewport distance can beat scrolled-off content
					// candidates, so run two passes: content first, header only
					// as a last resort - Up from a video never lands on the
					// sticky search field while content is above.
					if (!active || !_focusCache) return;
					// Focused cards scale 1.15x around their center
					// (.video-card:focus) - that inflates the focused rect
					// (top rises ~40px) and breaks the isAbove/isBelow
					// tolerance below. Shrink it back to logical geometry.
					var aRect = _unscaledRect(active);
					// Pre-filter by data-row (cheap attribute read, no layout):
					// for Up only candidates in an earlier row can be above, and
					// for Down only later rows. Same-row candidates skip geometry.
					var activeRow = active.getAttribute
						? active.getAttribute("data-row")
						: null;
					var bHdr2 = document.getElementById("browse-header");
					var cHdr2 = document.getElementById("creator-header");
					var inHeader = (el) =>
						(bHdr2 && bHdr2.contains(el)) || (cHdr2 && cHdr2.contains(el));
					for (var pass = 0; pass < 2; pass++) {
						var best = null,
							bestDist = Infinity;
						for (var ci = 0; ci < _focusCache.length; ci++) {
							var cand = _focusCache[ci];
							if (cand === active) continue;
							if (pass === 0 && inHeader(cand)) continue;
							if (pass === 1 && !inHeader(cand)) continue;
							// The browse "More" card is an affordance, not a
							// video - never let vertical nav land on it.
							if (cand.classList && cand.classList.contains("more-card"))
								continue;
							// Row pre-filter: skip geometry for candidates in the
							// same row (can't be above/below) when we have rows.
							var candRow = cand.getAttribute
								? cand.getAttribute("data-row")
								: null;
							if (
								activeRow !== null &&
								candRow !== null &&
								candRow !== activeRow
							) {
								var rowOk =
									dir === 1
										? parseInt(candRow, 10) > parseInt(activeRow, 10)
										: parseInt(candRow, 10) < parseInt(activeRow, 10);
								if (!rowOk) continue;
							}
							var r = _unscaledRect(cand);
							var isBelow = r.top > aRect.bottom - 30;
							var isAbove = r.bottom < aRect.top + 30;
							if ((dir === 1 && isBelow) || (dir === -1 && isAbove)) {
								var dx = r.left - aRect.left;
								var dy = r.top - aRect.top;
								// Row-aware: vertical distance dominates, horizontal
								// only breaks ties within the same row. Euclidean
								// distance made header buttons jump to mid-row cards.
								var dist = Math.abs(dy) * 10000 + Math.abs(dx);
								if (dist < bestDist) {
									bestDist = dist;
									best = cand;
								}
							}
						}
						if (best) {
							// Inputs/textareas: focus + force the webOS keyboard
							// (keydown-triggered focus alone often doesn't open it)
							if (
								best.tagName === "TEXTAREA" ||
								best.tagName === "INPUT" ||
								best.tagName === "SELECT"
							) {
								best.focus();
								_tryShowIme(best);
							} else {
								best.focus();
							}
							return;
						}
					}
					return; // no-op at top/bottom edge
				}
				// Left/Right - linear nav through _focusCache (DOM order), so
				// row-end wraps to the next row. Geometry is NOT used here:
				// focused cards scale 1.15x, which makes bounding-rect math
				// (r.left > aRect.right) never match a neighbor.
				// Left at the row's left edge → enter the rail (Plex/YouTube style)
				if (
					e.keyCode === 37 &&
					AppCtx.sidebar &&
					AppCtx.sidebar.isFocusedInRail() === false
				) {
					var _activeLeft = document.activeElement;
					var _isLeftEdge = true;
					if (_activeLeft && _focusCache.length) {
						var _alRect = _unscaledRect(_activeLeft);
						for (var li = 0; li < _focusCache.length; li++) {
							var _lcand = _focusCache[li];
							if (_lcand === _activeLeft) continue;
							var _lr = _unscaledRect(_lcand);
							// Same row band AND clearly to the left → not an edge
							var _sameBand =
								_lr.bottom > _alRect.top && _lr.top < _alRect.bottom;
							if (_sameBand && _lr.right <= _alRect.left + 5) {
								_isLeftEdge = false;
								break;
							}
						}
					}
					if (_isLeftEdge && _activeLeft) {
						e.preventDefault();
						AppCtx.sidebar.open();
						return;
					}
				}
				var all = _focusCache;
				if (!all.length) return;
				var idx = all.indexOf(document.activeElement);
				if (idx === -1) idx = 0;
				var n = Math.max(0, Math.min(all.length - 1, idx + dir));
				if (n !== idx) {
					var _tgt = all[n];
					if (
						_tgt.tagName === "TEXTAREA" ||
						_tgt.tagName === "INPUT" ||
						_tgt.tagName === "SELECT"
					) {
						_tgt.focus();
						_tryShowIme(_tgt);
						return;
					}
					all[n].focus();
					// Auto-scroll the parent row if element is partially hidden
					var parent = all[n].closest(
						".row-cards, .grid-cards, [class*=cards]",
					);
					if (parent) {
						var rect = all[n].getBoundingClientRect();
						var pRect = parent.getBoundingClientRect();
						if (rect.right > pRect.right - 10)
							_scrollRow(parent, rect.right - pRect.right + 20);
						else if (rect.left < pRect.left + 10)
							_scrollRow(parent, -(pRect.left - rect.left + 20));
					}
				}
				return;
			}
			// Enter activates the focused element
			if (e.keyCode === 13) {
				var el = document.activeElement;
				if (el && el.tagName === "BUTTON") {
					el.click();
					e.preventDefault();
				}
			}
		}
		if (AppCtx.state.CURRENT_VIEW === "player") {
			// "Still watching?" modal is visible - route arrows/Enter to it so
			// the remote can answer (Yes continues autoplay, Stop exits). The
			// player-nav branch below would otherwise swallow the keys.
			var _stillWatching = document.getElementById("still-watching");
			if (_stillWatching && !_stillWatching.classList.contains("hidden")) {
				var swBtns = _stillWatching.querySelectorAll(".sw-yes, .sw-no");
				var swIdx = -1;
				var swActive = document.activeElement;
				for (var swi = 0; swi < swBtns.length; swi++) {
					if (swBtns[swi] === swActive) {
						swIdx = swi;
						break;
					}
				}
				var swName = WebOSKeys.name(e.keyCode);
				if (swName === "left" || swName === "right") {
					e.preventDefault();
					if (swIdx === -1) swBtns[0].focus();
					else {
						var swNext =
							(swIdx + (swName === "right" ? 1 : -1) + swBtns.length) %
							swBtns.length;
						swBtns[swNext].focus();
					}
					return;
				}
				if (swName === "enter" || swName === "play") {
					e.preventDefault();
					var swFocused = document.activeElement;
					if (
						swFocused &&
						(swFocused.classList.contains("sw-yes") ||
							swFocused.classList.contains("sw-no"))
					) {
						swFocused.click();
					} else if (swBtns.length) {
						swBtns[0].click();
					}
					return;
				}
			}
			var overlay = document.getElementById("player-overlay");
			var overlayVisible = overlay && overlay.classList.contains("visible");
			// Every key while the overlay is visible (arrow through options,
			// Enter to select) resets the auto-hide timer.
			if (overlayVisible) AppCtx.views.player._resetOverlayTimer();
			// Don't catch Enter when a picker button has focus - let the button handle it.
			var _focusedPicker =
				document.activeElement &&
				((document.activeElement.classList &&
					document.activeElement.classList.contains("pick-item")) ||
					document.activeElement.id === "player-cc" ||
					document.activeElement.id === "player-hd" ||
					document.activeElement.id === "player-speed" ||
					document.activeElement.id === "player-geek");
			// Focusable player overlay buttons (for arrow nav). Full list is
			// module-scope AppCtx.views.player._PLAYER_BTNS (shared with toggleOverlay/timer).
			var _ctrlBtns = ["player-prev", "player-playpause", "player-next"];
			var _actionBtns = [
				"player-like",
				"player-dislike",
				"player-cc",
				"player-speed",
				"player-mute",
				"player-hd",
				"player-geek",
			];
			var _allPlayerBtns = AppCtx.views.player._PLAYER_BTNS;
			switch (WebOSKeys.name(e.keyCode)) {
				case "enter":
				case "play": // Play on some webOS remotes
					// Overlay hidden → first center/OK must just show the controls
					// and land focus on play/pause. NEVER let the default click
					// synthesis reach a (possibly still-focused) picker button:
					// that reopened the last speed/CC popup on a hidden overlay.
					if (!overlayVisible) {
						e.preventDefault();
						AppCtx.views.player.toggleOverlay();
						break;
					}
					if (_focusedPicker) return;
					// Always stop the browser's default Enter action (click
					// synthesis). Without this, the FIRST middle press (overlay
					// hidden, focus on video) shows the overlay, toggleOverlay
					// focuses play/pause, then the default action clicks the
					// newly-focused button → video pauses unexpectedly.
					e.preventDefault();
					// Middle press with focus on a control button (overlay
					// active) activates it - e.g. play/pause toggles playback.
					if (
						overlayVisible &&
						document.activeElement &&
						_allPlayerBtns.indexOf(document.activeElement.id) !== -1
					) {
						document.activeElement.click();
						break;
					}
					// Otherwise: pure overlay toggle (never touches playback).
					AppCtx.views.player.toggleOverlay();
					break;
				case "up":
				case "down": {
					// Navigate between options when a picker item is focused
					var pi = document.activeElement;
					if (pi && pi.classList && pi.classList.contains("pick-item")) {
						var pop = pi.closest(".picker-popup");
						if (pop && !pop.classList.contains("hidden")) {
							e.preventDefault();
							var items = pop.querySelectorAll(".pick-item");
							var ii = Array.prototype.indexOf.call(items, pi);
							var ni =
								e.keyCode === 40
									? Math.min(items.length - 1, ii + 1)
									: Math.max(0, ii - 1);
							if (items[ni]) items[ni].focus();
							break;
						}
					}
					// Overlay hidden → Up/Down just call up the controls.
					if (!overlayVisible) {
						e.preventDefault();
						AppCtx.views.player.toggleOverlay();
						break;
					}
					if (overlayVisible) {
						e.preventDefault();
						var aid2 = document.activeElement && document.activeElement.id;
						if (e.keyCode === 38) {
							// Up: action row → ctrl row (same index, clamped)
							var ai = _actionBtns.indexOf(aid2);
							if (ai >= 0) {
								var tgt = document.getElementById(
									_ctrlBtns[Math.min(ai, _ctrlBtns.length - 1)],
								);
								if (tgt) tgt.focus();
								break;
							}
							// Already on ctrl row (or focus lost) → center (play-pause)
							var pp = document.getElementById("player-playpause");
							if (pp) pp.focus();
						} else {
							// Down: ctrl row → action row (same index)
							var ci2 = _ctrlBtns.indexOf(aid2);
							if (ci2 >= 0) {
								var tgt = document.getElementById(_actionBtns[ci2]);
								if (tgt) tgt.focus();
								break;
							}
							// Already on action row (or focus lost) → first action (like)
							var like = document.getElementById("player-like");
							if (like) like.focus();
						}
					}
					break;
				}
				case "left":
					if (overlayVisible) {
						var aid = document.activeElement && document.activeElement.id;
						var bidx = _allPlayerBtns.indexOf(aid);
						if (bidx > 0) {
							e.preventDefault();
							document.getElementById(_allPlayerBtns[bidx - 1]).focus();
							break;
						}
					}
					AppCtx.views.player._seekWithOverlay(-30);
					break;
				case "right":
					if (overlayVisible) {
						var aid = document.activeElement && document.activeElement.id;
						var bidx = _allPlayerBtns.indexOf(aid);
						if (bidx >= 0 && bidx < _allPlayerBtns.length - 1) {
							e.preventDefault();
							document.getElementById(_allPlayerBtns[bidx + 1]).focus();
							break;
						}
					}
					AppCtx.views.player._seekWithOverlay(30);
					break;
				case "rewind":
					AppCtx.views.player._seekWithOverlay(-30);
					break;
				case "fastForward":
					AppCtx.views.player._seekWithOverlay(30);
					break;
				case "pause":
					HydravionPlayer.pause();
					break;
				case "stop":
					AppCtx.views.player.stopPlayback();
					break;
			}
			return;
		}
	}

	/**
	 * Seek and reveal the progress UI. Shows the overlay if hidden WITHOUT
	 * moving focus to the control buttons - focus stays on the video so
	 * repeated Left/Right keeps seeking instead of navigating buttons.
	 * @param {number} delta Seconds to seek
	 */

	// =========================================================================
	// INIT
	// =========================================================================

	/** Bootstrap the app. */
	function init() {
		// Listen on window so webOS doesn't swallow Back/Exit before we see it
		window.addEventListener("keydown", handleKey, false);

		// Progressive thumbnail upgrade: small variant renders instantly, then
		// the full-res version loads in after (less bandwidth on initial paint).
		document.addEventListener(
			"load",
			(e) => {
				var img = e.target;
				if (
					img &&
					img.tagName === "IMG" &&
					img.classList &&
					img.classList.contains("card-thumb-img") &&
					img.getAttribute("data-full") &&
					img.src !== img.getAttribute("data-full")
				) {
					var full = img.getAttribute("data-full");
					img.setAttribute("data-full", "");
					var up = new Image();
					up.onload = () => {
						img.src = full;
					};
					up.src = full;
				}
			},
			true,
		);

		// Also catch Back at document level with capture to beat system handlers
		document.addEventListener(
			"keydown",
			(e) => {
				if (WebOSKeys.name(e.keyCode) === "back") {
					if (
						AppCtx.state.CURRENT_VIEW === "details" ||
						AppCtx.state.CURRENT_VIEW === "player" ||
						AppCtx.state.CURRENT_VIEW === "creator" ||
						AppCtx.state.CURRENT_VIEW === "browse" ||
						AppCtx.state.CURRENT_VIEW === "history" ||
						AppCtx.state.CURRENT_VIEW === "activity" ||
						AppCtx.state.CURRENT_VIEW === "account" ||
						AppCtx.state.CURRENT_VIEW === "discover" ||
						AppCtx.state.CURRENT_VIEW === "discover-detail"
					) {
						e.preventDefault();
						e.stopPropagation();
						handleKey(e);
					}
				}
			},
			true,
		); // capture phase

		// Search
		document.getElementById("search-btn").addEventListener("click", () => {
			var inp = document.getElementById("search-input");
			var q = inp.value.trim();
			if (q) {
				AppCtx.views.search.doSearch(q);
			} else {
				inp.focus();
			}
		});
		document.getElementById("search-clear").addEventListener("click", () => {
			document.getElementById("search-input").value = "";
			AppCtx.views.browse.renderBrowse();
		});
		document.getElementById("search-input").addEventListener("keydown", (e) => {
			if (e.keyCode === 13) document.getElementById("search-btn").click();
		});
		document
			.getElementById("creator-search-btn")
			.addEventListener("click", () => {
				var q = document.getElementById("creator-search-input").value.trim();
				if (q) AppCtx.views.search.doCreatorSearch(q);
			});
		document
			.getElementById("creator-search-input")
			.addEventListener("keydown", (e) => {
				if (e.keyCode === 13)
					document.getElementById("creator-search-btn").click();
			});
		document
			.getElementById("creator-search-clear")
			.addEventListener("click", () => {
				document.getElementById("creator-search-input").value = "";
				if (AppCtx.state.CURRENT_CREATOR)
					AppCtx.views.creator.showCreator(AppCtx.state.CURRENT_CREATOR);
			});
		document
			.querySelector(".creator-search-back")
			.addEventListener("click", () => {
				if (AppCtx.state.CURRENT_CREATOR) AppCtx.views.browse.renderBrowse();
			});

		// Settings
		document
			.getElementById("btn-settings")
			.addEventListener("click", AppCtx.views.settings.showSettings);
		document
			.getElementById("set-close")
			.addEventListener("click", AppCtx.views.settings.hideSettings);
		document.getElementById("set-logout").addEventListener("click", () => {
			AppCtx.views.settings.hideSettings();
			logout();
		});
		document.getElementById("set-subs").addEventListener("click", function () {
			var val = this.textContent === "On" ? "Off" : "On";
			this.textContent = val;
			try {
				localStorage.setItem("pref_subs", val.toLowerCase());
			} catch (e) {}
		});
		document
			.getElementById("set-sub-color")
			.addEventListener("click", function () {
				var colors = ["White", "Yellow", "Cyan", "Green", "Pink"];
				var cur = this.textContent;
				var idx = colors.indexOf(cur);
				var next = (idx + 1) % colors.length;
				this.textContent = colors[next];
				try {
					localStorage.setItem("pref_sub_color", colors[next].toLowerCase());
				} catch (e) {}
				AppCtx.views.player._applySubtitleStyle();
			});
		document
			.getElementById("set-sub-offset")
			.addEventListener("click", function () {
				var val = this.textContent === "Normal" ? "Higher" : "Normal";
				this.textContent = val;
				try {
					localStorage.setItem("pref_sub_offset", val.toLowerCase());
				} catch (e) {}
				AppCtx.views.player._applySubtitleStyle();
			});
		document
			.getElementById("set-autoplay")
			.addEventListener("click", function () {
				var val = this.textContent === "On" ? "Off" : "On";
				this.textContent = val;
				try {
					localStorage.setItem("pref_autoplay", val.toLowerCase());
				} catch (e) {}
			});
		document
			.getElementById("set-quality")
			.addEventListener("click", function () {
				var opts = ["Auto", "4K", "1080p", "720p", "480p", "360p"];
				var cur = this.textContent;
				var idx = opts.indexOf(cur);
				var next = (idx + 1) % opts.length;
				this.textContent = opts[next];
				try {
					// Map display "4K" → stored "2160p" so parseInt works
					var store = opts[next] === "4K" ? "2160p" : opts[next].toLowerCase();
					localStorage.setItem("pref_quality", store);
				} catch (e) {}
			});

		// Load saved prefs
		try {
			var ps = localStorage.getItem("pref_subs");
			if (ps)
				document.getElementById("set-subs").textContent =
					ps === "on" ? "On" : "Off";
			var pq = localStorage.getItem("pref_quality");
			if (pq) {
				// Map stored "2160p" → display "4K"
				var disp = pq === "auto" ? "Auto" : pq === "2160p" ? "4K" : pq;
				var valid = ["auto", "2160p", "1080p", "720p", "480p", "360p"];
				if (valid.indexOf(pq) >= 0)
					document.getElementById("set-quality").textContent = disp;
			}
			var pc = localStorage.getItem("pref_sub_color");
			if (pc) {
				var cap = pc.charAt(0).toUpperCase() + pc.slice(1);
				document.getElementById("set-sub-color").textContent = cap;
			}
			var pa = localStorage.getItem("pref_autoplay");
			if (pa === "off")
				document.getElementById("set-autoplay").textContent = "Off";
			var po = localStorage.getItem("pref_sub_offset");
			if (po) {
				var cap = po.charAt(0).toUpperCase() + po.slice(1);
				document.getElementById("set-sub-offset").textContent = cap;
			}
		} catch (e) {}

		if (FloatplaneAPI.isLoggedIn()) {
			_show("view-loading");
			loadSubscriptions();
		} else AppCtx.views.login.startLogin();
	}

	// ── Magic Remote pointer edge-scroll (browse/creator/details) ─────
	var _edgeScrollTimer = null;
	document.addEventListener("pointermove", (e) => {
		var scrollId =
			AppCtx.state.CURRENT_VIEW === "browse"
				? "view-browse"
				: AppCtx.state.CURRENT_VIEW === "creator"
					? "view-creator"
					: AppCtx.state.CURRENT_VIEW === "details"
						? "view-details"
						: AppCtx.state.CURRENT_VIEW === "history"
							? "view-history"
							: AppCtx.state.CURRENT_VIEW === "activity"
								? "view-activity"
								: AppCtx.state.CURRENT_VIEW === "account"
									? "view-account"
									: AppCtx.state.CURRENT_VIEW === "discover"
										? "view-discover"
										: AppCtx.state.CURRENT_VIEW === "discover-detail"
											? "view-discover-detail"
											: null;
		if (!scrollId) {
			if (_edgeScrollTimer) {
				clearInterval(_edgeScrollTimer);
				_edgeScrollTimer = null;
			}
			return;
		}
		var el = document.getElementById(scrollId);
		if (!el) return;

		var rect = el.getBoundingClientRect();
		var y = e.clientY - rect.top;
		var speed = 0;

		// 10% edge zone, 20px/frame scroll, 30fps interval
		if (y < rect.height * 0.1) speed = -20;
		else if (y > rect.height * 0.9) speed = 20;

		if (speed && !_edgeScrollTimer) {
			_edgeScrollTimer = setInterval(() => {
				el.scrollTop += speed;
			}, 33);
		} else if (!speed && _edgeScrollTimer) {
			clearInterval(_edgeScrollTimer);
			_edgeScrollTimer = null;
		}
	});

	document.addEventListener("DOMContentLoaded", () => {
		document
			.getElementById("btn-login")
			.addEventListener("click", AppCtx.views.login.startLogin);
		init();
	});

	// Register shared utils + app-shell coordinators views call back into.
	// Merge into AppCtx.util: view files may have already added helpers.
	Object.assign(AppCtx.util, {
		_show: _show,
		_toast: _toast,
		_fmtDuration: _fmtDuration,
		_fmtDate: _fmtDate,
		_setCache: _setCache,
		_getOffsetKey: _getOffsetKey,
		_makeVideoCard: _makeVideoCard,
		_reclampRows: _reclampRows,
		_thumb: _thumb,
	});
	AppCtx.views.app = {
		loadSubscriptions: loadSubscriptions,
		logout: logout,
		goBack: goBack,
		init: init,
	};

	return {
		init: init,
		logout: logout,
		stopPlayback: AppCtx.views.player.stopPlayback,
		renderBrowse: AppCtx.views.browse.renderBrowse,
		showCreator: AppCtx.views.creator.showCreator,
	};
})();
