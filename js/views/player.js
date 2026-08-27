/**
 * @fileoverview Player view - playback, controls, overlay.
 * Registers into AppCtx.views.player.
 */
(() => {
	// PLAYER
	// =========================================================================

	// =========================================================================
	// SUBTITLE STYLES
	// =========================================================================

	var _subStyleEl = null;

	/** Read subtitle prefs and inject CSS into the player view. */
	function _applySubtitleStyle() {
		if (!_subStyleEl) {
			_subStyleEl = document.createElement("style");
			_subStyleEl.id = "subtitle-style";
		}
		var color = "white";
		var bottom = "0px";
		try {
			color = localStorage.getItem("pref_sub_color") || "white";
			var offset = localStorage.getItem("pref_sub_offset") || "normal";
			if (offset === "higher") bottom = "60px";
		} catch (e) {}
		_subStyleEl.textContent =
			"video::-webkit-media-text-track-display { color: " +
			color +
			" !important; }" +
			"video::cue { color: " +
			color +
			" !important; }" +
			"video::-webkit-media-text-track-container { bottom: " +
			bottom +
			" !important; }" +
			"#player-video .shaka-text-container { bottom: " +
			bottom +
			" !important; }" +
			"#player-video .shaka-text-container span { color: " +
			color +
			" !important; }";
		if (!_subStyleEl.parentNode) {
			var playerView = document.getElementById("view-player");
			if (playerView) playerView.appendChild(_subStyleEl);
		}
	}

	// Helper: play video at queue index using its delivery info
	var _isTransitioning = false;
	function _playQueueIndex(idx) {
		if (_isTransitioning) {
			console.log("[PLAY] _playQueueIndex blocked by _isTransitioning");
			return;
		}
		_isTransitioning = true;
		if (idx < 0 || idx >= AppCtx.state._playQueue.length) {
			AppCtx.util._toast(idx < 0 ? "At first video" : "At last video");
			_isTransitioning = false;
			return;
		}
		var v = AppCtx.state._playQueue[idx];
		var aid = v.attachmentOrder && v.attachmentOrder[0];
		if (!aid) {
			AppCtx.util._toast("No video attachment");
			_isTransitioning = false;
			return;
		}
		AppCtx.state._playIndex = idx;
		AppCtx.util._toast(">> " + (v.title || "").substring(0, 40));
		var prefQ = "";
		try {
			prefQ = localStorage.getItem("pref_quality") || "";
		} catch (e) {}
		FloatplaneAPI.getDeliveryInfo(aid)
			.then((d) => {
				var group = d.groups && d.groups[0];
				if (!group) {
					AppCtx.util._toast("No streams");
					_isTransitioning = false;
					return;
				}
				var cdn =
					(group.origins && group.origins[0] && group.origins[0].url) ||
					group.cdn ||
					group.baseUrl ||
					"";
				var variants = group.variants || [];
				if (!variants.length) {
					AppCtx.util._toast("No streams");
					_isTransitioning = false;
					return;
				}
				var chosen = null;
				if (prefQ && prefQ !== "auto") {
					var targetH = parseInt(prefQ, 10);
					if (targetH) {
						// Find best variant ≤ targetH, preferring highest
						for (var vi = 0; vi < variants.length; vi++) {
							var vv = variants[vi];
							var h =
								(vv.meta && vv.meta.video && vv.meta.video.height) ||
								vv.height ||
								0;
							if (
								h <= targetH &&
								(!chosen ||
									h >
										((chosen.meta &&
											chosen.meta.video &&
											chosen.meta.video.height) ||
											chosen.height ||
											0))
							)
								chosen = vv;
						}
					}
				}
				if (!chosen) chosen = variants[0];
				var url = chosen && chosen.url;
				if (url && url.indexOf("/") === 0) url = cdn + url;
				if (url) {
					startPlayback(aid, url, v.id || v.guid);
					_isTransitioning = false;
				} else {
					AppCtx.util._toast("Can't load stream");
					_isTransitioning = false;
				}
			})
			.catch(() => {
				AppCtx.util._toast("Playback failed");
				_isTransitioning = false;
			});
	}

	/**
	 * Play an audio-only stream on the dedicated native <audio> element,
	 * bypassing Shaka entirely (webOS natively handles HLS/AAC/MP3). Drives
	 * the EQ visualizer, progress bar, resume saving, and history reporting.
	 * @param {string} streamUrl
	 * @param {string} contentId
	 * @param {HTMLAudioElement} audioEl
	 * @param {HTMLElement} titleEl
	 * @param {HTMLElement} progressEl
	 * @param {HTMLElement} timeEl
	 * @param {string} title
	 */
	function _playNativeAudio(
		streamUrl,
		contentId,
		audioEl,
		titleEl,
		progressEl,
		timeEl,
		title,
	) {
		titleEl.textContent = title;
		audioEl.src = streamUrl;
		audioEl.load();
		// Resume from saved position once metadata is available
		var resume = AppCtx.util._loadResume(contentId);
		if (resume && resume.pos > 5) {
			var _seek = () => {
				try {
					audioEl.currentTime = Math.max(0, resume.pos - 3);
				} catch (e) {}
			};
			if (audioEl.readyState >= 1) _seek();
			else
				audioEl.addEventListener("loadedmetadata", function once() {
					audioEl.removeEventListener("loadedmetadata", once);
					_seek();
				});
		}
		var _lastServerSync = 0;
		var _syncProgress = () => {
			var d = audioEl.duration;
			if (d > 0) {
				FloatplaneAPI.updateProgress(
					contentId,
					"blogPost",
					Math.round((audioEl.currentTime / d) * 100),
				).catch(() => {});
			}
		};
		audioEl.ontimeupdate = () => {
			var d = audioEl.duration;
			if (d > 0) {
				progressEl.style.width = (audioEl.currentTime / d) * 100 + "%";
				timeEl.textContent =
					AppCtx.util._fmtDuration(audioEl.currentTime) +
					" / " +
					AppCtx.util._fmtDuration(d);
				AppCtx.util._saveResume(contentId, streamUrl, audioEl.currentTime, d);
				if (!audioEl.paused && Date.now() - _lastServerSync > 30000) {
					_lastServerSync = Date.now();
					_syncProgress();
				}
			}
		};
		audioEl.onended = () => {
			audioEl.removeAttribute("src");
			audioEl.load();
		};
		audioEl.onerror = () => {
			var m = audioEl.error;
			console.warn(
				"[PLAY] native audio error code=" +
					(m && m.code) +
					" msg=" +
					(m && m.message) +
					" url=" +
					(streamUrl || "").substring(0, 140) +
					" isPlaylist=" +
					/\.m3u8(\?|$)/i.test(streamUrl || ""),
			);
			AppCtx.util._toast("Playback error");
		};
		window._saveResumeOnStop = () => {
			var d = audioEl.duration;
			if (d > 0) {
				AppCtx.util._saveResume(contentId, streamUrl, audioEl.currentTime, d);
				_syncProgress();
			}
		};
		var p = audioEl.play();
		if (p && p.catch) p.catch(() => {});
	}

	/**
	 * Initialize player, load HLS, restore like state, apply preferences.
	 * @param {string} entityId Attachment ID
	 * @param {string} streamUrl
	 * @param {string} contentId Blog post ID
	 * @param {boolean} [isAudio] True for audio-only posts - shows EQ visualizer
	 * @param {string} [title] Optional display title (skips the metadata lookup)
	 */
	function startPlayback(entityId, streamUrl, contentId, isAudio, title) {
		console.log(
			"[PLAY] startPlayback entityId=" +
				entityId +
				" url=" +
				(streamUrl || "").substring(0, 60) +
				" isAudio=" +
				!!isAudio,
		);
		// Audio-only posts: show the WMP-era EQ visualizer overlay instead of
		// a black screen (the <video> element plays audio with no frames).
		var eqOverlay = document.getElementById("player-eq");
		if (eqOverlay) eqOverlay.classList.toggle("hidden", !isAudio);
		// Capture geek panel state before hiding everything
		var oldGeek = document.getElementById("player-geek-panel");
		var wasGeekOpen = oldGeek && !oldGeek.classList.contains("hidden");
		if (wasGeekOpen) _toggleGeekPanel(false); // stop interval
		if (_stallTimer) {
			clearInterval(_stallTimer);
			_stallTimer = null;
		}
		AppCtx.util._show("view-player");
		var videoEl = document.getElementById("player-video");
		var overlay = document.getElementById("player-overlay");
		var progressEl = document.getElementById("player-progress");
		var timeEl = document.getElementById("player-time");
		var titleEl = document.getElementById("player-title");
		overlay.classList.add("visible");
		titleEl.textContent = "Loading...";
		// Click on video area toggles overlay (works with Magic Remote click too)
		// Click on progress bar to seek
		progressEl.parentNode.onclick = function (e) {
			var rect = this.getBoundingClientRect();
			var pct = (e.clientX - rect.left) / rect.width;
			var dur = HydravionPlayer.getDuration();
			if (dur > 0) HydravionPlayer.seekTo(pct * dur);
		};
		videoEl.onclick = () => {
			toggleOverlay();
		};
		// Show overlay on mouse move (Magic Remote pointer)
		document.getElementById("view-player").onmousemove = () => {
			if (!overlay.classList.contains("visible")) {
				overlay.classList.add("visible");
			}
			_resetOverlayTimer();
		};
		var allPopups = document.querySelectorAll(".picker-popup");
		for (var pi = 0; pi < allPopups.length; pi++)
			allPopups[pi].classList.add("hidden");

		// Store content ID and restore like state
		var playerView = document.getElementById("view-player");
		if (playerView) {
			playerView.setAttribute("data-content-id", contentId || entityId);
			playerView.setAttribute("data-entity-id", entityId);
			document.getElementById("player-like").classList.remove("active");
			document.getElementById("player-dislike").classList.remove("active");
			var myInt = AppCtx.state.VIDEOS["_myint_" + (contentId || entityId)];
			if (myInt === "like")
				document.getElementById("player-like").classList.add("active");
			else if (myInt === "dislike")
				document.getElementById("player-dislike").classList.add("active");
		}

		var videoTitle = title || entityId;
		var subTracks = null;

		// Audio-only: drive the dedicated native <audio> element directly -
		// no Shaka (it can't parse the IVS audio manifests and reports errors
		// on the shared video element). webOS natively plays HLS/AAC/MP3.
		var audioEl = document.getElementById("native-audio");
		if (isAudio && audioEl) {
			_playNativeAudio(
				streamUrl,
				contentId || entityId,
				audioEl,
				titleEl,
				progressEl,
				timeEl,
				videoTitle,
			);
			return;
		}

		// Chain: init → getInfo → loadHls → play + prefs
		HydravionPlayer.init(videoEl)
			.then(() => {
				// Audio: skip the metadata lookups (the attachment id is not a
				// content resource - they 403/404) and native HLS only (Shaka
				// can't parse the IVS audio manifests, 3018).
				if (isAudio) return null;
				return FloatplaneAPI.getVideoInfo(contentId || entityId)
					.then((info) => {
						videoTitle = info.title || entityId;
						subTracks = info.textTracks || null;
					})
					.catch(() => FloatplaneAPI.getPostInfo(contentId || entityId))
					.then((info) => {
						if (info) {
							videoTitle = info.title || entityId;
							if (info.textTracks) subTracks = info.textTracks;
						}
					})
					.catch(() => {});
			})
			.then(() => {
				titleEl.textContent = videoTitle;
				// Pass resume start time directly to Shaka Player.load(uri, startTime)
				// so it seeks before playback begins, avoiding 0→jump flicker
				var resume = AppCtx.util._loadResume(contentId || entityId);
				var startTime =
					resume && resume.pos > 5 ? Math.max(0, resume.pos - 3) : undefined;
				// If we know the resume position, show it on the bar immediately -
				// Shaka's async seek means getCurrentTime() still reads 0 right now.
				if (startTime !== undefined && resume && resume.dur > 0) {
					_refreshProgressBar(startTime, resume.dur);
				}
				return isAudio
					? HydravionPlayer.loadHlsNative(streamUrl, startTime)
					: HydravionPlayer.loadHls(streamUrl, startTime);
			})
			.then(() => {
				if (!isAudio && subTracks) HydravionPlayer.addSubtitles(subTracks);
				HydravionPlayer.play();
				// NOTE: no _refreshProgressBar() here - Shaka's resume seek is
				// still landing, getCurrentTime() reads 0, and it would clobber
				// the resume position we already painted pre-load (see above).
				// The 5s interval corrects it once the seek completes.

				// Apply preferences
				try {
					var prefSubs = localStorage.getItem("pref_subs");
					if (prefSubs === "off") {
						var tks = videoEl.textTracks;
						for (var tk = 0; tk < tks.length; tk++) tks[tk].mode = "disabled";
					}
					var player = HydravionPlayer.getPlayer();
					var prefQual = localStorage.getItem("pref_quality");
					if (player) {
						if (prefQual && prefQual !== "auto") {
							var targetH = parseInt(prefQual, 10);
							if (targetH) {
								// Shaka v5: try video tracks first (new API), fall back to variant tracks.
								// Determine track type to call the correct select method.
								var videoTracks = [];
								try {
									videoTracks = player.getVideoTracks() || [];
								} catch (e) {}
								var variantTracks = [];
								if (!videoTracks.length)
									try {
										variantTracks = player.getVariantTracks() || [];
									} catch (e) {}

								var list = videoTracks.length ? videoTracks : variantTracks;
								var isVideo = !!videoTracks.length;
								var exactMatch = null;
								var bestMatch = null;
								for (var tr = 0; tr < list.length; tr++) {
									var h = list[tr].height || 0;
									if (h === targetH) {
										exactMatch = list[tr];
										break;
									}
									if (
										h <= targetH &&
										(!bestMatch || h > (bestMatch.height || 0))
									)
										bestMatch = list[tr];
								}
								var selected = exactMatch || bestMatch;
								if (selected) {
									try {
										if (isVideo) {
											player.selectVideoTrack(selected);
										} else {
											player.selectVariantTrack(selected, true);
										}
										player.configure({ abr: { enabled: false } });
									} catch (e) {
										// Selection failed - re-enable ABR so stream isn't left dead
										player.configure({ abr: { enabled: true } });
									}
								}
							}
						} else {
							if (player) player.configure({ abr: { enabled: true } });
						}
					}
				} catch (e) {}

				_setupPlayerControls(videoEl);
				_applySubtitleStyle();
				if (wasGeekOpen) _toggleGeekPanel(true, videoEl);
			})
			.catch((err) => {
				// Audio already uses native HLS - nothing left to fall back to
				if (isAudio) {
					AppCtx.util._toast("Playback error");
					return;
				}
				// P4: Shaka failed (MSE unsupported / manifest error) - fall
				// back to native HLS playback. webOS has built-in HLS.
				console.warn(
					"[PLAY] Shaka failed: " +
						(err && (err.code || err.message)) +
						" - trying native HLS for " +
						(streamUrl || "").substring(0, 80),
				);
				if (HydravionPlayer.isNativeHlsSupported()) {
					HydravionPlayer.loadHlsNative(streamUrl, undefined)
						.then(() => {
							// Native HLS fails via a video error event, not a
							// promise - surface it so failures aren't silent.
							videoEl.addEventListener(
								"error",
								function nativeErr() {
									var m = videoEl.error;
									console.warn(
										"[PLAY] native HLS error code=" +
											(m && m.code) +
											" msg=" +
											(m && m.message),
									);
									videoEl.removeEventListener("error", nativeErr);
								},
								{ once: true },
							);
							titleEl.textContent = videoTitle;
							_setupPlayerControls(videoEl);
							_applySubtitleStyle();
						})
						.catch(() => {
							AppCtx.util._toast("Playback error");
						});
				} else {
					AppCtx.util._toast("Playback error");
				}
			});
		// Progress tracking + resume position saving
		if (_progressTimer) clearInterval(_progressTimer);
		var _lastServerSync = 0;
		var _syncProgress = () => {
			var ct = HydravionPlayer.getCurrentTime();
			var dur = HydravionPlayer.getDuration();
			if (dur <= 0) return;
			// Report to Floatplane so the server watch history updates
			// (this is what makes the video show up in History).
			FloatplaneAPI.updateProgress(
				contentId || entityId,
				"blogPost",
				Math.round((ct / dur) * 100),
			).catch(() => {});
		};
		_progressTimer = setInterval(() => {
			var ct = HydravionPlayer.getCurrentTime();
			var dur = HydravionPlayer.getDuration();
			if (dur > 0) {
				progressEl.style.width = (ct / dur) * 100 + "%";
				timeEl.textContent =
					AppCtx.util._fmtDuration(ct) + " / " + AppCtx.util._fmtDuration(dur);
				AppCtx.util._saveResume(contentId || entityId, streamUrl, ct, dur);
				// Server sync every ~30s (and skipped if paused)
				if (!videoEl.paused && Date.now() - _lastServerSync > 30000) {
					_lastServerSync = Date.now();
					_syncProgress();
				}
			}
		}, 5000);
		// Save final resume position + server progress immediately before stop
		window._saveResumeOnStop = () => {
			var ct = HydravionPlayer.getCurrentTime();
			var dur = HydravionPlayer.getDuration();
			if (dur > 0) {
				AppCtx.util._saveResume(contentId || entityId, streamUrl, ct, dur);
				_syncProgress();
			}
		};
		// Stall detector: if time doesn't advance for 10s while playing, step down quality
		var _lastCt = -1;
		var _stallCount = 0;
		_stallTimer = setInterval(() => {
			var ct = HydravionPlayer.getCurrentTime();
			var dur = HydravionPlayer.getDuration();
			var paused = videoEl.paused;
			if (!paused && ct === _lastCt && dur > 0) {
				_stallCount++;
				if (_stallCount >= 2) {
					// 10s stalled
					_stallCount = 0;
					// Find current quality index and step down
					var curUrl = HydravionPlayer.getLastUrl();
					if (!curUrl || !AppCtx.state._CACHED_VARIANTS.length) return;
					var idx = -1;
					for (var si = 0; si < AppCtx.state._CACHED_VARIANTS.length; si++) {
						if (AppCtx.state._CACHED_VARIANTS[si].url === curUrl) {
							idx = si;
							break;
						}
					}
					if (idx < AppCtx.state._CACHED_VARIANTS.length - 1) {
						var lower = AppCtx.state._CACHED_VARIANTS[idx + 1]; // next lower (sorted descending)
						if (lower && lower.url && lower.url !== curUrl) {
							console.log(
								"[PLAY] Auto-fallback: " +
									(AppCtx.state._CACHED_VARIANTS[idx].height || "?") +
									"p -> " +
									(lower.height || "?") +
									"p",
							);
							startPlayback(entityId, lower.url, contentId);
						}
					}
				}
			} else {
				_stallCount = 0;
			}
			_lastCt = ct;
		}, 5000);

		HydravionPlayer.onEnd(() => {
			AppCtx.util._clearResume(contentId || entityId);
			var autoplay = true;
			try {
				autoplay = localStorage.getItem("pref_autoplay") !== "off";
			} catch (e) {}
			function _playNext() {
				AppCtx.state._playIndex++;
				if (AppCtx.state._playIndex >= AppCtx.state._playQueue.length) {
					AppCtx.util._toast("No more videos");
					AppCtx.views.app.goBack();
					return;
				}
				var nxt = AppCtx.state._playQueue[AppCtx.state._playIndex];
				var aid = nxt.attachmentOrder && nxt.attachmentOrder[0];
				if (!aid) {
					AppCtx.util._toast("Can't play this video type");
					AppCtx.views.app.goBack();
					return;
				}
				AppCtx.util._toast("▶ " + (nxt.title || "").substring(0, 40));
				AppCtx.state._playIndex--; // _playQueueIndex will increment it
				_playQueueIndex(AppCtx.state._playIndex + 1);
			}
			if (
				autoplay &&
				AppCtx.state._playQueue.length > 0 &&
				AppCtx.state._playIndex >= 0 &&
				AppCtx.state._playIndex < AppCtx.state._playQueue.length - 1
			) {
				AppCtx.state._autoPlayCount++;
				if (AppCtx.state._autoPlayCount >= 5) {
					var still = document.getElementById("still-watching");
					if (still) {
						still.classList.remove("hidden");
						// Focus the first button so the remote can answer; the
						// player-nav branch in handleKey routes arrows/Enter to
						// the modal while it's visible.
						var swYes = still.querySelector(".sw-yes");
						if (swYes) swYes.focus();
						// 20s to answer, then stop playback (plan note)
						AppCtx.state._stillWatchingTimer = setTimeout(() => {
							if (still) still.classList.add("hidden");
							AppCtx.views.app.goBack();
						}, 20000);
						still.querySelector(".sw-yes").onclick = () => {
							clearTimeout(AppCtx.state._stillWatchingTimer);
							still.classList.add("hidden");
							AppCtx.state._autoPlayCount = 0;
							_playNext();
						};
						still.querySelector(".sw-no").onclick = () => {
							clearTimeout(AppCtx.state._stillWatchingTimer);
							still.classList.add("hidden");
							AppCtx.views.app.goBack();
						};
						return;
					}
				}
				_playNext();
			} else {
				AppCtx.views.app.goBack();
			}
		});
		setTimeout(() => {
			overlay.classList.remove("visible");
		}, 4000);
	}
	/** Stop playback and go back. Clean up timers. */
	function stopPlayback() {
		console.log("[PLAY] stopPlayback");
		_stopPlayerResources();
		AppCtx.views.app.goBack();
	}

	/** Stop timers, geek panel, and the video element (keeps resume save). */
	function _stopPlayerResources() {
		var eqOverlay = document.getElementById("player-eq");
		if (eqOverlay) eqOverlay.classList.add("hidden");
		if (typeof window._saveResumeOnStop === "function")
			window._saveResumeOnStop();
		if (_progressTimer) {
			clearInterval(_progressTimer);
			_progressTimer = null;
		}
		if (_stallTimer) {
			clearInterval(_stallTimer);
			_stallTimer = null;
		}
		_toggleGeekPanel(false);
		// Stop the dedicated native audio element (audio-only posts)
		var audioEl = document.getElementById("native-audio");
		if (audioEl) {
			audioEl.pause();
			audioEl.removeAttribute("src");
			audioEl.load();
			audioEl.ontimeupdate = null;
			audioEl.onerror = null;
			audioEl.onended = null;
		}
		HydravionPlayer.stop();
	}
	// PLAYER CONTROLS  (CC, HD picker, Geek panel, Like/Dislike)
	// =========================================================================

	/** @private {?number} Geek panel refresh interval ID */
	var _geekInterval = null;

	/** @private {?number} Auto-hide overlay timer */
	var _overlayTimer = null;

	/** @private {?number} Stall detector timer (auto-fallback quality) */
	var _stallTimer = null;

	/** @private {?number} Player progress bar timer */
	var _progressTimer = null;

	/** Toggle or force-set geek panel visibility. @param {boolean=} show @param {HTMLVideoElement=} videoEl */
	function _toggleGeekPanel(show, videoEl) {
		var picker = document.getElementById("player-geek-panel");
		var ve = videoEl || document.getElementById("player-video");
		if (show === undefined) {
			var hidden = picker.classList.contains("hidden");
			show = hidden;
		}
		if (show) {
			picker.classList.remove("hidden");
			var others = document.querySelectorAll(
				".picker-popup:not(#player-geek-panel)",
			);
			for (var i = 0; i < others.length; i++) others[i].classList.add("hidden");
			if (!_geekInterval) {
				_populateGeekInfo(ve);
				_geekInterval = setInterval(() => {
					_populateGeekInfo(ve);
				}, 2000);
			}
		} else {
			picker.classList.add("hidden");
			if (_geekInterval) {
				clearInterval(_geekInterval);
				_geekInterval = null;
			}
		}
	}

	/** Wire up player overlay buttons. @param {HTMLVideoElement} videoEl */
	function _setupPlayerControls(videoEl) {
		// CC - subtitle picker
		document.getElementById("player-cc").onclick = () => {
			var picker = document.getElementById("player-cc-picker");
			// Hide other picker popups but NOT the geek panel
			var others = document.querySelectorAll(
				".picker-popup:not(#player-geek-panel)",
			);
			for (var i = 0; i < others.length; i++) {
				if (others[i] !== picker) others[i].classList.add("hidden");
			}
			picker.classList.toggle("hidden");
			if (!picker.classList.contains("hidden")) {
				_positionPicker(picker, "player-cc");
				_populateCCList(videoEl);
			}
		};

		// HD - quality picker
		document.getElementById("player-hd").onclick = () => {
			var picker = document.getElementById("player-hd-picker");
			// Hide other picker popups but NOT the geek panel
			var others = document.querySelectorAll(
				".picker-popup:not(#player-geek-panel)",
			);
			for (var i = 0; i < others.length; i++) {
				if (others[i] !== picker) others[i].classList.add("hidden");
			}
			picker.classList.toggle("hidden");
			if (!picker.classList.contains("hidden")) {
				_positionPicker(picker, "player-hd");
				_populateHDList();
				setTimeout(() => {
					_focusFirstPick("hd-list");
				}, 50);
			}
		};

		// Geek info - live refresh while visible
		document.getElementById("player-geek").onclick = () => {
			_toggleGeekPanel();
		};

		// Like
		document.getElementById("player-like").onclick = () => {
			var pv = document.getElementById("view-player");
			if (!pv) return;
			var cid = pv.getAttribute("data-content-id");
			if (!cid) return;
			FloatplaneAPI.likeContent(cid)
				.then(() => {
					document.getElementById("player-like").classList.toggle("active");
					document.getElementById("player-dislike").classList.remove("active");
				})
				.catch(() => {});
			AppCtx.state.VIDEOS["_myint_" + cid] =
				AppCtx.state.VIDEOS["_myint_" + cid] === "like" ? "none" : "like";
		};

		// Dislike
		document.getElementById("player-dislike").onclick = () => {
			var pv = document.getElementById("view-player");
			if (!pv) return;
			var cid = pv.getAttribute("data-content-id");
			if (!cid) return;
			FloatplaneAPI.dislikeContent(cid)
				.then(() => {
					document.getElementById("player-dislike").classList.toggle("active");
					document.getElementById("player-like").classList.remove("active");
				})
				.catch(() => {});
			AppCtx.state.VIDEOS["_myint_" + cid] =
				AppCtx.state.VIDEOS["_myint_" + cid] === "dislike" ? "none" : "dislike";
		};

		// Play/Pause - click handler for Magic Remote (button and video are siblings, event doesn't bubble)
		document.getElementById("player-playpause").onclick = () => {
			HydravionPlayer.togglePlayPause();
			// Report progress to the server on pause too (feeds history)
			var _pv = document.getElementById("view-player");
			var _cId = (_pv && _pv.getAttribute("data-content-id")) || "";
			var _dP = HydravionPlayer.getDuration();
			if (videoEl && videoEl.paused && _dP > 0 && _cId) {
				FloatplaneAPI.updateProgress(
					_cId,
					"blogPost",
					Math.round((HydravionPlayer.getCurrentTime() / _dP) * 100),
				).catch(() => {});
			}
		};
		// Prev / Next buttons
		document.getElementById("player-prev").onclick = () => {
			_playQueueIndex(AppCtx.state._playIndex - 1);
		};
		document.getElementById("player-next").onclick = () => {
			_playQueueIndex(AppCtx.state._playIndex + 1);
		};

		// Mute
		document.getElementById("player-mute").onclick = function () {
			videoEl.muted = !videoEl.muted;
			this.innerHTML = videoEl.muted
				? '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
				: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
		};

		// Speed - picker popup
		document.getElementById("player-speed").onclick = () => {
			var picker = document.getElementById("player-speed-picker");
			var others = document.querySelectorAll(
				".picker-popup:not(#player-geek-panel)",
			);
			for (var si = 0; si < others.length; si++) {
				if (others[si] !== picker) others[si].classList.add("hidden");
			}
			picker.classList.toggle("hidden");
			if (!picker.classList.contains("hidden")) {
				_positionPicker(picker, "player-speed");
				_populateSpeedList(videoEl);
			}
		};
	}

	/** Align a picker popup horizontally under its trigger button.
	 *  The pickers are absolute-positioned children of #view-player, so left
	 *  is computed from the button's offset within that container. Bottom is
	 *  fixed by CSS (above the transport/action controls). */
	function _positionPicker(picker, buttonId) {
		var player = document.getElementById("view-player");
		var btn = document.getElementById(buttonId);
		if (!player || !btn) return;
		var l = btn.offsetLeft;
		var w = btn.offsetWidth;
		// Center the popup under the button (popup is ~220px wide)
		picker.style.left = Math.max(0, l + w / 2 - 110) + "px";
	}

	/** Populate speed picker. @param {HTMLVideoElement} videoEl */
	function _populateSpeedList(videoEl) {
		var list = document.getElementById("speed-list");
		list.innerHTML = "";
		var speeds = [0.5, 1, 1.5, 2];
		var current = videoEl.playbackRate || 1;
		speeds.forEach((rate) => {
			var btn = document.createElement("button");
			btn.className =
				"pick-item" + (Math.abs(rate - current) < 0.01 ? " selected" : "");
			btn.tabIndex = "0";
			btn.textContent = rate + "x";
			btn.addEventListener("click", () => {
				videoEl.playbackRate = rate;
				document.getElementById("player-speed").textContent = rate + "x";
				var items = list.querySelectorAll(".pick-item");
				for (var si = 0; si < items.length; si++)
					items[si].classList.remove("selected");
				btn.classList.add("selected");
				document.getElementById("player-speed-picker").classList.add("hidden");
				var sbtn = document.getElementById("player-speed");
				if (sbtn) sbtn.focus();
			});
			list.appendChild(btn);
		});
		var sel =
			list.querySelector(".pick-item.selected") ||
			list.querySelector(".pick-item");
		if (sel) sel.focus();
	}

	/** Populate subtitle track list. @param {HTMLVideoElement} videoEl */
	function _populateCCList(videoEl) {
		var list = document.getElementById("cc-list");
		list.innerHTML = "";
		// Off option
		var off = document.createElement("button");
		off.className = "pick-item";
		off.tabIndex = "0";
		off.textContent = "Off";
		var _allBtns = [off];
		off.addEventListener("click", () => {
			for (var ti = 0; ti < videoEl.textTracks.length; ti++)
				videoEl.textTracks[ti].mode = "disabled";
			for (var bi = 0; bi < _allBtns.length; bi++)
				_allBtns[bi].classList.remove("selected");
			off.classList.add("selected");
			document.getElementById("player-cc-picker").classList.add("hidden");
			var cbtn2 = document.getElementById("player-cc");
			if (cbtn2) cbtn2.focus();
		});
		list.appendChild(off);
		var anyActive = false;
		for (var i = 0; i < videoEl.textTracks.length; i++) {
			((track) => {
				var btn = document.createElement("button");
				btn.className = "pick-item";
				btn.tabIndex = "0";
				btn.textContent = track.label || track.language || "Track " + (i + 1);
				if (track.mode === "showing" && !anyActive) {
					btn.classList.add("selected");
					anyActive = true;
				}
				btn.addEventListener("click", () => {
					for (var tj = 0; tj < videoEl.textTracks.length; tj++)
						videoEl.textTracks[tj].mode =
							videoEl.textTracks[tj] === track ? "showing" : "disabled";
					for (var bj = 0; bj < _allBtns.length; bj++)
						_allBtns[bj].classList.remove("selected");
					btn.classList.add("selected");
					document.getElementById("player-cc-picker").classList.add("hidden");
					var cbtn3 = document.getElementById("player-cc");
					if (cbtn3) cbtn3.focus();
				});
				_allBtns.push(btn);
				list.appendChild(btn);
			})(videoEl.textTracks[i]);
		}
		if (!anyActive) off.classList.add("selected");
		var sel =
			list.querySelector(".pick-item.selected") ||
			list.querySelector(".pick-item");
		if (sel) sel.focus();
	}

	/** Populate quality/resolution picker, then focus first item. */
	function _focusFirstPick(id) {
		var list = document.getElementById(id);
		if (!list) return;
		var target =
			list.querySelector(".pick-item.selected") ||
			list.querySelector(".pick-item");
		if (target) target.focus();
	}

	/** Populate quality/resolution picker. */
	function _normalizePath(url) {
		if (!url) return "";
		try {
			return new URL(url, window.location.href).pathname;
		} catch (e) {
			return url.split("?")[0].split("#")[0];
		}
	}

	function _populateHDList() {
		var list = document.getElementById("hd-list");
		list.innerHTML = "";
		var player = HydravionPlayer.getPlayer();
		if (!player) {
			list.innerHTML =
				'<div style="padding:16px;color:#666">Not available</div>';
			return;
		}

		// Use cached variants from delivery info (reliable, has all qualities).
		// Fallback to Shaka video tracks (which may only show the active track after selection).
		var qualities = AppCtx.state._CACHED_VARIANTS.length
			? AppCtx.state._CACHED_VARIANTS
			: [];
		if (!qualities.length) {
			try {
				var vt = player.getVideoTracks() || [];
				for (var i = 0; i < vt.length; i++) {
					if (vt[i].height)
						qualities.push({
							label: vt[i].label,
							height: vt[i].height,
							url: "",
						});
				}
			} catch (e) {}
		}
		if (!qualities.length) {
			list.innerHTML = '<div style="padding:16px;color:#666">Auto (ABR)</div>';
			return;
		}

		// Normalize active URL for comparison (strip query params, resolve relative)
		var curPath = _normalizePath(HydravionPlayer.getLastUrl());

		// Match active quality by normalized path
		var activeHeight = -1;
		if (curPath) {
			for (var qi = 0; qi < qualities.length; qi++) {
				if (
					qualities[qi].url &&
					_normalizePath(qualities[qi].url) === curPath
				) {
					activeHeight = qualities[qi].height || 0;
					break;
				}
			}
		}

		// Auto button - mark selected if ABR is on or no specific quality matched
		var abrOn =
			player.getConfiguration &&
			player.getConfiguration().abr &&
			player.getConfiguration().abr.enabled;
		var isAuto = abrOn || activeHeight < 0;
		var auto = document.createElement("button");
		auto.className = "pick-item" + (isAuto ? " selected" : "");
		auto.tabIndex = "0";
		auto.textContent = "Auto";
		auto.addEventListener("click", () => {
			player.configure({ abr: { enabled: true } });
			highlightItem(list, auto);
		});
		list.appendChild(auto);

		// Build quality buttons, deduped by height
		var seen = {};
		for (var i = 0; i < qualities.length; i++) {
			var h = qualities[i].height || 0;
			if (seen[h]) continue;
			seen[h] = true;
			((q) => {
				var btn = document.createElement("button");
				btn.className = "pick-item";
				btn.tabIndex = "0";
				btn.textContent = q.label || (q.height ? q.height + "p" : "?");
				if (!isAuto && activeHeight > 0 && (q.height || 0) === activeHeight)
					btn.classList.add("selected");
				btn.addEventListener("click", () => {
					if (q.url) {
						var pv = document.getElementById("view-player");
						var entId = pv ? pv.getAttribute("data-entity-id") : "";
						var contId = pv ? pv.getAttribute("data-content-id") : "";
						if (entId && _normalizePath(q.url) !== curPath) {
							HydravionPlayer.stop();
							startPlayback(entId, q.url, contId);
							return;
						}
					}
					if (player) {
						try {
							var vids = player.getVideoTracks() || [];
							var isVid = true;
							if (!vids.length) {
								vids = player.getVariantTracks() || [];
								isVid = false;
							}
							for (var j = 0; j < vids.length; j++) {
								if (Math.abs((vids[j].height || 0) - q.height) < 10) {
									if (isVid) {
										player.selectVideoTrack(vids[j]);
									} else {
										player.selectVariantTrack(vids[j], true);
									}
									player.configure({ abr: { enabled: false } });
									break;
								}
							}
						} catch (e) {}
					}
					highlightItem(list, btn);
				});
				list.appendChild(btn);
			})(qualities[i]);
		}

		var sel =
			list.querySelector(".pick-item.selected") ||
			list.querySelector(".pick-item");
		if (sel) sel.focus();
	}

	/** @param {HTMLElement} list @param {HTMLElement} item */
	function highlightItem(list, item) {
		var items = list.querySelectorAll(".pick-item");
		for (var i = 0; i < items.length; i++)
			items[i].classList.remove("selected");
		item.classList.add("selected");
	}

	/** Populate geek/stats panel - updates in-place on refresh. @param {HTMLVideoElement} videoEl */
	function _populateGeekInfo(videoEl) {
		var list = document.getElementById("geek-list");
		var player = HydravionPlayer.getPlayer();
		var stats = player ? player.getStats() : {};

		// Parse currentCodecs (v5 format: "avc1.xxx, mp4a.xxx")
		var codecs = (stats.currentCodecs || "").split(",").map((c) => c.trim());
		var vCodec = "?",
			aCodec = "?";
		for (var ci = 0; ci < codecs.length; ci++) {
			var c = codecs[ci].toLowerCase();
			if (
				c.indexOf("avc") >= 0 ||
				c.indexOf("hev") >= 0 ||
				c.indexOf("hvc") >= 0 ||
				c.indexOf("vp0") >= 0 ||
				c.indexOf("av0") >= 0 ||
				c.indexOf("vp9") >= 0
			)
				vCodec = codecs[ci];
			else if (
				c.indexOf("mp4a") >= 0 ||
				c.indexOf("ac-") >= 0 ||
				c.indexOf("ec-") >= 0 ||
				c.indexOf("opus") >= 0 ||
				c.indexOf("flac") >= 0
			)
				aCodec = codecs[ci];
		}

		var info = [
			["Resolution", (stats.width || "?") + " x " + (stats.height || "?")],
			[
				"Bandwidth",
				stats.estimatedBandwidth
					? Math.round(stats.estimatedBandwidth / 1000) + " kbps"
					: "?",
			],
			["Video Codec", vCodec],
			["Audio Codec", aCodec],
			[
				"Framerate",
				Math.round(stats.decodedFrames / (stats.totalTime || 1)) + " fps",
			],
			["Dropped Frames", String(stats.droppedFrames || 0)],
			["Stalls", String(stats.stallsDetected || 0)],
			[
				"TTFF",
				stats.timeToFirstFrame
					? Math.round(stats.timeToFirstFrame * 10) / 10 + "s"
					: "?",
			],
			[
				"Load Latency",
				stats.loadLatency ? Math.round(stats.loadLatency * 10) / 10 + "s" : "?",
			],
			[
				"Buffered",
				videoEl.buffered && videoEl.buffered.length
					? Math.round(
							videoEl.buffered.end(videoEl.buffered.length - 1) -
								HydravionPlayer.getCurrentTime(),
						) + "s"
					: "?",
			],
			[
				"Downloaded",
				stats.bytesDownloaded
					? (stats.bytesDownloaded / 1048576).toFixed(1) + " MB"
					: "?",
			],
			["Player", "Shaka " + (shaka.Player.version || "?")],
		];

		// First call: create rows. Subsequent: update existing rows in-place.
		if (!list.children.length) {
			for (var i = 0; i < info.length; i++) {
				var row = document.createElement("div");
				row.className = "geek-row";
				row.innerHTML =
					'<span class="gl">' +
					info[i][0] +
					'</span><span class="gv">' +
					info[i][1] +
					"</span>";
				list.appendChild(row);
			}
		} else {
			var rows = list.querySelectorAll(".geek-row .gv");
			for (var i = 0; i < info.length && i < rows.length; i++) {
				rows[i].textContent = info[i][1];
			}
		}
	}
	function _seekWithOverlay(delta) {
		HydravionPlayer.seek(delta);
		var overlay = document.getElementById("player-overlay");
		if (overlay && !overlay.classList.contains("visible")) {
			overlay.classList.add("visible");
			_resetOverlayTimer();
		}
		// Refresh progress bar immediately (the 5s interval would lag behind)
		_refreshProgressBar();
	}

	/** Set progress bar width + time text from current playback position.
	 * @param {number} [ct] Override current time (e.g. resume pos, pre-seek)
	 * @param {number} [dur] Override duration (e.g. saved resume duration)
	 */
	function _refreshProgressBar(ct, dur) {
		var progressEl = document.getElementById("player-progress");
		var timeEl = document.getElementById("player-time");
		if (ct === undefined) ct = HydravionPlayer.getCurrentTime();
		if (dur === undefined) dur = HydravionPlayer.getDuration();
		if (dur > 0 && progressEl && timeEl) {
			progressEl.style.width = (ct / dur) * 100 + "%";
			timeEl.textContent =
				AppCtx.util._fmtDuration(ct) + " / " + AppCtx.util._fmtDuration(dur);
		}
	}

	// Focusable player overlay buttons (arrow nav + focus-drop on hide).
	// Hoisted to module scope - previously declared inside handleKey, which
	// made them undefined in toggleOverlay/_resetOverlayTimer (ReferenceError).
	var _PLAYER_BTNS = [
		"player-prev",
		"player-playpause",
		"player-next",
		"player-like",
		"player-dislike",
		"player-cc",
		"player-speed",
		"player-mute",
		"player-hd",
		"player-geek",
	];

	/** Toggle player overlay and play/pause. */
	function toggleOverlay() {
		var overlay = document.getElementById("player-overlay");
		var wasVisible = overlay.classList.contains("visible");
		overlay.classList.toggle("visible");
		if (wasVisible) {
			// Hiding → close picker popups (but not geek panel) and drop focus
			// so a hidden pick item can't keep the highlight.
			var popups = document.querySelectorAll(
				".picker-popup:not(#player-geek-panel)",
			);
			for (var pi = 0; pi < popups.length; pi++)
				popups[pi].classList.add("hidden");
			var ae = document.activeElement;
			if (
				ae &&
				(ae.classList.contains("pick-item") ||
					_PLAYER_BTNS.indexOf(ae.id) !== -1)
			) {
				ae.blur();
			}
			// Clear auto-hide timer
			if (_overlayTimer) {
				clearTimeout(_overlayTimer);
				_overlayTimer = null;
			}
		} else {
			// Showing → focus play button and start auto-hide
			var pp = document.getElementById("player-playpause");
			if (pp) pp.focus();
			_resetOverlayTimer();
		}
		// NOTE: overlay toggle NEVER touches playback - middle press only shows
		// the controls. Play/pause happens via the play/pause button itself.
	}

	/**
	 * Reset the player overlay auto-hide timer (4s). Called on show and on
	 * every key while the overlay is visible, so moving through options or
	 * selecting one never gets cut off. Keeps waiting while a picker popup
	 * is open.
	 */
	function _resetOverlayTimer() {
		if (_overlayTimer) clearTimeout(_overlayTimer);
		_overlayTimer = setTimeout(() => {
			var o = document.getElementById("player-overlay");
			if (o && o.classList.contains("visible")) {
				o.classList.remove("visible");
				// Bar went away → close picker popups (but not geek panel) and
				// drop focus so a hidden pick item can't keep the highlight.
				var popups = document.querySelectorAll(
					".picker-popup:not(#player-geek-panel):not(.hidden)",
				);
				for (var pi = 0; pi < popups.length; pi++)
					popups[pi].classList.add("hidden");
				var ae = document.activeElement;
				if (
					ae &&
					(ae.classList.contains("pick-item") ||
						_PLAYER_BTNS.indexOf(ae.id) !== -1)
				) {
					ae.blur();
				}
			}
			_overlayTimer = null;
		}, 4000);
	}

	AppCtx.views.player = {
		_applySubtitleStyle: _applySubtitleStyle,
		_playQueueIndex: _playQueueIndex,
		startPlayback: startPlayback,
		stopPlayback: stopPlayback,
		_stopPlayerResources: _stopPlayerResources,
		_toggleGeekPanel: _toggleGeekPanel,
		_setupPlayerControls: _setupPlayerControls,
		_populateSpeedList: _populateSpeedList,
		_populateCCList: _populateCCList,
		_focusFirstPick: _focusFirstPick,
		_populateHDList: _populateHDList,
		_populateGeekInfo: _populateGeekInfo,
		_seekWithOverlay: _seekWithOverlay,
		_refreshProgressBar: _refreshProgressBar,
		_PLAYER_BTNS: _PLAYER_BTNS,
		toggleOverlay: toggleOverlay,
		_resetOverlayTimer: _resetOverlayTimer,
		_normalizePath: _normalizePath,
		highlightItem: highlightItem,
	};
})();
