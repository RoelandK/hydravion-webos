/**
 * @fileoverview Creator page view - cover, channel pills, 2-column grid.
 * Registers into AppCtx.views.creator.
 */
(() => {
	function _loadCreatorVideos(creatorId) {
		return FloatplaneAPI.getVideos(creatorId).then((videos) => {
			AppCtx.util._setCache(creatorId, videos || []);
			// Seed notification last-known state
			if (videos && videos.length) {
				var existing = localStorage.getItem("notif_lastVideo_" + creatorId);
				if (!existing) {
					localStorage.setItem(
						"notif_lastVideo_" + creatorId,
						videos[0].id || videos[0].guid,
					);
				}
			}
			return AppCtx.state.VIDEOS[creatorId];
		});
	}
	function _makeGridCard(vid, size) {
		var div = document.createElement("div");
		div.className = "grid-card";
		div.setAttribute("tabindex", "0");
		div.setAttribute("data-video-id", vid.id || vid.guid);
		// Creator page (no size): full-res thumbnails.
		// Other grids (history/lazy-load pass 400): small first, upgrade to full.
		var thumb = vid.thumbnail
			? AppCtx.util._thumb(vid.thumbnail, size || 9999)
			: "";
		var thumbFull = size ? (vid.thumbnail && vid.thumbnail.path) || "" : "";
		var dur =
			vid.metadata && vid.metadata.videoDuration
				? AppCtx.util._fmtDuration(vid.metadata.videoDuration)
				: "";
		var likes =
			vid.likes !== undefined
				? '<span class="card-like"><svg class="card-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> ' +
					vid.likes +
					"</span>"
				: "";
		var dislikes =
			vid.dislikes !== undefined
				? '<span class="card-dislike"><svg class="card-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg> ' +
					vid.dislikes +
					"</span>"
				: "";
		div.innerHTML =
			'<div class="grid-card-thumb">' +
			(thumb
				? '<img src="' +
					thumb +
					(thumbFull
						? '" data-full="' + thumbFull + '" class="card-thumb-img"'
						: '"') +
					' loading="lazy" decoding="async">'
				: "") +
			(dur ? '<span class="card-duration">' + dur + "</span>" : "") +
			"</div>" +
			'<div class="grid-card-title">' +
			(vid.title || "") +
			"</div>" +
			'<div class="grid-card-meta">' +
			AppCtx.util._fmtDate(vid.releaseDate) +
			likes +
			dislikes +
			"</div>";
		return div;
	}
	// CREATOR PAGE  (cover banner + channel pills + 2-column grid)
	// =========================================================================

	/** @param {string} creatorId @param {?string} [focusVideoId] Focus this video's card after render (used by browse "More" card) */
	function showCreator(creatorId, focusVideoId) {
		var info = AppCtx.state.CREATOR_INFO[creatorId];
		if (!info) return;
		if (AppCtx.state.CURRENT_CREATOR !== creatorId)
			AppCtx.state.CURRENT_CHANNEL_FILTER = null;
		AppCtx.state.CURRENT_CREATOR = creatorId;
		AppCtx.util._show("view-creator");
		AppCtx.state._focusCacheView = null; // force focus cache rebuild on next arrow key
		var container = document.getElementById("creator-content");
		var cover = info.coverImage || "";
		var iconPath = info.icon && info.icon.path ? info.icon.path : "";
		var name = info.title || "Creator";
		var channels = info.channels || [];
		var chVidKey = AppCtx.state.CURRENT_CHANNEL_FILTER
			? "_ch_" + creatorId + "_" + AppCtx.state.CURRENT_CHANNEL_FILTER
			: "";
		var videos =
			chVidKey && AppCtx.state.VIDEOS[chVidKey]
				? AppCtx.state.VIDEOS[chVidKey]
				: AppCtx.state.VIDEOS[creatorId] || [];

		// Hero cover: first channel's cover or creator cover
		var heroCover =
			channels[0] && channels[0].cover && channels[0].cover.path
				? channels[0].cover.path
				: cover;
		if (AppCtx.state.CURRENT_CHANNEL_FILTER) {
			for (var ci = 0; ci < channels.length; ci++) {
				if (
					channels[ci].id === AppCtx.state.CURRENT_CHANNEL_FILTER &&
					channels[ci].cover &&
					channels[ci].cover.path
				) {
					heroCover = channels[ci].cover.path;
					break;
				}
			}
		}

		var html = "";
		html += '<div class="creator-hero">';
		if (heroCover)
			html += '<img src="' + heroCover + '" class="creator-cover">';
		html += '<div class="creator-hero-gradient"></div>';
		html += '<div class="creator-hero-content">';
		html += '<div class="creator-title-row">';
		if (iconPath) html += '<img src="' + iconPath + '" class="creator-avatar">';
		html += '<div class="creator-name">' + name + "</div>";
		html += '<div class="creator-name-gap"></div>'; // keeps Live button off the name (≥2 letter-widths)
		if (info.liveStream && info.liveStream.id) {
			var liveBtnText =
				info._isLive === true
					? "● LIVE - " + (info.liveStream.title || "Watch now")
					: "Live Stream";
			var liveBtnClass =
				info._isLive === true ? "live-btn-lg" : "live-btn-lg offline";
			html +=
				'<button id="creator-live-btn" class="' +
				liveBtnClass +
				'" tabindex="0">' +
				liveBtnText +
				"</button>";
		}
		html += "</div>";
		html +=
			'<div class="creator-meta">' + (channels.length + " channels") + "</div>";
		html += "</div></div>";
		html +=
			'<div class="creator-back" tabindex="0">Back to subscriptions</div>';
		html += '<div class="channel-pills" id="channel-pills">';
		html +=
			'<button class="pill' +
			(AppCtx.state.CURRENT_CHANNEL_FILTER === null ? " pill-active" : "") +
			'" data-channel="" tabindex="0">All</button>';
		channels.forEach((ch) => {
			var active =
				AppCtx.state.CURRENT_CHANNEL_FILTER === ch.id ? " pill-active" : "";
			html +=
				'<button class="pill' +
				active +
				'" data-channel="' +
				ch.id +
				'" tabindex="0">';
			if (ch.icon) {
				if (typeof ch.icon === "string") html += ch.icon + " ";
				else if (ch.icon.path)
					html += '<img class="pill-icon" src="' + ch.icon.path + '"> ';
			}
			html += (ch.title || "Channel") + "</button>";
		});
		html += "</div>";
		html += '<div class="video-grid" id="video-grid">';
		var filtered = AppCtx.state.CURRENT_CHANNEL_FILTER
			? videos.filter(
					(v) =>
						v.channel && v.channel.id === AppCtx.state.CURRENT_CHANNEL_FILTER,
				)
			: videos;
		if (!filtered.length) {
			html +=
				'<div class="grid-empty">No videos' +
				(AppCtx.state.CURRENT_CHANNEL_FILTER ? " in this channel" : "") +
				"</div>";
		} else {
			filtered.forEach((vid) => {
				html += _gridCardHtml(vid);
			});
		}
		html += "</div>";
		html +=
			'<div id="loader-more" style="display:none;text-align:center;padding:30px;color:#666">Loading more...</div>';
		container.innerHTML = html;
		// Reset GPU scroll offsets for all rows in this view
		var rowEls = container.querySelectorAll(".row-cards");
		for (var ri = 0; ri < rowEls.length; ri++) {
			rowEls[ri].style.transform = "translate3d(0, 0, 0)";
			rowEls[ri].style.webkitTransform = "translate3d(0, 0, 0)";
			_rowOffsets.set(rowEls[ri], 0);
		}
		container.setAttribute("data-creator-id", creatorId);

		// Prefetch subchannel videos in the background, staggered, lower
		// priority than images (delay until after initial render/images).
		if (channels.length > 1) {
			setTimeout(() => {
				if (AppCtx.state.CURRENT_CREATOR !== creatorId) return;
				channels.forEach((ch, i) => {
					if (!ch.id) return;
					var key = "_ch_" + creatorId + "_" + ch.id;
					if (AppCtx.state.VIDEOS[key]) return;
					setTimeout(() => {
						FloatplaneAPI.getChannelVideos(creatorId, ch.id)
							.then((vids) => {
								AppCtx.util._setCache(key, vids || []);
							})
							.catch(() => {});
					}, 400 * i);
				});
			}, 1500);
		}

		// Pagination offset
		var offsetKey = AppCtx.util._getOffsetKey(
			creatorId,
			AppCtx.state.CURRENT_CHANNEL_FILTER,
		);
		if (!(offsetKey in AppCtx.state._OFFSETS))
			AppCtx.state._OFFSETS[offsetKey] = 0;

		// Scroll lazy load
		var creatorView = document.getElementById("view-creator");
		if (creatorView._scrollCheck)
			creatorView.removeEventListener("scroll", creatorView._scrollCheck);
		creatorView._scrollCheck = function () {
			if (AppCtx.state._LOADING_MORE || AppCtx.state._OFFSETS[offsetKey] === -1)
				return;
			if (this.scrollTop + this.clientHeight >= this.scrollHeight - 600)
				AppCtx.views.browse._loadMore(
					creatorId,
					AppCtx.state.CURRENT_CHANNEL_FILTER,
				);
		};
		creatorView.addEventListener("scroll", creatorView._scrollCheck);

		// Delegated click + keydown handler
		if (container._clicker) {
			container.removeEventListener("click", container._clicker);
			container.removeEventListener("keydown", container._clicker);
		}
		var _navLock = false;
		var _navTarget = null; // element the lock applies to
		var _lastEnter = 0; // timestamp of last handled Enter (keydown)
		container._clicker = function (e) {
			// Skip synthetic clicks (el.click() from the global Enter handler) -
			// the trusted keydown already handled the press.
			if (e.type === "click" && !e.isTrusted) return;
			// Ignore clicks webOS synthesizes shortly after a handled Enter.
			if (e.type === "click" && Date.now() - _lastEnter < 700) return;
			// Debounce double-fire on the SAME element (keydown + click from
			// Enter). A click on a different element is always allowed so rapid
			// navigation (pill -> card) never gets eaten.
			if (_navLock && e.target === _navTarget) return;
			// On keydown, only handle Enter (13)
			if (e.type === "keydown" && e.keyCode !== 13) return;
			if (e.type === "keydown") _lastEnter = Date.now();
			console.log(
				"[NAV] nav event type=" +
					e.type +
					" keyCode=" +
					e.keyCode +
					" target=" +
					(e.target.className || e.target.id),
			);
			_navLock = true;
			_navTarget = e.target;
			setTimeout(() => {
				_navLock = false;
				_navTarget = null;
			}, 500);
			var cid = this.getAttribute("data-creator-id");
			var node = e.target;
			while (node && node !== this) {
				if (node.classList && node.classList.contains("pill")) {
					var chId = node.getAttribute("data-channel") || null;
					if (chId === AppCtx.state.CURRENT_CHANNEL_FILTER) return; // already on this channel
					AppCtx.state.CURRENT_CHANNEL_FILTER = chId;
					// Update pill active state without full re-render
					var pills = document.querySelectorAll(".pill");
					for (var pi = 0; pi < pills.length; pi++)
						pills[pi].classList.toggle(
							"pill-active",
							pills[pi].getAttribute("data-channel") === (chId || ""),
						);
					// Update hero cover: selected channel's banner, first channel's for "All"
					var chans2 = (AppCtx.state.CREATOR_INFO[cid] || {}).channels || [];
					var chCover = "";
					if (chId) {
						for (var chi2 = 0; chi2 < chans2.length; chi2++) {
							if (
								chans2[chi2].id === chId &&
								chans2[chi2].cover &&
								chans2[chi2].cover.path
							) {
								chCover = chans2[chi2].cover.path;
								break;
							}
						}
					} else if (chans2[0] && chans2[0].cover && chans2[0].cover.path) {
						chCover = chans2[0].cover.path;
					}
					if (
						!chCover &&
						AppCtx.state.CREATOR_INFO[cid] &&
						AppCtx.state.CREATOR_INFO[cid].coverImage
					)
						chCover = AppCtx.state.CREATOR_INFO[cid].coverImage;
					var heroImg = document.querySelector(".creator-hero .creator-cover");
					if (chCover && heroImg) heroImg.src = chCover;
					// Update grid in-place instead of rebuilding the whole page
					var gridEl = document.getElementById("video-grid");
					if (gridEl) {
						var chVidKey = chId ? "_ch_" + cid + "_" + chId : "";
						var videos =
							chVidKey && AppCtx.state.VIDEOS[chVidKey]
								? AppCtx.state.VIDEOS[chVidKey]
								: AppCtx.state.VIDEOS[cid] || [];
						if (chId && !AppCtx.state.VIDEOS[chVidKey]) {
							// Fetch in background - update grid in place when it
							// arrives, no full page reload.
							FloatplaneAPI.getChannelVideos(cid, chId)
								.then((vids) => {
									AppCtx.util._setCache(chVidKey, vids || []);
									AppCtx.state._focusCacheView = null;
									AppCtx.state._OFFSETS[AppCtx.util._getOffsetKey(cid, chId)] =
										0;
									var g2 = document.getElementById("video-grid");
									if (g2) {
										var h2 = "";
										(vids || []).forEach((v) => {
											h2 += _gridCardHtml(v);
										});
										g2.innerHTML =
											h2 ||
											'<div class="grid-empty">No videos in this channel</div>';
										var fc2 = g2.querySelector(".grid-card");
										if (fc2) fc2.focus();
									}
								})
								.catch(() => {});
							return;
						}
						var html = "";
						var flt = chId
							? videos.filter((v) => v.channel && v.channel.id === chId)
							: videos;
						if (!flt.length)
							html =
								'<div class="grid-empty">No videos' +
								(chId ? " in this channel" : "") +
								"</div>";
						else
							flt.forEach((v) => {
								html += _gridCardHtml(v);
							});
						gridEl.innerHTML = html;
						AppCtx.state._focusCacheView = null;
						AppCtx.state._OFFSETS[
							AppCtx.util._getOffsetKey(cid, chId || null)
						] = 0;
						// Restore focus to previously viewed card, else first card
						var restoreCard = AppCtx.state._lastDetailsVideoId
							? gridEl.querySelector(
									'.grid-card[data-video-id="' +
										AppCtx.state._lastDetailsVideoId +
										'"]',
								)
							: null;
						var fc = restoreCard || gridEl.querySelector(".grid-card");
						if (fc) fc.focus();
						AppCtx.state._lastDetailsVideoId = null;
					} else {
						showCreator(cid);
					}
					return;
				}
				if (node.classList && node.classList.contains("grid-card")) {
					var vidId = node.getAttribute("data-video-id");
					// Look up in the active channel's cache first (background
					// channel fetches live in _ch_<cid>_<chId>, not VIDEOS[cid]).
					var pool = AppCtx.state.VIDEOS[cid] || [];
					var chId = AppCtx.state.CURRENT_CHANNEL_FILTER;
					if (chId) {
						var chPool = AppCtx.state.VIDEOS["_ch_" + cid + "_" + chId];
						if (chPool && chPool.length) pool = chPool;
					}
					for (var vi = 0; vi < pool.length; vi++) {
						if ((pool[vi].id || pool[vi].guid) === vidId) {
							// Set up play queue for auto-play
							AppCtx.state._playQueue = pool;
							AppCtx.state._playIndex = vi;
							AppCtx.state._autoPlayCount = 0;
							AppCtx.views.details.showDetails(pool[vi], cid);
							return;
						}
					}
					return;
				}
				if (node.classList && node.classList.contains("creator-back")) {
					AppCtx.views.browse.renderBrowse();
					return;
				}
				if (node.id === "creator-live-btn") {
					var info = AppCtx.state.CREATOR_INFO[cid];
					var ls = info && info.liveStream;
					if (ls && ls.id) {
						LiveView.enter(
							ls,
							cid,
							(info || {}).title || "Live",
							info._isLive === true,
						);
					}
					return;
				}
				node = node.parentNode;
			}
		};
		container.addEventListener("click", container._clicker);
		container.addEventListener("keydown", container._clicker);
		// Focus the requested video (browse "More" card) if given, else
		// first grid card. Done before the details-restore block below.
		var _focusAlreadySet = false;
		if (focusVideoId) {
			var focusCard = container.querySelector(
				'.grid-card[data-video-id="' + focusVideoId + '"]',
			);
			if (focusCard) {
				focusCard.focus();
				_focusAlreadySet = true;
			} else {
				var firstCard = container.querySelector(".grid-card");
				if (firstCard) firstCard.focus();
			}
			AppCtx.state._lastDetailsVideoId = null; // don't override the requested focus
		} else {
			var first = container.querySelector(".grid-card");
			if (first) first.focus();
		}
		// Fetch server-side progress for visible videos
		var _gridCards = container.querySelectorAll(".grid-card");
		var _progressIds = [];
		for (var gci = 0; gci < _gridCards.length; gci++) {
			var pid = _gridCards[gci].getAttribute("data-video-id");
			if (pid) _progressIds.push(pid);
		}
		if (_progressIds.length) {
			FloatplaneAPI.getProgress(_progressIds).then((progMap) => {
				for (var pk in progMap) {
					if (progMap[pk] > 0) AppCtx.state._resumePct[pk] = progMap[pk];
				}
				// Update progress bars on cards
				for (var gci = 0; gci < _gridCards.length; gci++) {
					var pid = _gridCards[gci].getAttribute("data-video-id");
					var pct = pid && AppCtx.state._resumePct[pid];
					if (pct) {
						var thumb = _gridCards[gci].querySelector(".grid-card-thumb");
						if (thumb && !thumb.querySelector(".resume-bar")) {
							var bar = document.createElement("div");
							bar.className = "resume-bar";
							bar.style.width = pct + "%";
							thumb.appendChild(bar);
						}
					}
				}
			});
		}
		// Restore scroll position when coming back from details, then clear
		if (AppCtx.state._savedScrollPos) {
			var cv = document.getElementById("view-creator");
			if (cv) cv.scrollTop = AppCtx.state._savedScrollPos;
			AppCtx.state._savedScrollPos = 0;
		}
		// Ensure focused cards scroll into view (translate3d rows don't auto-scroll)
		if (!container._focusScroll) {
			container._focusScroll = (e) => {
				var t = e.target;
				if (
					t &&
					(t.classList.contains("grid-card") ||
						t.classList.contains("video-card"))
				)
					t.scrollIntoView({ block: "nearest", inline: "nearest" });
			};
			container.addEventListener("focus", container._focusScroll, true);
		}
		// Restore focus to the card that was previously viewed in details
		if (AppCtx.state._lastDetailsVideoId) {
			var restoreCard = container.querySelector(
				'.grid-card[data-video-id="' + AppCtx.state._lastDetailsVideoId + '"]',
			);
			if (restoreCard) {
				restoreCard.focus();
				console.log(
					"[NAV] restored focus to card " + AppCtx.state._lastDetailsVideoId,
				);
			} else {
				console.log(
					"[NAV] card not found for AppCtx.state._lastDetailsVideoId=" +
						AppCtx.state._lastDetailsVideoId,
				);
				var allCards = container.querySelectorAll(".grid-card");
				if (
					AppCtx.state._playIndex >= 0 &&
					AppCtx.state._playIndex < allCards.length
				) {
					allCards[AppCtx.state._playIndex].focus();
					console.log(
						"[NAV] fallback focus by AppCtx.state._playIndex=" +
							AppCtx.state._playIndex,
					);
				}
			}
			AppCtx.state._lastDetailsVideoId = null;
		} else if (!_focusAlreadySet) {
			// Fresh entry (no return-from-details) - land on the first grid
			// card so Down/Up navigation starts deterministically instead of
			// spatial-nav jumping to the last (e.g. "More") card. Skipped when
			// a requested video (browse "More" card) already has focus.
			var _fc = container.querySelector(".grid-card");
			if (_fc) _fc.focus();
		}
	}

	/** @param {Object} vid @returns {string} Grid card HTML */
	function _gridCardHtml(vid) {
		var thumbSmall = vid.thumbnail
			? AppCtx.util._thumb(vid.thumbnail, 400)
			: "";
		var thumbFull = vid.thumbnail ? vid.thumbnail.path || "" : "";
		var dur =
			vid.metadata && vid.metadata.videoDuration
				? AppCtx.util._fmtDuration(vid.metadata.videoDuration)
				: "";
		var _vidId = vid.id || vid.guid;
		var _pctGrid = AppCtx.state._resumePct[_vidId];
		var _barHtml = _pctGrid
			? '<div class="resume-bar" style="width:' + _pctGrid + '%"></div>'
			: "";
		var likes =
			vid.likes !== undefined
				? '<span class="card-like"><svg class="card-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> ' +
					vid.likes +
					"</span>"
				: "";
		var dislikes =
			vid.dislikes !== undefined
				? '<span class="card-dislike"><svg class="card-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg> ' +
					vid.dislikes +
					"</span>"
				: "";
		return (
			'<div class="grid-card" tabindex="0" data-video-id="' +
			_vidId +
			'" data-creator-id="' +
			((vid.creator && vid.creator.id) || "") +
			'">' +
			'<div class="grid-card-thumb">' +
			(thumbSmall
				? '<img src="' +
					thumbSmall +
					'" data-full="' +
					thumbFull +
					'" loading="lazy" decoding="async" class="card-thumb-img">'
				: "") +
			(dur ? '<span class="card-duration">' + dur + "</span>" : "") +
			_barHtml +
			"</div>" +
			'<div class="grid-card-title">' +
			(vid.title || "") +
			"</div>" +
			'<div class="grid-card-meta">' +
			AppCtx.util._fmtDate(vid.releaseDate) +
			likes +
			dislikes +
			"</div></div>"
		);
	}

	AppCtx.views.creator = {
		showCreator: showCreator,
		_loadCreatorVideos: _loadCreatorVideos,
		_makeGridCard: _makeGridCard,
		_gridCardHtml: _gridCardHtml,
	};
})();
