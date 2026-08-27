/**
 * @fileoverview Details view - hero, metadata, comments, resolution picker.
 * Registers into AppCtx.views.details.
 */
(() => {
	// =========================================================================
	// WATCH-LATER ICONS (bookmark + play, with status badge)
	// =========================================================================

	/** Watch Add to list.svg - plus badge (not yet saved) */
	var _WL_ICON_ADD =
		'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' +
		'<path d="M19 11V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l7-5 3.5 2.5"/>' +
		'<polygon points="10 8 15 11 10 14 10 8" fill="currentColor" stroke="none"/>' +
		'<line x1="20" y1="13" x2="20" y2="19"/><line x1="17" y1="16" x2="23" y2="16"/>' +
		"</svg>";

	/** Watch In the List.svg - checkmark badge (already saved) */
	var _WL_ICON_IN_LIST =
		'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' +
		'<path d="M19 11V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l7-5 3.5 2.5"/>' +
		'<polygon points="10 8 15 11 10 14 10 8" fill="currentColor" stroke="none"/>' +
		'<polyline points="17 16 19.5 18 23.5 13"/>' +
		"</svg>";

	// =========================================================================
	// DETAIL PAGE  (hero + metadata + play button)
	// =========================================================================

	/** @param {Object} vid @param {string} creatorId */
	function showDetails(vid, creatorId) {
		console.log(
			"[NAV] showDetails: " + (vid.title || vid.id || "").substring(0, 80),
		);
		// Save scroll position before leaving creator view
		var cv = document.getElementById("view-creator");
		if (cv) AppCtx.state._savedScrollPos = cv.scrollTop || 0;
		AppCtx.state._lastDetailsCreator = creatorId;
		AppCtx.state._lastDetailsVideoId = vid.id || vid.guid || null;
		AppCtx.util._show("view-details");
		var container = document.getElementById("details-content");
		var thumb = vid.thumbnail ? vid.thumbnail.path : "";
		var title = vid.title || "Untitled";
		var desc = vid.text
			? vid.text.replace(/<[^>]*>/g, "").substring(0, 300)
			: "";
		var date = AppCtx.util._fmtDate(vid.releaseDate);
		var dur =
			vid.metadata && vid.metadata.videoDuration
				? AppCtx.util._fmtDuration(vid.metadata.videoDuration)
				: "";
		var chTitle = (vid.channel && vid.channel.title) || "";
		var videoId = vid.id || vid.guid;
		var attachmentId = (vid.attachmentOrder && vid.attachmentOrder[0]) || null;
		var hasVideo = !!attachmentId;
		// Audio / text-only post detection (CMSBlogPostMetadataInfo shape):
		// metadata.{hasVideo,hasAudio,videoCount,audioCount} - audio posts carry
		// an audio attachment (no video), text posts carry neither.
		var _meta = vid.metadata || {};
		var hasAudio =
			_meta.hasAudio === true ||
			(_meta.audioCount || 0) > 0 ||
			(vid.audioAttachments && vid.audioAttachments.length > 0);
		var hasVideoAtt =
			_meta.hasVideo === true ||
			(_meta.videoCount || 0) > 0 ||
			(vid.videoAttachments && vid.videoAttachments.length > 0);
		var isAudioOnly = hasAudio && !hasVideoAtt;
		var isTextOnly = !hasVideoAtt && !hasAudio && !attachmentId;
		var playEnabled = !!attachmentId || hasAudio;
		var playLabel = isAudioOnly
			? "▶ Play audio"
			: playEnabled
				? "▶ Play"
				: "No video";
		// Post-type badge (SVG ribbon): AUDIO for audio-only, TEXT for text-only.
		var _typeBadge = "";
		if (isAudioOnly)
			_typeBadge =
				'<svg class="type-badge" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/></svg><span class="type-badge-label">AUDIO</span>';
		else if (isTextOnly)
			_typeBadge =
				'<svg class="type-badge" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span class="type-badge-label">TEXT</span>';

		container.innerHTML =
			'<div class="details-backdrop">' +
			(thumb
				? '<img src="' + thumb + '" loading="lazy" decoding="async">'
				: '<div style="height:100%;background:linear-gradient(135deg,#0a0a0a,#1a1a2e)"></div>') +
			'<div class="backdrop-gradient"></div></div>' +
			'<div class="details-content">' +
			'<h1 class="details-title">' +
			title +
			"</h1>" +
			'<div class="details-subtitle">' +
			(dur ? '<span class="match">' + dur + "</span>" : "") +
			(date ? '<span class="dot"></span><span>' + date + "</span>" : "") +
			(chTitle ? '<span class="dot"></span><span>' + chTitle + "</span>" : "") +
			'<span class="dot"></span><span class="hd-badge">HD</span>' +
			_typeBadge +
			"</div>" +
			(isAudioOnly
				? '<div class="eq" id="details-eq" aria-hidden="true">' +
					"<span></span><span></span><span></span><span></span><span></span>" +
					"</div>"
				: "") +
			'<div class="details-actions">' +
			(playEnabled
				? '<button id="btn-play" class="action-btn play">' +
					playLabel +
					"</button>"
				: "") +
			'<button id="btn-watch-later" class="action-btn secondary">' +
			(FloatplaneAPI.isInWatchLater(videoId)
				? _WL_ICON_IN_LIST
				: _WL_ICON_ADD) +
			(FloatplaneAPI.isInWatchLater(videoId) ? "Saved" : "Watch later") +
			"</button>" +
			'<button id="btn-back" class="action-btn secondary">Back</button>' +
			'<button id="btn-play-audio" class="action-btn secondary" style="display:none;margin-left:8px">' +
			'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>Play audio</button>' +
			(AppCtx.util._loadResume(videoId)
				? '<button id="btn-clear-resume" class="action-btn secondary" style="margin-left:8px">✕ Clear resume</button>'
				: "") +
			"</div>" +
			(desc ? '<div class="details-description">' + desc + "</div>" : "") +
			'<div class="details-stats">' +
			'<button id="dtl-like" class="stat-btn" tabindex="0"' +
			(AppCtx.state.VIDEOS["_myint_" + videoId] === "like"
				? ' style="border-color:#0095D6;color:#0095D6"'
				: "") +
			'"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg><span>Like ' +
			(vid.likes || 0) +
			"</span></button>" +
			'<button id="dtl-dislike" class="stat-btn" tabindex="0"' +
			(AppCtx.state.VIDEOS["_myint_" + videoId] === "dislike"
				? ' style="border-color:#0095D6;color:#0095D6"'
				: "") +
			'"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg><span>Dislike ' +
			(vid.dislikes || 0) +
			"</span></button>" +
			(vid.views !== undefined || vid.viewCount !== undefined
				? '<span class="stat">Views ' +
					(vid.views || vid.viewCount || 0) +
					"</span>"
				: "") +
			"</div></div>" +
			'<div id="comments-section"><h3 class="comments-heading">Comments</h3>' +
			'<div id="comments-list"></div><div id="comments-loader" style="display:none;padding:20px;text-align:center;color:#666">Loading...</div></div>';

		// Wire like/dislike buttons
		var likeBtn = document.getElementById("dtl-like");
		var dislikeBtn = document.getElementById("dtl-dislike");
		var _setCount = (btn, n) => {
			var label = btn === likeBtn ? "Like " : "Dislike ";
			var span = btn.querySelector("span");
			if (span) span.textContent = label + Math.max(0, n);
			else btn.textContent = label + Math.max(0, n);
		};
		var _getCount = (btn) =>
			parseInt(btn.textContent.replace(/[^0-9]/g, ""), 10) || 0;
		var _syncFromApi = () => {
			FloatplaneAPI.getPostInfo(videoId)
				.then((post) => {
					if (!post) return;
					if (post.selfUserInteraction)
						AppCtx.util._setCache(
							"_myint_" + videoId,
							post.selfUserInteraction,
						);
					// Don't overwrite counts with potentially stale server data
					// (optimistic UI already shows the new count; server may
					// still return the old count for a moment, causing a
					// visible bounce). Only sync the interaction state.
					_updateInteraction();
				})
				.catch(() => {});
		};
		var _updateInteraction = () => {
			var st = AppCtx.state.VIDEOS["_myint_" + videoId];
			likeBtn.style.borderColor = st === "like" ? "#0095D6" : "";
			likeBtn.style.color = st === "like" ? "#0095D6" : "";
			dislikeBtn.style.borderColor = st === "dislike" ? "#0095D6" : "";
			dislikeBtn.style.color = st === "dislike" ? "#0095D6" : "";
		};
		likeBtn.addEventListener("click", () => {
			var cur = AppCtx.state.VIDEOS["_myint_" + videoId];
			var likeC = _getCount(likeBtn);
			var disC = _getCount(dislikeBtn);
			if (cur === "like") {
				_setCount(likeBtn, likeC - 1);
			} else if (cur === "dislike") {
				_setCount(likeBtn, likeC + 1);
				_setCount(dislikeBtn, disC - 1);
			} else {
				_setCount(likeBtn, likeC + 1);
			}
			var nextState = cur === "like" ? "none" : "like";
			AppCtx.util._setCache("_myint_" + videoId, nextState);
			_updateInteraction();
			FloatplaneAPI.likeContent(videoId)
				.then((res) => {
					// Use server's authoritative interaction state (UserInteractionModel).
					// The like endpoint toggles and returns the new state like ["like"].
					var serverState = null;
					if (Array.isArray(res)) serverState = res[0] || "none";
					else if (typeof res === "string") serverState = res;
					if (serverState === "like" || serverState === "dislike") {
						AppCtx.util._setCache("_myint_" + videoId, serverState);
					} else if (serverState === "none" || (Array.isArray(res) && res.length === 0)) {
						AppCtx.util._setCache("_myint_" + videoId, "none");
						serverState = "none";
					} else {
						// Server didn't return a clear state - keep optimistic
						serverState = nextState;
					}
					_updateInteraction();
					// If server state differs from optimistic, revert counts to match server
					if (serverState !== nextState) {
						_setCount(likeBtn, likeC);
						_setCount(dislikeBtn, disC);
						AppCtx.util._setCache("_myint_" + videoId, serverState);
						_updateInteraction();
					}
				})
				.catch(() => {
					// Revert optimistic UI on failure
					_setCount(likeBtn, likeC);
					_setCount(dislikeBtn, disC);
					AppCtx.util._setCache("_myint_" + videoId, cur || "none");
					_updateInteraction();
				});
		});
		dislikeBtn.addEventListener("click", () => {
			var cur = AppCtx.state.VIDEOS["_myint_" + videoId];
			var likeC = _getCount(likeBtn);
			var disC = _getCount(dislikeBtn);
			if (cur === "dislike") {
				_setCount(dislikeBtn, disC - 1);
			} else if (cur === "like") {
				_setCount(dislikeBtn, disC + 1);
				_setCount(likeBtn, likeC - 1);
			} else {
				_setCount(dislikeBtn, disC + 1);
			}
			var nextState = cur === "dislike" ? "none" : "dislike";
			AppCtx.util._setCache("_myint_" + videoId, nextState);
			_updateInteraction();
			FloatplaneAPI.dislikeContent(videoId)
				.then((res) => {
					var serverState = null;
					if (Array.isArray(res)) serverState = res[0] || "none";
					else if (typeof res === "string") serverState = res;
					if (serverState === "like" || serverState === "dislike") {
						AppCtx.util._setCache("_myint_" + videoId, serverState);
					} else if (serverState === "none" || (Array.isArray(res) && res.length === 0)) {
						AppCtx.util._setCache("_myint_" + videoId, "none");
						serverState = "none";
					} else {
						serverState = nextState;
					}
					_updateInteraction();
					if (serverState !== nextState) {
						_setCount(likeBtn, likeC);
						_setCount(dislikeBtn, disC);
						AppCtx.util._setCache("_myint_" + videoId, serverState);
						_updateInteraction();
					}
				})
				.catch(() => {
					_setCount(likeBtn, likeC);
					_setCount(dislikeBtn, disC);
					AppCtx.util._setCache("_myint_" + videoId, cur || "none");
					_updateInteraction();
				});
		});
		// Fetch user's like state + counts from API
		FloatplaneAPI.getPostInfo(videoId)
			.then((post) => {
				if (!post) return;
				// Keep the full post - it has the definitive attachment lists
				// (the cached grid object may lack them / order them oddly)
				_fullPost = post;
				// Reconcile the play button with the full post's real content.
				// attachmentOrder alone is NOT proof of media - it can contain
				// picture attachments (picture-only posts have nothing to play).
				var _pMeta = post.metadata || {};
				var _pPlayable =
					(post.videoAttachments && post.videoAttachments.length > 0) ||
					(post.audioAttachments && post.audioAttachments.length > 0) ||
					_pMeta.hasVideo === true ||
					_pMeta.hasAudio === true ||
					(_pMeta.videoCount || 0) > 0 ||
					(_pMeta.audioCount || 0) > 0;
				var _pBtn = document.getElementById("btn-play");
				if (_pBtn) {
					_pBtn.style.display = _pPlayable ? "" : "none";
					_pBtn.setAttribute("tabindex", _pPlayable ? "0" : "-1");
				}
				// Offer "Play audio" next to Back when audio exists alongside
				// video (audio-only posts already use the main button)
				var _pHasVid =
					_pMeta.hasVideo === true ||
					(post.videoAttachments && post.videoAttachments.length > 0) ||
					(_pMeta.videoCount || 0) > 0;
				var _pHasAud =
					_pMeta.hasAudio === true ||
					(post.audioAttachments && post.audioAttachments.length > 0) ||
					(_pMeta.audioCount || 0) > 0;
				var _pAudBtn = document.getElementById("btn-play-audio");
				if (_pAudBtn) {
					_pAudBtn.style.display = _pHasVid && _pHasAud ? "" : "none";
					_pAudBtn.setAttribute("tabindex", _pHasVid && _pHasAud ? "0" : "-1");
				}
				if (post.selfUserInteraction)
					AppCtx.util._setCache("_myint_" + videoId, post.selfUserInteraction);
				if (post.likes !== undefined) _setCount(likeBtn, post.likes);
				if (post.dislikes !== undefined) _setCount(dislikeBtn, post.dislikes);
				_updateInteraction();
			})
			.catch(() => {
				// Full post unreachable (picture-only posts 404) - keep the
				// play button only if the cached object shows real media
				// (attachmentOrder[0] can be a picture attachment)
				var _mediaEv =
					(vid.videoAttachments && vid.videoAttachments.length > 0) ||
					(vid.audioAttachments && vid.audioAttachments.length > 0) ||
					_meta.hasVideo === true ||
					(_meta.videoCount || 0) > 0 ||
					_meta.hasAudio === true ||
					(_meta.audioCount || 0) > 0;
				if (!_mediaEv) {
					var _pb2 = document.getElementById("btn-play");
					if (_pb2) {
						_pb2.style.display = "none";
						_pb2.setAttribute("tabindex", "-1");
					}
				}
			});

		var playBtn = document.getElementById("btn-play");
		// Playback path resolved from the FULL post: a post can carry both
		// audio and video attachments, and attachmentOrder[0] may be the audio
		// one (which Shaka can't play) - prefer the video attachment.
		var _fullPost = null;
		var _play = () => {
			var p = _fullPost || vid;
			var meta = p.metadata || {};
			var hasVid =
				(p.videoAttachments && p.videoAttachments.length > 0) ||
				meta.hasVideo === true ||
				(meta.videoCount || 0) > 0;
			var hasAud =
				(p.audioAttachments && p.audioAttachments.length > 0) ||
				meta.hasAudio === true ||
				(meta.audioCount || 0) > 0;
			var aid =
				(p.videoAttachments &&
					p.videoAttachments[0] &&
					p.videoAttachments[0].id) ||
				(p.attachmentOrder && p.attachmentOrder[0]) ||
				null;
			var audioId =
				(p.audioAttachments &&
					p.audioAttachments[0] &&
					p.audioAttachments[0].id) ||
				videoId;
			if (!hasVid && hasAud) {
				showAudioPicker(audioId, title);
			} else if (aid) {
				showResolutionPicker(aid, videoId);
			} else if (hasAud) {
				showAudioPicker(audioId, title);
			}
		};
		if (playBtn) {
			playBtn.addEventListener("click", () => {
				if (_fullPost) {
					_play();
					return;
				}
				// Cached object too sparse to trust - fetch the full post first
				FloatplaneAPI.getPostInfo(videoId)
					.then((post) => {
						if (post) _fullPost = post;
						_play();
					})
					.catch(() => _play());
			});
			playBtn.setAttribute("tabindex", "0");
		}
		var playAudioBtn = document.getElementById("btn-play-audio");
		if (playAudioBtn) {
			playAudioBtn.setAttribute("tabindex", "0");
			playAudioBtn.addEventListener("click", () => {
				// Delivery needs the AUDIO ATTACHMENT id - on posts with both
				// audio and video the content id is not an attachment (404)
				var p = _fullPost || vid;
				var audioId =
					(p.audioAttachments &&
						p.audioAttachments[0] &&
						p.audioAttachments[0].id) ||
					videoId;
				showAudioPicker(audioId, title);
			});
		}

		// Watch later toggle (local, app-only)
		var wlBtn = document.getElementById("btn-watch-later");
		wlBtn.setAttribute("tabindex", "0");
		var _wlLabel = (saved) =>
			saved ? _WL_ICON_IN_LIST + "Saved" : _WL_ICON_ADD + "Watch later";
		wlBtn.addEventListener("click", function () {
			var inList = FloatplaneAPI.isInWatchLater(videoId);
			if (inList) {
				FloatplaneAPI.removeFromWatchLater(videoId);
				this.innerHTML = _wlLabel(false);
			} else {
				FloatplaneAPI.addToWatchLater({
					id: videoId,
					title: title,
					thumbnail: vid.thumbnail,
					creatorId: creatorId,
					creatorTitle: (vid.creator && vid.creator.title) || "",
				});
				this.innerHTML = _wlLabel(true);
			}
		});

		// Defer focus to prevent the original Enter event from propagating to the Play button
		clearTimeout(AppCtx.state._focusTimer);
		AppCtx.state._focusTimer = setTimeout(() => {
			var firstFocusable =
				document.getElementById("btn-play") ||
				document.getElementById("btn-watch-later") ||
				document.getElementById("btn-back");
			if (firstFocusable) firstFocusable.focus();
			AppCtx.state._focusTimer = null;
		}, 100);
		document
			.getElementById("btn-back")
			.addEventListener("click", AppCtx.views.app.goBack);
		var clearBtn = document.getElementById("btn-clear-resume");
		if (clearBtn) {
			clearBtn.addEventListener("click", function () {
				AppCtx.util._clearResume(videoId);
				this.style.display = "none";
			});
		}

		// Comments fetch their own badge definitions via batch ID lookup
		_loadComments(videoId, null);
	}

	// =========================================================================
	// COMMENTS
	// =========================================================================

	/** HTML-escape a string for safe innerHTML insertion. */
	function _esc(s) {
		return String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	/**
	 * Supporter badge catalog: badgeId -> {title, image}. Populated lazily by
	 * batching the comment badge IDs through POST /api/v3/achievement/perks.
	 * @private {?Object<string, Object>}
	 */
	var _badgeCatalog = null;

	/**
	 * Fetch badge definitions for the given IDs and merge into the catalog.
	 * @param {Array<string>} ids
	 * @returns {Promise<Object<string, Object>>}
	 */
	function _loadBadges(ids) {
		if (!ids || !ids.length) return Promise.resolve(_badgeCatalog || {});
		if (!_badgeCatalog) _badgeCatalog = {};
		var missing = [];
		ids.forEach((id) => {
			if (!_badgeCatalog[id]) missing.push(id);
		});
		if (!missing.length) return Promise.resolve(_badgeCatalog);
		return FloatplaneAPI.getBadgePerks(missing)
			.then((perks) => {
				if (Array.isArray(perks)) {
					perks.forEach((p) => {
						if (!p || !p.id || !p.image) return;
						_badgeCatalog[p.id] = {
							title: p.title || "",
							image: p.image.path || "",
						};
					});
				}
				return _badgeCatalog;
			})
			.catch((err) => {
				console.warn("[BADGES] perk fetch failed", err && err.message);
				return _badgeCatalog;
			});
	}

	/**
	 * Render supporter badge icons for a comment.
	 * @param {Array<string>} badgeIds Comment badge IDs (from c.badges)
	 * @param {Object<string, Object>} catalog id -> {title, image}
	 * @returns {string} HTML of badge icons (images)
	 */
	function _badgeIcons(badgeIds, catalog) {
		if (!Array.isArray(badgeIds) || !catalog) return "";
		var out = "";
		badgeIds.forEach((id) => {
			var entry = catalog[id];
			if (!entry || !entry.image) return;
			out +=
				'<img class="c-badge" src="' +
				entry.image +
				'" alt="' +
				entry.title +
				'" title="' +
				entry.title +
				'" decoding="async">';
		});
		return out;
	}

	/**
	 * Load and render the comment list for a post.
	 * @param {string} contentId Blog post ID
	 * @param {?string} cursor Pagination cursor
	 */
	function _loadComments(contentId, cursor) {
		var list = document.getElementById("comments-list");
		var loader = document.getElementById("comments-loader");
		if (!list) return;
		if (loader) loader.style.display = "block";
		FloatplaneAPI.getComments(contentId, cursor, 20)
			.then((data) => {
				if (loader) loader.style.display = "none";
				var comments = Array.isArray(data) ? data : [];
				if (!comments || !comments.length) {
					if (!cursor)
						list.innerHTML = '<div class="no-comments">No comments yet</div>';
					return;
				}
				// Show "<n> Comments" from the loaded page count
				var _hd = document.querySelector("#comments-section .comments-heading");
				if (_hd) _hd.textContent = comments.length + " Comments";
				// Collect badge IDs from all comments (both the comment-level
				// IDs and any inline user badge objects), fetch perk definitions
				// in one batch, then render (so every badge icon resolves).
				var badgeIds = [];
				comments.forEach((c) => {
					if (Array.isArray(c.badges))
						c.badges.forEach((b) => badgeIds.push(b));
					var ub = c.user && c.user.badges;
					if (Array.isArray(ub))
						ub.forEach((b) => {
							// user.badges entries are plain ID strings
							if (typeof b === "string") badgeIds.push(b);
							else if (b && b.id) badgeIds.push(b.id);
						});
				});
				console.log(
					"[BADGES] collected " +
						badgeIds.length +
						" ids: " +
						JSON.stringify(badgeIds.slice(0, 12)),
				);
				var _renderAll = () => {
					comments.forEach((c) => {
						var div = document.createElement("div");
						div.className = "comment";
						div.tabIndex = 0;
						var user = c.user || {};
						var avatar = (user.profileImage && user.profileImage.path) || "";
						var name = _esc(user.username || "Anonymous");
						// Inline badge objects take priority; plain IDs resolve
						// via the batch-fetched catalog.
						var badges = "";
						if (Array.isArray(user.badges))
							badges = _badgeIcons(user.badges, _badgeCatalog);
						if (!badges) badges = _badgeIcons(c.badges, _badgeCatalog);
						if (Array.isArray(user.badges) && user.badges.length && !badges)
							console.warn(
								"[BADGES] user " +
									name +
									" has " +
									user.badges.length +
									" badge ids but none resolved: " +
									JSON.stringify(user.badges),
							);
						var body = c.text
							? _esc(c.text)
									.replace(/<[^>]*>/g, "")
									.substring(0, 500)
							: "";
						var time = c.postDate ? _esc(AppCtx.util._fmtDate(c.postDate)) : "";
						// Counts: webapp shape uses {likes,dislikes}; the v3 list
						// shape uses interactionCounts.{like,dislike}. Handle both.
						var _ic = c.interactionCounts || {};
						var likeCount =
							_ic.like !== undefined
								? _ic.like
								: c.likes !== undefined
									? c.likes
									: 0;
						var dislikeCount =
							_ic.dislike !== undefined
								? _ic.dislike
								: c.dislikes !== undefined
									? c.dislikes
									: 0;
						// userInteraction is a string: "none"|"like"|"dislike"
						var _myInt =
							c.userInteraction !== undefined
								? c.userInteraction
								: c.selfUserInteraction !== undefined
									? c.selfUserInteraction
									: "none";
						var likes =
							'<button class="cl cl-btn' +
							(_myInt === "like" ? " on" : "") +
							'" data-action="like"><svg class="cl-ic cl-up" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> <span class="cl-count">' +
							likeCount +
							"</span></button>";
						var dislikes =
							'<button class="cl cl-btn' +
							(_myInt === "dislike" ? " on" : "") +
							'" data-action="dislike"><svg class="cl-ic cl-down" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg> <span class="cl-count">' +
							dislikeCount +
							"</span></button>";
						// Delete only on your own comments - computing here so the
						// button is not rendered (and not focusable) for others.
						var _cid = c.id;
						var _isMine = !!(
							FloatplaneAPI.getUserInfo() &&
							user.id &&
							FloatplaneAPI.getUserInfo().sub === user.id
						);
						var deleteBtn = _isMine
							? '<button class="cl cl-btn cl-del" data-action="delete">✕</button>'
							: "";
						div.innerHTML =
							'<div class="c-avatar">' +
							(avatar
								? '<img src="' + _esc(avatar) + '">'
								: '<span class="c-initial">' + name[0] + "</span>") +
							"</div>" +
							'<div class="c-body"><div class="c-name">' +
							name +
							badges +
							' <span class="c-time">' +
							time +
							"</span></div>" +
							'<div class="c-text">' +
							body +
							"</div>" +
							'<div class="c-actions">' +
							likes +
							dislikes +
							deleteBtn +
							"</div></div>";
						list.appendChild(div);
						// Per-comment wiring: like / dislike / delete.
						var _btns = div.querySelectorAll("[data-action]");
						for (var bi = 0; bi < _btns.length; bi++) {
							_btns[bi].addEventListener("click", function () {
								var act = this.getAttribute("data-action");
								if (act === "like" || act === "dislike") {
									var btnEl = this;
									var all = div.querySelectorAll(".cl-btn");
									var likeBtnC = div.querySelector('[data-action="like"]');
									var dislikeBtnC = div.querySelector('[data-action="dislike"]');
									var likeCountEl = likeBtnC
										? likeBtnC.querySelector(".cl-count")
										: null;
									var dislikeCountEl = dislikeBtnC
										? dislikeBtnC.querySelector(".cl-count")
										: null;
									var getC = (el) =>
										parseInt(
											(el && el.textContent.replace(/[^0-9]/g, "")) || "0",
											10,
										) || 0;
									var likeCVal = getC(likeCountEl);
									var dislikeCVal = getC(dislikeCountEl);
									var isLiked =
										likeBtnC && likeBtnC.classList.contains("on");
									var isDisliked =
										dislikeBtnC && dislikeBtnC.classList.contains("on");
									var oldLike = likeCVal,
										oldDis = dislikeCVal;
									var oldLiked = isLiked,
										oldDisliked = isDisliked;
									// Optimistic UI - update counts and active state immediately
									if (act === "like") {
										if (isLiked) {
											if (likeCountEl)
												likeCountEl.textContent = String(Math.max(0, likeCVal - 1));
										} else if (isDisliked) {
											if (likeCountEl) likeCountEl.textContent = String(likeCVal + 1);
											if (dislikeCountEl)
												dislikeCountEl.textContent = String(
													Math.max(0, dislikeCVal - 1),
												);
										} else {
											if (likeCountEl) likeCountEl.textContent = String(likeCVal + 1);
										}
										for (var ai = 0; ai < all.length; ai++) all[ai].classList.remove("on");
										if (!isLiked) btnEl.classList.add("on");
									} else {
										if (isDisliked) {
											if (dislikeCountEl)
												dislikeCountEl.textContent = String(Math.max(0, dislikeCVal - 1));
										} else if (isLiked) {
											if (dislikeCountEl) dislikeCountEl.textContent = String(dislikeCVal + 1);
											if (likeCountEl)
												likeCountEl.textContent = String(Math.max(0, likeCVal - 1));
										} else {
											if (dislikeCountEl) dislikeCountEl.textContent = String(dislikeCVal + 1);
										}
										for (var ai2 = 0; ai2 < all.length; ai2++) all[ai2].classList.remove("on");
										if (!isDisliked) btnEl.classList.add("on");
									}
									FloatplaneAPI[
										act === "like" ? "likeComment" : "dislikeComment"
									](_cid, contentId).catch(() => {
											// Revert optimistic UI on failure
											if (likeCountEl) likeCountEl.textContent = String(oldLike);
											if (dislikeCountEl) dislikeCountEl.textContent = String(oldDis);
											for (var ri = 0; ri < all.length; ri++) all[ri].classList.remove("on");
											if (oldLiked && likeBtnC) likeBtnC.classList.add("on");
											if (oldDisliked && dislikeBtnC) dislikeBtnC.classList.add("on");
										});
								} else if (act === "delete") {
									if (!_isMine) return;
									FloatplaneAPI.deleteComment(_cid)
										.then(() => {
											div.parentNode.removeChild(div);
										})
										.catch(() => {
											AppCtx.util._toast("Could not delete comment");
										});
								}
							});
						}
					});
				};
				_loadBadges(badgeIds).then(() => {
					_renderAll();
					// Invalidate spatial-nav cache so fresh comment nodes are included
					AppCtx.state._focusCacheView = null;
				});
			})
			.catch(() => {
				if (loader) loader.style.display = "none";
				if (!cursor)
					list.innerHTML =
						'<div class="no-comments">Failed to load comments</div>';
			});
	}

	// =========================================================================
	// RESOLUTION PICKER
	// =========================================================================

	/**
	 * Fetch delivery info and start playback, applying quality preference.
	 *
	 * Builds a quality list from `delivery.levels` (clean label/height/order)
	 * and matches each level to a variant URL by height.
	 * Uses master HLS URL (`delivery.urls.hls`) when available - Shaka loads
	 * the full manifest and filters unsupported codecs automatically.
	 * Otherwise picks the best variant URL matching the user's quality cap.
	 *
	 * @param {string} entityId Attachment ID
	 * @param {string} contentId Blog post ID (for like/dislike tracking)
	 */
	function showResolutionPicker(entityId, contentId) {
		AppCtx.util._toast("Loading stream...");
		FloatplaneAPI.getDeliveryInfo(entityId)
			.then((delivery) => {
				// Build a height→URL map from groups/variants
				var urlByHeight = {};
				var cdn = "";
				if (delivery.groups && delivery.groups.length) {
					var group = delivery.groups[0];
					cdn =
						(group.origins && group.origins[0] && group.origins[0].url) || "";
					(group.variants || []).forEach((v) => {
						if (v.enabled === false || v.hidden) return;
						var h = (v.meta && v.meta.video && v.meta.video.height) || 0;
						urlByHeight[h] = cdn + (v.url || "");
					});
				}
				// Parse levels for clean quality list (label, height, order)
				var levels = [];
				var masterUrl =
					delivery.urls && delivery.urls.hls ? delivery.urls.hls : "";
				if (delivery.levels && delivery.levels.length) {
					(delivery.levels || []).forEach((l) => {
						levels.push({
							label: l.label || (l.height ? l.height + "p" : "?"),
							height: l.height || 0,
							order: l.order || 0,
							url: urlByHeight[l.height] || "",
						});
					});
					levels.sort((a, b) => b.height - a.height);
				} else if (cdn) {
					// No levels: build from variants directly
					Object.keys(urlByHeight).forEach((h) => {
						var nh = parseInt(h, 10);
						levels.push({
							label: nh ? nh + "p" : "?",
							height: nh,
							order: nh,
							url: urlByHeight[h],
						});
					});
					levels.sort((a, b) => b.height - a.height);
				}
				AppCtx.state._CACHED_VARIANTS = levels;
				if (!levels.length && !masterUrl) {
					AppCtx.util._toast("No streams");
					return;
				}
				var streamUrl;
				if (masterUrl) {
					streamUrl = masterUrl;
				} else {
					var prefQ = "";
					try {
						prefQ = localStorage.getItem("pref_quality") || "";
					} catch (e) {}
					if (prefQ && prefQ !== "auto") {
						var targetH = parseInt(prefQ, 10);
						if (targetH) {
							for (var vi = 0; vi < levels.length; vi++) {
								if (levels[vi].height <= targetH && levels[vi].url) {
									streamUrl = levels[vi].url;
									break;
								}
							}
						}
					}
					if (!streamUrl) {
						for (var vi = 0; vi < levels.length; vi++) {
							if (levels[vi].url) {
								streamUrl = levels[vi].url;
								break;
							}
						}
					}
				}
				if (!streamUrl) {
					AppCtx.util._toast("No streams");
					return;
				}
				AppCtx.views.player.startPlayback(entityId, streamUrl, contentId);
			})
			.catch(() => {
				AppCtx.util._toast("Failed to get stream");
			});
	}

	/**
	 * Play an audio-only post. Audio attachments resolve like video delivery
	 * info (HLS with audio-only variants); no resolution picker - just play.
	 * @param {string} contentId Audio attachment ID
	 * @param {string} [title] Display title for the player
	 */
	function showAudioPicker(contentId, title) {
		AppCtx.util._toast("Loading audio...");
		FloatplaneAPI.getDeliveryInfo(contentId)
			.then((delivery) => {
				var url = "";
				var group = delivery.groups && delivery.groups[0];
				var cdn =
					(group &&
						group.origins &&
						group.origins[0] &&
						group.origins[0].url) ||
					"";
				if (delivery.urls && delivery.urls.hls) url = delivery.urls.hls;
				else if (group && group.variants && group.variants.length) {
					var v = group.variants[0];
					url = v.url || "";
					if (url.indexOf("/") === 0 && cdn) url = cdn + url;
				}
				if (!url) {
					AppCtx.util._toast("No audio stream");
					return;
				}
				AppCtx.views.player.startPlayback(
					contentId,
					url,
					contentId,
					true,
					title,
				);
			})
			.catch(() => {
				AppCtx.util._toast("Failed to load audio");
			});
	}

	AppCtx.views.details = {
		showDetails: showDetails,
		_loadComments: _loadComments,
		showResolutionPicker: showResolutionPicker,
		showAudioPicker: showAudioPicker,
	};
})();
