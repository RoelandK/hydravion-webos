/**
 * @fileoverview HLS video player wrapper using Shaka Player.
 * Falls back to native <video> on error (future).
 */
var HydravionPlayer = (() => {
	/** @private {?shaka.Player} */
	var _player = null;

	/** @private {?HTMLVideoElement} */
	var _videoEl = null;

	/** @private {?Function} Called when video ends */
	var _onEnd = null;

	/** @private {string} Last loaded stream URL */
	var _lastUrl = "";

	/** @private {boolean} Polyfill installed once */
	var _polyfilled = false;

	/**
	 * Initialize or reuse Shaka Player. Attach to video element.
	 * @param {HTMLVideoElement} videoEl
	 * @returns {Promise} Resolves when attached
	 */
	function init(videoEl) {
		_removeAllTracks(videoEl);
		_onEnd = null;
		_stopped = false; // allow stop() to unload again this cycle
		_videoEl = videoEl;

		if (!_polyfilled) {
			shaka.polyfill.installAll();
			_polyfilled = true;
		}
		if (!shaka.Player.isBrowserSupported())
			return Promise.reject("Shaka not supported");

		if (_player) {
			// Re-attach ended listener for new video element
			_rebindEnded();
			return _player.attach(videoEl, true);
		}

		_player = new shaka.Player();
		_player.configure({
			streaming: {
				bufferingGoal: 30,
				rebufferingGoal: 4,
				bufferBehind: 20,
			},
		});
		_player.addEventListener("error", (event) => {
			var d = event.detail;
			console.error(
				"[PLAYER] Shaka error code=" +
					(d && d.code) +
					" cat=" +
					(d && d.category) +
					" data=" +
					JSON.stringify(d && d.data).substring(0, 300),
			);
		});
		_player.getNetworkingEngine().registerRequestFilter((type, request) => {
			var token = FloatplaneAPI.getAccessToken();
			if (token) request.headers["Authorization"] = "Bearer " + token;
			// User-Agent header dropped - forbidden in browser, silently ignored
		});
		// Remove old ended listener before adding to avoid accumulation
		_rebindEnded();
		return _player.attach(videoEl, true);
	}

	function _removeAllTracks(el) {
		var existing = el.querySelectorAll("track");
		for (var ei = 0; ei < existing.length; ei++) {
			existing[ei].parentNode.removeChild(existing[ei]);
		}
	}

	/**
	 * Load an HLS stream URL.
	 * @param {string} url
	 * @returns {Promise}
	 */
	function loadHls(url, startTime) {
		if (!_player) return Promise.reject("Player not initialized");
		_lastUrl = url;
		return _player.load(url, startTime);
	}

	/** @returns {boolean} True when native HLS is supported (webOS does) */
	function isNativeHlsSupported() {
		return !!(
			_videoEl &&
			_videoEl.canPlayType &&
			_videoEl.canPlayType("application/vnd.apple.mpegurl")
		);
	}

	/**
	 * Native HLS fallback (P4): plain <video src>, no Shaka. Used when Shaka
	 * fails (MSE unsupported / manifest error). webOS has built-in HLS.
	 * @param {string} url
	 * @param {number} [startTime]
	 * @returns {Promise} Resolves when play() was called
	 */
	function loadHlsNative(url, startTime) {
		_lastUrl = url;
		_stopped = false;
		if (!_videoEl) return Promise.reject("No video element");
		_removeAllTracks(_videoEl);
		_videoEl.src = url;
		if (startTime !== undefined && startTime > 0)
			_videoEl.currentTime = startTime;
		var p = _videoEl.play();
		if (p && p.catch) p.catch(() => {});
		return Promise.resolve();
	}

	/**
	 * Attach subtitle tracks as native <track> elements.
	 * @param {Array<{src:string, language?:string, kind?:string}>} tracks
	 */
	function addSubtitles(tracks) {
		if (!_videoEl || !tracks) return;
		_removeAllTracks(_videoEl);
		var _langNames = {
			en: "English",
			fr: "French",
			de: "German",
			es: "Spanish",
			it: "Italian",
			ja: "Japanese",
			ko: "Korean",
			pt: "Portuguese",
			ru: "Russian",
			zh: "Chinese",
		};
		for (var ti = 0; ti < tracks.length; ti++) {
			if (!tracks[ti].src) continue;
			var t = document.createElement("track");
			t.kind = tracks[ti].kind || "subtitles";
			var lang = tracks[ti].language || "";
			t.label = _langNames[lang] || (lang ? lang.toUpperCase() : "Unknown");
			if (lang) t.srclang = lang;
			t.src = tracks[ti].src;
			if (lang === "en") t.default = true;
			_videoEl.appendChild(t);
		}
	}

	// --- Playback Control ---

	/** Update the play/pause button icon to match video state. */
	function _updatePlayBtn() {
		var btn = document.getElementById("player-playpause");
		if (!btn || !_videoEl) return;
		btn.innerHTML = _videoEl.paused
			? '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
			: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
		// Center play icon + dim layer while paused
		var center = document.getElementById("player-pause-center");
		var dim = document.getElementById("player-pause-dim");
		if (_videoEl.paused) {
			if (center) center.classList.remove("hidden");
			if (dim) dim.classList.remove("hidden");
		} else {
			if (center) center.classList.add("hidden");
			if (dim) dim.classList.add("hidden");
		}
	}

	// Center play icon: click/Enter resumes playback
	(function _wirePauseCenter() {
		var center = document.getElementById("player-pause-center");
		if (!center) return;
		var resume = () => {
			play();
		};
		center.addEventListener("click", resume);
		center.addEventListener("keydown", (e) => {
			if (e.keyCode === 13) {
				e.preventDefault();
				e.stopPropagation();
				resume();
			}
		});
	})();

	/** @returns {boolean} */
	function isPaused() {
		return _videoEl ? _videoEl.paused : true;
	}

	function _rebindEnded() {
		if (_videoEl._endedHandler)
			_videoEl.removeEventListener("ended", _videoEl._endedHandler);
		_videoEl._endedHandler = () => {
			if (_onEnd) _onEnd();
		};
		_videoEl.addEventListener("ended", _videoEl._endedHandler);
		// Also keep play/pause in sync with media events
		if (_videoEl._playPauseHandler)
			_videoEl.removeEventListener("playing", _videoEl._playPauseHandler);
		if (_videoEl._pauseHandler)
			_videoEl.removeEventListener("pause", _videoEl._pauseHandler);
		_videoEl._playPauseHandler = () => _updatePlayBtn();
		_videoEl._pauseHandler = () => _updatePlayBtn();
		_videoEl.addEventListener("playing", _videoEl._playPauseHandler);
		_videoEl.addEventListener("pause", _videoEl._pauseHandler);
	}

	function play() {
		if (_videoEl) {
			var p = _videoEl.play();
			if (p && p.catch) p.catch(() => {});
		}
		_updatePlayBtn();
	}
	function pause() {
		if (_videoEl) _videoEl.pause();
		_updatePlayBtn();
	}

	function togglePlayPause() {
		if (!_videoEl) return;
		if (_videoEl.paused) {
			var p = _videoEl.play();
			if (p && p.catch) p.catch(() => {});
		} else {
			_videoEl.pause();
		}
		_updatePlayBtn();
	}

	/**
	 * Seek relative to current position.
	 * @param {number} seconds Positive = forward, negative = backward
	 */
	function seek(seconds) {
		if (_videoEl) _videoEl.currentTime += seconds;
	}

	/** @param {number} seconds Absolute seek position */
	function seekTo(seconds) {
		if (_videoEl) _videoEl.currentTime = seconds;
	}

	/** @returns {number} Current playback time */
	function getCurrentTime() {
		return _videoEl ? _videoEl.currentTime : 0;
	}

	/** @returns {number} Total duration */
	function getDuration() {
		return _videoEl ? _videoEl.duration : 0;
	}

	/** Stop playback and unload (idempotent - safe to call twice). */
	var _stopped = false;
	function stop() {
		if (_stopped) return;
		_stopped = true;
		_onEnd = null;
		if (_player) _player.unload(); // async, but we don't need to await
		if (_videoEl) {
			_removeAllTracks(_videoEl);
			_videoEl.removeAttribute("src");
			_videoEl.load();
		}
	}

	/** Full teardown - call when exiting the app. */
	function destroy() {
		_stopped = false; // allow stop to run cleanly
		stop();
		if (_player) {
			_player.destroy();
			_player = null;
		}
	}

	/** @param {Function} fn Called when video ends */
	function onEnd(fn) {
		_onEnd = fn;
	}

	/** @returns {string} */
	function getLastUrl() {
		return _lastUrl;
	}

	/** @returns {?shaka.Player} The underlying Shaka instance */
	function getPlayer() {
		return _player;
	}

	return {
		init: init,
		loadHls: loadHls,
		loadHlsNative: loadHlsNative,
		isNativeHlsSupported: isNativeHlsSupported,
		addSubtitles: addSubtitles,
		play: play,
		pause: pause,
		togglePlayPause: togglePlayPause,
		seek: seek,
		seekTo: seekTo,
		getCurrentTime: getCurrentTime,
		getDuration: getDuration,
		isPaused: isPaused,
		stop: stop,
		destroy: destroy,
		onEnd: onEnd,
		getLastUrl: getLastUrl,
		getPlayer: getPlayer,
	};
})();
