/**
 * @fileoverview Browse view - subscription grid + resume/watch-history rows.
 * Registers into AppCtx.views.browse.
 */
(() => {
	/** Build AppCtx.state._resumePct lookup from localStorage. Call before rendering cards. */
	function _buildResumeLookup() {
		AppCtx.state._resumePct = {};
		try {
			for (var ri = 0; ri < localStorage.length; ri++) {
				var rk = localStorage.key(ri);
				if (rk && rk.indexOf("resume_") === 0) {
					var id = rk.substring(7);
					try {
						var rd = JSON.parse(localStorage.getItem(rk));
						if (rd && rd.pos > 5 && rd.dur > 0 && rd.pos < rd.dur - 10)
							AppCtx.state._resumePct[id] = Math.min(
								100,
								Math.round((rd.pos / rd.dur) * 100),
							);
						// localStorage read failure is non-fatal
					} catch (_) {}
				}
			}
		} catch (e) {}
	}

	/** Save resume position for a video. @param {string} id @param {string} url @param {number} pos @param {number} dur */
	function _saveResume(id, url, pos, dur) {
		if (!id || pos < 5 || pos >= dur - 10) return;
		try {
			var key = "resume_" + id;
			var data = JSON.stringify({
				url: url,
				pos: pos,
				dur: dur,
				ts: Date.now(),
			});
			localStorage.setItem(key, data);
		} catch (e) {}
	}
	/** Load resume position for a video. @param {string} id @returns {?{url:string,pos:number,dur:number,ts:number}} */
	function _loadResume(id) {
		try {
			var raw = localStorage.getItem("resume_" + id);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	}
	/** Remove resume entry for a video. @param {string} id */
	function _clearResume(id) {
		try {
			localStorage.removeItem("resume_" + id);
		} catch (e) {}
	}
	/** Remove ALL resume entries. */
	function _clearAllResume() {
		try {
			for (var i = localStorage.length - 1; i >= 0; i--) {
				var k = localStorage.key(i);
				if (k && k.indexOf("resume_") === 0) localStorage.removeItem(k);
			}
		} catch (e) {}
		AppCtx.state._resumePct = {};
	}
	/** Get all resume entries with position > 5s and not finished. @returns {Array<{id:string,url:string,pos:number,dur:number}>} */
	function _getAllResume() {
		var out = [];
		try {
			for (var i = 0; i < localStorage.length; i++) {
				var k = localStorage.key(i);
				if (k && k.indexOf("resume_") === 0) {
					var id = k.substring(7);
					var data = JSON.parse(localStorage.getItem(k));
					if (data && data.pos > 5 && data.pos < data.dur - 10) {
						out.push({
							id: id,
							url: data.url,
							pos: data.pos,
							dur: data.dur,
							ts: data.ts || 0,
						});
					} else {
						localStorage.removeItem(k); // cleanup finished
					}
				}
			}
		} catch (e) {}
		// Always newest-first by view time; keep max 20
		out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
		if (out.length > 20) out.length = 20;
		// Remove stale entries from localStorage
		var keepKeys = {};
		out.forEach((re) => {
			keepKeys["resume_" + re.id] = 1;
		});
		for (var li = 0; li < localStorage.length; li++) {
			var lk = localStorage.key(li);
			if (lk && lk.indexOf("resume_") === 0 && !keepKeys[lk])
				localStorage.removeItem(lk);
		}
		return out;
	}
	function renderBrowse() {
		AppCtx.util._show("view-browse");
		AppCtx.state._focusCacheView = null;
		AppCtx.state.CURRENT_CREATOR = null;
		var container = document.getElementById("browse-rows");
		container.innerHTML = "";
		_buildResumeLookup();
		// Continue Watching row
		var resumeEntries = _getAllResume();
		if (resumeEntries.length) {
			var cwRow = document.createElement("div");
			cwRow.className = "browse-row";
			var cwHeader = document.createElement("div");
			cwHeader.className = "row-header";
			cwHeader.innerHTML =
				'<span class="row-title" style="color:#0095D6">▶ Continue Watching</span>';
			// Clear-all button (two-press confirm so one stray click can't wipe
			// every resume position).
			var clearAll = document.createElement("button");
			clearAll.className = "row-clear-all";
			clearAll.tabIndex = "0";
			clearAll.textContent = "✕ Clear all";
			var _armTimer = null;
			clearAll.addEventListener("click", (e) => {
				e.stopPropagation();
				if (clearAll.dataset.armed) {
					_clearAllResume();
					var parent = cwRow.parentNode;
					if (parent) parent.removeChild(cwRow);
					var next = container.querySelector(".video-card");
					if (next) next.focus();
					return;
				}
				clearAll.dataset.armed = "1";
				clearAll.textContent = "✕ Confirm?";
				if (_armTimer) clearTimeout(_armTimer);
				_armTimer = setTimeout(() => {
					delete clearAll.dataset.armed;
					clearAll.textContent = "✕ Clear all";
				}, 3000);
			});
			cwHeader.appendChild(clearAll);
			cwRow.appendChild(cwHeader);
			var cwCards = document.createElement("div");
			cwCards.className = "row-cards";
			// Look up video info for each resume entry (best-effort from cache)
			resumeEntries.forEach((re) => {
				var vid = null;
				for (var ck in AppCtx.state.VIDEOS) {
					if (ck.indexOf("_myint_") === 0 || ck.indexOf("_ch_") === 0) continue;
					var arr = AppCtx.state.VIDEOS[ck];
					if (!arr) continue;
					for (var vi = 0; vi < arr.length; vi++) {
						if ((arr[vi].id || arr[vi].guid) === re.id) {
							vid = arr[vi];
							break;
						}
					}
					if (vid) break;
				}
				if (!vid) return; // can't show without metadata
				vid._skipDetails = true; // tell _makeVideoCard to play directly
				// Mutates cached video object to carry intent - slight cache pollution tradeoff
				var card = AppCtx.util._makeVideoCard(vid, "", "browse", 0, 0);
				card.setAttribute("data-resume-id", re.id);
				// Add progress bar overlay
				var pct = Math.min(100, Math.round((re.pos / re.dur) * 100));
				var thumb = card.querySelector(".card-thumb");
				if (thumb) {
					var bar = document.createElement("div");
					bar.className = "resume-bar";
					bar.style.width = pct + "%";
					thumb.appendChild(bar);
				}
				cwCards.appendChild(card);
			});
			if (cwCards.children.length) {
				cwRow.appendChild(cwCards);
				container.appendChild(cwRow);
			}
		}
		// Watch History row - paint cached copy instantly, refresh from API after.
		// Rendered AFTER the subscription rows so history sits at the page bottom.
		var _histRow = null;
		var _renderHistory = (history) => {
			if (!history || !history.length) return;
			if (_histRow && _histRow.parentNode) {
				_histRow.parentNode.removeChild(_histRow);
				_histRow = null;
			}
			_histRow = document.createElement("div");
			_histRow.className = "browse-row";
			_histRow.id = "history-row";
			var hHeader = document.createElement("div");
			hHeader.className = "row-header";
			hHeader.innerHTML =
				'<span class="row-title" style="color:#00A67E">▶ Watch History</span>';
			_histRow.appendChild(hHeader);
			var hCards = document.createElement("div");
			hCards.className = "row-cards";
			history.forEach((entry, i) => {
				var vid = entry.blogPost;
				if (!vid || !vid.id) return; // guard: some entries have blogPost:{}
				if (!entry.progress || entry.progress <= 0) return; // hide unwatched
				var card = AppCtx.util._makeVideoCard(
					vid,
					vid.creator ? vid.creator.id : "",
					"browse",
					1,
					i,
				);
				// remove any local-resume bar, use server progress instead
				var oldBar = card.querySelector(".resume-bar");
				if (oldBar) oldBar.parentNode.removeChild(oldBar);
				var thumb = card.querySelector(".card-thumb");
				if (thumb) {
					var bar = document.createElement("div");
					bar.className = "resume-bar";
					bar.style.width = Math.min(100, entry.progress) + "%";
					thumb.appendChild(bar);
				}
				hCards.appendChild(card);
			});
			if (!hCards.children.length) return;
			_histRow.appendChild(hCards);
			container.appendChild(_histRow);
			AppCtx.state._focusCacheView = null; // make new cards navigable
		};
		AppCtx.state.SUBS.forEach((sub, i) => {
			var cid = sub.creator || (sub.plan && sub.plan.id);
			var info = AppCtx.state.CREATOR_INFO[cid] || {};
			var videos = AppCtx.state.VIDEOS[cid] || [];
			if (!videos.length) return;
			var row = document.createElement("div");
			row.className = "browse-row";
			var header = document.createElement("div");
			header.className = "row-header";
			header.tabIndex = "0"; // D-pad focusable
			var iconPath = info.icon && info.icon.path ? info.icon.path : "";
			var isLive =
				info._isLive === true && info.liveStream && info.liveStream.id;
			var isFav = localStorage.getItem("pref_favorite") === cid;
			var showFav = AppCtx.state.SUBS.length > 1;
			header.innerHTML =
				(iconPath
					? '<img class="creator-icon" src="' + iconPath + '" decoding="async">'
					: '<span class="creator-icon">' +
						(info.title ? info.title[0] : "?") +
						"</span>") +
				'<span class="row-title">' +
				(info.title || "Creator") +
				"</span>" +
				(isLive ? '<span class="live-badge-sm">● LIVE</span>' : "") +
				(showFav
					? '<span class="fav-star' +
						(isFav ? " fav-on" : "") +
						'" data-cid="' +
						cid +
						'" tabindex="0">' +
						(isFav ? "★" : "☆") +
						"</span>"
					: "");
			row.appendChild(header);
			header.style.cursor = "pointer";
			header.addEventListener("click", () => {
				AppCtx.views.creator.showCreator(cid);
			});
			header.addEventListener("keydown", (e) => {
				if (e.keyCode === 13) AppCtx.views.creator.showCreator(cid);
			});
			// Favorite star toggle (only if more than 1 subscription)
			var star = header.querySelector(".fav-star");
			if (star) {
				star.onkeydown = function (e) {
					if (e.keyCode === 13) {
						e.stopPropagation();
						this.onclick(e);
					}
				};
				star.onclick = function (e) {
					e.stopPropagation();
					var was = localStorage.getItem("pref_favorite");
					if (was === cid) {
						localStorage.removeItem("pref_favorite");
						this.textContent = "☆";
						this.classList.remove("fav-on");
					} else {
						localStorage.setItem("pref_favorite", cid);
						// Update all stars
						var all = document.querySelectorAll(".fav-star");
						for (var si = 0; si < all.length; si++) {
							all[si].textContent =
								all[si].getAttribute("data-cid") === cid ? "★" : "☆";
							all[si].classList.toggle(
								"fav-on",
								all[si].getAttribute("data-cid") === cid,
							);
						}
					}
				};
			}
			header.setAttribute("tabindex", "0");
			var cards = document.createElement("div");
			cards.className = "row-cards";
			cards.setAttribute("data-creator-idx", i);
			// Show 19 of the cached 20 - the 20th stays in cache so the More
			// card can focus it on the creator page without another fetch.
			var _shown = videos.slice(0, 19);
			// Batch card insertion in a fragment (one DOM append per row)
			var _frag = document.createDocumentFragment();
			_shown.forEach((vid, j) => {
				_frag.appendChild(AppCtx.util._makeVideoCard(vid, cid, "browse", i, j));
			});
			cards.appendChild(_frag);
			// "More" card - opens the creator page with the next video focused
			// (the first one not shown in the browse row). The API returns a
			// full 20-video page by default, so a full-length cache means more
			// videos almost certainly exist beyond it.
			if (videos.length >= 20) {
				var more = document.createElement("div");
				more.className = "video-card more-card";
				more.setAttribute("tabindex", "0");
				more.setAttribute("data-view", "browse");
				more.setAttribute("data-row", i);
				more.setAttribute("data-col", 19);
				more.innerHTML =
					'<div class="more-thumb"><span class="more-arrow">›</span>' +
					'<span class="more-label">More</span></div>';
				more.addEventListener("click", () => {
					var nextVid = videos[19];
					AppCtx.views.creator.showCreator(
						cid,
						nextVid && (nextVid.id || nextVid.guid),
					);
				});
				more.addEventListener("keydown", (e) => {
					if (e.keyCode === 13) more.click();
				});
				cards.appendChild(more);
			}
			row.appendChild(cards);
			container.appendChild(row);
		});
		// Watch History at the bottom: cached copy first (instant paint),
		// then fresh data replaces it.
		try {
			var cachedHist = JSON.parse(localStorage.getItem("hist_cache") || "null");
			if (cachedHist && cachedHist.length) _renderHistory(cachedHist);
		} catch (e) {}
		FloatplaneAPI.getHistory(0)
			.then((history) => {
				if (!history || !history.length) return;
				try {
					localStorage.setItem(
						"hist_cache",
						JSON.stringify(history.slice(0, 5)),
					);
				} catch (e) {}
				_renderHistory(history);
			})
			.catch(() => {}); // silent: history is best-effort
		// Focus first Continue Watching card, or first video card
		var firstCW = container.querySelector(".video-card[data-resume-id]");
		if (firstCW) {
			firstCW.focus();
		} else {
			var firstCard = container.querySelector(".video-card");
			if (firstCard) firstCard.focus();
		}
		// Empty grid (no active subscription) - explain instead of a blank screen
		if (!container.children.length) {
			var empty = document.createElement("div");
			empty.className = "grid-empty";
			empty.innerHTML =
				"No active subscription - " +
				'<a href="https://www.floatplane.com" target="_blank">subscribe on floatplane.com</a> ' +
				"and restart the app to see your creators.";
			container.appendChild(empty);
		}
	}
	function _loadMore(creatorId, chId) {
		if (AppCtx.state._LOADING_MORE) return;
		AppCtx.state._LOADING_MORE = true;
		var key = AppCtx.util._getOffsetKey(creatorId, chId);
		var offset = AppCtx.state._OFFSETS[key] || 0;
		var vidKey = chId ? "_ch_" + creatorId + "_" + chId : creatorId;
		var loaderEl = document.getElementById("loader-more");
		if (loaderEl) loaderEl.style.display = "block";
		(chId
			? FloatplaneAPI.getChannelVideos(creatorId, chId, offset + 20)
			: FloatplaneAPI.getVideos(creatorId, offset + 20)
		)
			.then((newVids) => {
				AppCtx.state._LOADING_MORE = false;
				if (loaderEl) loaderEl.style.display = "none";
				if (!newVids || !newVids.length) {
					AppCtx.state._OFFSETS[key] = -1;
					return;
				}
				AppCtx.state._OFFSETS[key] = offset + 20;
				if (!AppCtx.state.VIDEOS[vidKey]) AppCtx.util._setCache(vidKey, []);
				Array.prototype.push.apply(AppCtx.state.VIDEOS[vidKey], newVids);
				var grid = document.getElementById("video-grid");
				if (!grid) return;
				newVids.forEach((vid) => {
					grid.appendChild(AppCtx.views.creator._makeGridCard(vid));
				});
				// Invalidate focus cache so newly loaded cards are navigable
				AppCtx.state._focusCacheView = null;
			})
			.catch(() => {
				AppCtx.state._LOADING_MORE = false;
				if (loaderEl) loaderEl.style.display = "none";
			});
	}

	// Resume helpers are shared (player.js + details.js use them too) - expose
	// on AppCtx.util as well as the browse view.
	AppCtx.util._saveResume = _saveResume;
	AppCtx.util._loadResume = _loadResume;
	AppCtx.util._clearResume = _clearResume;
	AppCtx.util._clearAllResume = _clearAllResume;
	AppCtx.util._getAllResume = _getAllResume;
	AppCtx.util._buildResumeLookup = _buildResumeLookup;

	AppCtx.views.browse = {
		renderBrowse: renderBrowse,
		_loadMore: _loadMore,
		_buildResumeLookup: _buildResumeLookup,
		_getAllResume: _getAllResume,
		_clearAllResume: _clearAllResume,
	};
})();
