/**
 * @fileoverview Live chat client for Floatplane livestreams.
 * Thin client over the native LS2 service. The service drives the whole
 * socket flow (bootstrap sails.sid cookie -> authenticate the session on
 * the www socket via tk/connect -> join /ck/channel/join on the chat
 * socket). The app polls chat_poll for status + buffered messages - a
 * plain request/response pattern (reliable on simulator + TV), not
 * subscription events.
 *
 * Usage:
 *   var chat = new LiveChat("liveStreamId", { token: "..." });
 *   chat.onMessage(function(msg) { ... });
 *   chat.connect();
 */
var LiveChat = (() => {
	var _serviceId = "luna://com.hydravion.tv.service";
	var _POLL_MS = 1200;

	/** @param {string} liveStreamId Floatplane live stream ID */
	function LiveChat(liveStreamId, opts) {
		this._liveStreamId = liveStreamId;
		this._token = (opts && opts.token) || "";
		this._cookie = (opts && opts.cookie) || "";
		this._onMessage = null;
		this._onConnected = null;
		this._onClosed = null;
		this._onDebug = null;
		this._connected = false;
		this._lastStatus = "";
		this._pollTimer = null;
	}

	/** @private Stop the status poller. */
	LiveChat.prototype._stopPoll = function () {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	};

	/** @private Poll the service for status + buffered messages. */
	LiveChat.prototype._poll = function () {
		webOS.service.request(_serviceId, {
			method: "chat_poll",
			parameters: { connectionId: "default" },
			onSuccess: (resp) => {
				if (!resp || !resp.returnValue) return;
				// Full status history since the last poll - surface every step
				var log = resp.log || [];
				for (var li = 0; li < log.length; li++) {
					console.log("[CHAT] step: " + log[li]);
					if (this._onDebug) this._onDebug(log[li]);
				}
				var msgs = resp.messages || [];
				for (var i = 0; i < msgs.length; i++) {
					if (this._onMessage) this._onMessage(msgs[i]);
				}
				var st = resp.status || "";
				if (st && st !== this._lastStatus) {
					this._lastStatus = st;
					console.log("[CHAT] status: " + st);
					if (st === "SocketIO connected") {
						this._connected = true;
						if (this._onConnected) this._onConnected();
					}
					if (
						st === "ws closed" ||
						st === "disconnected" ||
						st.indexOf("error") === 0
					) {
						this._connected = false;
						if (this._onClosed) this._onClosed(st);
					}
					if (this._onDebug) this._onDebug(st);
				}
			},
			onFailure: () => {},
		});
	};

	/**
	 * Connect to chat via the native service, then poll for status/messages.
	 */
	LiveChat.prototype.connect = function () {
		var params = {
			connectionId: "default",
			liveStreamId: this._liveStreamId,
		};
		if (this._token) params.token = this._token;
		if (this._cookie) params.cookie = this._cookie;

		this._connected = false;
		this._lastStatus = "";
		this._stopPoll();
		webOS.service.request(_serviceId, {
			method: "chat_connect",
			parameters: params,
			onSuccess: (resp) => {
				console.log(
					"[CHAT] connect: " + JSON.stringify(resp).substring(0, 200),
				);
				if (this._onDebug) this._onDebug("connecting");
				this._pollTimer = setInterval(() => this._poll(), _POLL_MS);
			},
			onFailure: (err) => {
				console.error("[CHAT] connect failure: " + JSON.stringify(err));
				if (this._onClosed) this._onClosed("service unavailable");
			},
		});
	};

	/** Close the chat connection. */
	LiveChat.prototype.disconnect = function () {
		this._connected = false;
		this._stopPoll();
		try {
			webOS.service.request(_serviceId, {
				method: "chat_disconnect",
				parameters: { connectionId: "default" },
				onSuccess: () => {},
				onFailure: () => {},
			});
		} catch (e) {}
	};

	/** Chat is read-only - no send support. */
	LiveChat.prototype.send = () => {};

	/** @param {Function} fn Called with a chat message object on each message */
	LiveChat.prototype.onMessage = function (fn) {
		this._onMessage = fn;
	};

	/** @param {Function} fn Called when connected */
	LiveChat.prototype.onConnected = function (fn) {
		this._onConnected = fn;
	};

	/** @param {Function} fn Called on disconnect or error */
	LiveChat.prototype.onClosed = function (fn) {
		this._onClosed = fn;
	};

	/** @param {Function} fn Called with debug/status strings */
	LiveChat.prototype.onDebug = function (fn) {
		this._onDebug = fn;
	};

	/** @returns {boolean} */
	LiveChat.prototype.isConnected = function () {
		return this._connected;
	};

	return LiveChat;
})();
