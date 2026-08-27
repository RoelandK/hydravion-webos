/**
 * @fileoverview Live stream player view with integrated chat.
 * Two layout modes: A = video top/chat bottom, B = video left/chat right.
 */
var LiveView = (() => {
	/** @private {?LiveChat} */
	var _chat = null;

	/** @private {?string} Current live stream ID */
	var _liveStreamId = null;

	/** @private {string} Layout mode: "overlay" (chat floats over the video) or "side" */
	var _layout = "overlay";

	/** @private {number} Max chat messages to keep */
	var _MAX_MSGS = 200;

	/** @private {?number} Auto-reconnect timer ID */
	var _reconnectTimer = null;

	/** @private {?Object} The liveStream object being viewed */
	var _liveStreamObj = null;

	/** @private {?string} Creator GUID for the current live view */
	var _liveCreatorId = null;

	/** @private {?number} Offline watchdog interval ID */
	var _offlineTimer = null;

	/** Inline toast (no dependency on app.js internals). */
	var _liveToastTimer = null;
	function _toast(msg) {
		var t = document.getElementById("toast");
		if (!t) return;
		clearTimeout(_liveToastTimer);
		t.textContent = msg;
		t.classList.add("show");
		_liveToastTimer = setTimeout(() => {
			t.classList.remove("show");
		}, 3500);
	}

	/**
	 * Enter the live player view.
	 * @param {Object} liveStream The liveStream object from creator info
	 * @param {string} creatorId Creator GUID
	 * @param {string} creatorName Display name (for title)
	 * @param {boolean} isLive Whether the stream is currently active
	 */
	function enter(liveStream, creatorId, creatorName, isLive) {
		_liveStreamId = liveStream.id;
		_liveStreamObj = liveStream;
		_liveCreatorId = creatorId || "";
		_layout = "overlay";
		AppCtx.state.CURRENT_VIEW = "live";

		// Hide other views
		var views = ["browse", "creator", "details", "player"];
		for (var i = 0; i < views.length; i++) {
			var el = document.getElementById("view-" + views[i]);
			if (el) el.classList.add("hidden");
		}
		var liveView = document.getElementById("view-live");
		if (!liveView) return;
		liveView.classList.remove("hidden");
		liveView.classList.add("layout-overlay");
		liveView.classList.remove("layout-right");
		var layoutBtn = document.getElementById("live-layout-btn");
		if (layoutBtn) layoutBtn.textContent = "⊞ Side";
		// Live is a full-screen view - hide the left rail
		if (AppCtx.sidebar) AppCtx.sidebar.showForView("live");

		// Set title
		var titleEl = document.getElementById("live-title");
		if (titleEl)
			titleEl.textContent = liveStream.title || creatorName + " Live";

		// Hide/show offline card + LIVE badge
		var offlineCard = document.getElementById("live-offline");
		var badge = document.getElementById("live-badge");
		if (offlineCard) offlineCard.classList.toggle("hidden", isLive);
		if (badge) badge.style.display = isLive ? "" : "none";

		if (isLive) {
			// Set placeholder thumbnail while loading
			var video = document.getElementById("live-video");
			if (video) {
				var thumb = liveStream.thumbnail && liveStream.thumbnail.path;
				if (thumb) video.poster = thumb;
			}
			// Start loading stream
			_loadLiveStream(liveStream.id);
			// Start chat
			_startChat(liveStream.id);
			// Watch for the stream going offline
			_startOfflineWatchdog();
		} else {
			// Show offline card with data from the liveStream object
			_fillOfflineCard(liveStream);
		}
	}

	/**
	 * Watch for the stream going offline: verify the HLS URL still serves,
	 * periodically and on video end/error. IVS returns 404 when a stream ends.
	 */
	function _startOfflineWatchdog() {
		clearInterval(_offlineTimer);
		var video = document.getElementById("live-video");
		if (video) {
			video.addEventListener("ended", _checkStillLive);
			video.addEventListener("error", _checkStillLive);
		}
		_offlineTimer = setInterval(_checkStillLive, 45000);
	}

	/** Verify the stream still serves; flip to offline if not. */
	function _checkStillLive() {
		if (!_liveStreamId) return;
		FloatplaneAPI.getLiveDeliveryInfo(_liveStreamId)
			.then((url) => {
				if (typeof url !== "string" || url.indexOf("m3u8") === -1) {
					_goOffline();
					return;
				}
				var xhr = new XMLHttpRequest();
				xhr.open("GET", url, true);
				xhr.timeout = 8000;
				xhr.onload = () => {
					if (xhr.status !== 200) _goOffline();
				};
				xhr.onerror = () => _goOffline();
				xhr.ontimeout = () => {};
				xhr.send();
			})
			.catch(() => {
				_goOffline();
			});
	}

	/** Stream ended - stop playback, show the offline card, clean up chat. */
	function _goOffline() {
		if (!_liveStreamId) return;
		console.log("[LIVE] stream went offline");
		clearInterval(_offlineTimer);
		_offlineTimer = null;
		var video = document.getElementById("live-video");
		if (video) {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
		HydravionPlayer.stop();
		var offlineCard = document.getElementById("live-offline");
		if (offlineCard) offlineCard.classList.remove("hidden");
		var badge = document.getElementById("live-badge");
		if (badge) badge.style.display = "none";
		var st = _liveStreamObj || {};
		_fillOfflineCard({
			title: (st.title || "Stream") + " - offline",
			description: "This livestream has ended.",
			thumbnail: st.thumbnail || null,
		});
		if (_liveCreatorId && AppCtx.state.CREATOR_INFO[_liveCreatorId]) {
			AppCtx.state.CREATOR_INFO[_liveCreatorId]._isLive = false;
		}
		if (_chat) {
			_chat.disconnect();
			_chat = null;
		}
	}

	/**
	 * Fill the offline card with data from liveStream.offline (or liveStream itself).
	 * @param {Object} liveStream
	 */
	function _fillOfflineCard(liveStream) {
		var off = liveStream.offline || liveStream;
		var titleEl = document.getElementById("live-offline-title");
		var descEl = document.getElementById("live-offline-desc");
		var thumbEl = document.getElementById("live-offline-thumb");
		if (titleEl) titleEl.textContent = off.title || "Stream offline";
		if (descEl) {
			var desc = off.description || "";
			// Allow only basic inline tags - strip ALL attributes (no href/on* XSS)
			desc = desc.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag) => {
				var allowed = { b: 1, i: 1, u: 1, br: 1, a: 1, p: 1 };
				return allowed[tag.toLowerCase()] ? "<" + tag.toLowerCase() + ">" : "";
			});
			descEl.innerHTML = desc;
		}
		if (thumbEl && off.thumbnail && off.thumbnail.path)
			thumbEl.src = off.thumbnail.path;
	}

	/**
	 * Load and play the live stream.
	 * @param {string} liveStreamId
	 */
	function _loadLiveStream(liveStreamId) {
		_toast("Loading live stream...");
		var _capturedId = liveStreamId; // ignore stale responses
		FloatplaneAPI.getLiveDeliveryInfo(liveStreamId)
			.then((url) => {
				if (_liveStreamId !== _capturedId) return; // stale response
				if (!url) {
					_toast("No live stream available");
					return;
				}
				var video = document.getElementById("live-video");
				if (!video) return;
				// Use native HLS if available (webOS has built-in HLS)
				// Fallback to Shaka
				if (video.canPlayType("application/vnd.apple.mpegurl")) {
					video.onerror = () => {
						_toast("Live stream playback error");
					};
					video.src = url;
					video
						.play()
						.then(() => {
							video.muted = false;
						})
						.catch(() => {});
				} else {
					HydravionPlayer.init(video)
						.then(() => HydravionPlayer.loadHls(url))
						.then(() => {
							video.muted = false; // #live-video is muted in HTML
							HydravionPlayer.play();
						})
						.catch((err) => {
							_toast("Live playback error");
							console.error("[LIVE] playback error: " + (err.message || err));
						});
				}
			})
			.catch(() => {
				_toast("Failed to load live stream");
			});
	}

	/**
	 * Start the chat connection.
	 * @param {string} liveStreamId
	 */
	function _startChat(liveStreamId) {
		if (_chat) {
			_chat.disconnect();
			_chat = null;
		}
		var msgsEl = document.getElementById("chat-messages");
		if (msgsEl) msgsEl.innerHTML = "";
		_addSystemMessage("Connecting chat...");

		// Chat auth (tk/connect) rejects stale access tokens - the API path
		// auto-refreshes on 401 but chat does not, so refresh first.
		FloatplaneAPI.refreshAccessToken()
			.catch(() => {})
			.then(() => {
				if (!_liveStreamId) return;
				_chat = new LiveChat(liveStreamId, {
					token: FloatplaneAPI.getAccessToken() || "",
				});
				wireChat();
			});
		var _chatMsgCount = 0;
		var _reconnectDelay = 10;

		function wireChat() {
			_chat.onConnected(() => {
				console.log("[LIVE] Chat connected");
				_addSystemMessage("Chat connected");
			});

			_chat.onMessage((msg) => {
				_chatMsgCount++;
				console.log(
					"[LIVE] chat msg #" +
						_chatMsgCount +
						" " +
						(msg.username || "?") +
						": " +
						String(msg.message || "").substring(0, 80),
				);
				_addChatMessage(msg);
			});

			_chat.onDebug((msg) => {
				console.log("[LIVE] chat debug: " + msg);
				_addSystemMessage(msg);
			});

			// Exponential backoff for chat reconnect (10s, 30s, 90s, cap at 180s)
			_chat.onClosed((err) => {
				console.log("[LIVE] Chat closed: " + (err || "unknown"));
				_addSystemMessage(
					"Chat disconnected - reconnecting in " + _reconnectDelay + "s",
				);
				clearTimeout(_reconnectTimer);
				var wait = _reconnectDelay;
				_reconnectDelay = Math.min(_reconnectDelay * 3, 180);
				_reconnectTimer = setTimeout(() => {
					if (_chat && _liveStreamId) _chat.connect();
				}, wait * 1000);
			});
			_chat.onConnected(() => {
				_reconnectDelay = 10; // reset on successful reconnect
			});

			_chat.connect();
		}
	}

	/**
	 * Add a chat message to the scrollable list.
	 * @param {Object} msg radioChatter message object
	 */
	function _addChatMessage(msg) {
		var list = document.getElementById("chat-messages");
		if (!list) return;

		var div = document.createElement("div");
		div.className = "chat-msg";

		var nameSpan = document.createElement("span");
		nameSpan.className = "chat-name";
		nameSpan.textContent = msg.username || "Anonymous";
		div.appendChild(nameSpan);

		var textSpan = document.createElement("span");
		textSpan.className = "chat-text";
		// Basic emote rendering: replace :code: with inline if emotes provided
		var text = msg.message || "";
		if (msg.emotes && msg.emotes.length) {
			text = _renderEmotes(text, msg.emotes);
			textSpan.innerHTML = text;
		} else {
			textSpan.textContent = text;
		}
		div.appendChild(textSpan);

		list.appendChild(div);
		// Only auto-scroll if user is near the bottom
		if (list.scrollTop + list.clientHeight >= list.scrollHeight - 80)
			list.scrollTop = list.scrollHeight;

		// Trim old messages
		while (list.children.length > _MAX_MSGS) {
			if (list.firstChild) list.removeChild(list.firstChild);
		}
	}

	/**
	 * Render emote codes as images.
	 * @param {string} text
	 * @param {Array} emotes [{code, image}]
	 * @returns {string} HTML with emote images
	 */
	function _renderEmotes(text, emotes) {
		var html = text.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
		function _escAttr(s) {
			return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
		}
		function _escRegex(s) {
			return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		for (var ei = 0; ei < emotes.length; ei++) {
			var e = emotes[ei];
			if (!e || !e.code || !e.image) continue;
			var re = new RegExp(":" + _escRegex(e.code) + ":", "g");
			var imgSrc = _escAttr(e.image);
			var imgAlt = _escAttr(e.code);
			html = html.replace(
				re,
				'<img class="chat-emote" src="' + imgSrc + '" alt=":' + imgAlt + ':">',
			);
		}
		return html;
	}

	/**
	 * Add a system message (connected/disconnected notice).
	 * @param {string} text
	 */
	function _addSystemMessage(text) {
		var list = document.getElementById("chat-messages");
		if (!list) return;
		var div = document.createElement("div");
		div.className = "chat-msg chat-system";
		div.textContent = "◆ " + text;
		list.appendChild(div);
		// Only auto-scroll if user is near the bottom
		if (list.scrollTop + list.clientHeight >= list.scrollHeight - 80)
			list.scrollTop = list.scrollHeight;
	}

	/**
	 * Toggle between overlay (chat floats over the video) and side-by-side.
	 */
	function toggleLayout() {
		_layout = _layout === "overlay" ? "side" : "overlay";
		var liveView = document.getElementById("view-live");
		if (!liveView) return;
		liveView.classList.toggle("layout-overlay", _layout === "overlay");
		liveView.classList.toggle("layout-right", _layout === "side");
		var btn = document.getElementById("live-layout-btn");
		if (btn) btn.textContent = _layout === "overlay" ? "⊞ Side" : "⊞ Overlay";
	}

	// Wire live-view UI buttons (runs once at module load)
	(function _wireLiveButtons() {
		var backBtn = document.getElementById("live-back");
		if (backBtn)
			backBtn.addEventListener("click", () => {
				exit();
			});
		var layoutBtn = document.getElementById("live-layout-btn");
		if (layoutBtn) layoutBtn.addEventListener("click", toggleLayout);
	})();

	/**
	 * Exit the live player view and return to browse.
	 */
	function exit() {
		clearTimeout(_reconnectTimer);
		clearInterval(_offlineTimer);
		_offlineTimer = null;
		_liveStreamObj = null;
		_liveCreatorId = null;
		if (_chat) {
			_chat.disconnect();
			_chat = null;
		}
		var video = document.getElementById("live-video");
		// Release Shaka if the fallback path was used (no-op otherwise)
		HydravionPlayer.stop();
		if (video) {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
		var liveView = document.getElementById("view-live");
		if (liveView) liveView.classList.add("hidden");
		_liveStreamId = null;
	}

	/**
	 * Check if the live view is currently shown.
	 * @returns {boolean}
	 */
	function isActive() {
		var liveView = document.getElementById("view-live");
		return liveView && !liveView.classList.contains("hidden");
	}

	/** @returns {?string} Current live stream ID */
	function getLiveStreamId() {
		return _liveStreamId;
	}

	return {
		enter: enter,
		exit: exit,
		toggleLayout: toggleLayout,
		isActive: isActive,
		getLiveStreamId: getLiveStreamId,
	};
})();
