/* global Service */

var Service = require("webos-service");
var https = require("https");
var http = require("http");
var url = require("url");
var WebSocket = require("ws");

var AUTH_BASE = "https://auth.floatplane.com";
var CHAT_BASE = "wss://chat.floatplane.com";
var service = new Service("com.hydravion.tv.service");

/**
 * Fetch the chat session cookie (sails.sid) from chat.floatplane.com.
 * The chat socket is authenticated by this session cookie - the OAuth
 * bearer alone is rejected. GET /__getcookie creates the session and
 * returns it in Set-Cookie (the web client calls it before connecting).
 * @param {function(string)} cb Called with "sails.sid=<value>" or ""
 */
function _getChatCookie(cb) {
	var req = https.get(
		"https://chat.floatplane.com/__getcookie",
		{
			headers: {
				"User-Agent": "Hydravion (AndroidTV 1.4.2)",
				Accept: "application/json",
			},
		},
		(res) => {
			var cookies = res.headers["set-cookie"];
			res.resume();
			var sid = "";
			if (Array.isArray(cookies)) {
				for (var i = 0; i < cookies.length; i++) {
					if (cookies[i].indexOf("sails.sid") !== -1) {
						sid = cookies[i].split(";")[0];
						break;
					}
				}
			}
			cb(sid);
		},
	);
	req.on("error", () => cb(""));
	req.setTimeout(8000, () => {
		req.destroy();
		cb("");
	});
}

/** Validate message.payload exists. Log and respond with error if missing. */
function _requirePayload(message) {
	if (!message || !message.payload || typeof message.payload !== "object") {
		console.error("[SERVICE] missing or invalid payload");
		if (message && message.respond)
			message.respond({ returnValue: false, error: "Invalid request payload" });
		return false;
	}
	return true;
}

// ── Forward service logs to Python server for dev visibility ─────────
// The frontend tells us the URL on each log call so it works on
// simulator (localhost) and real TV (dev machine LAN IP).

var _logServerUrl = "http://rokico.be:9999/log";
// Derive protocol from the URL so http/https always match the endpoint
var _logProtocol = url.parse(_logServerUrl).protocol || "http:";

function _setLogServer(addr) {
	if (addr && typeof addr === "string") {
		_logServerUrl = addr;
		var p = url.parse(addr);
		_logProtocol = p.protocol || "https:";
	}
}

function _forwardLog(msg) {
	return; // remote log relay disabled
	try {
		var parsed = url.parse(_logServerUrl);
		var body = JSON.stringify({ level: "SERVICE", msg: msg });
		var opts = {
			hostname: parsed.hostname,
			port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
			path: parsed.path || "/log",
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body),
			},
		};
		var lib = _logProtocol === "https:" ? https : http;
		var req = lib.request(opts, () => {});
		req.on("error", (e) => {
			console.error("[SERVICE] _forwardLog error: " + e.message);
		});
		req.write(body);
		req.end();
	} catch (e) {
		console.error("[SERVICE] _forwardLog exception: " + (e.message || e));
	}
}

// ── Auth proxy: forward to Keycloak with no Origin, custom UA ──────────

service.register("auth", (message) => {
	if (!_requirePayload(message)) return;
	var payload = message.payload;
	var path = payload.path;
	var method = (payload.method || "POST").toUpperCase();
	var body = payload.body || "";
	var contentType = payload.contentType || "application/x-www-form-urlencoded";

	var logLine = "[SERVICE:AUTH] " + method + " " + path;
	console.log(logLine);
	_forwardLog(logLine);

	if (!path || typeof path !== "string") {
		message.respond({ returnValue: false, error: "path is required" });
		return;
	}
	// Reject suspicious path chars (control chars, whitespace, dot-dot)
	if (path.indexOf("..") !== -1) {
		message.respond({ returnValue: false, error: "invalid path" });
		return;
	}
	for (var pi = 0; pi < path.length; pi++) {
		var cc = path.charCodeAt(pi);
		if (cc < 33 || cc === 127) {
			// <33 covers control chars AND space (space makes https.request throw)
			message.respond({ returnValue: false, error: "invalid path" });
			return;
		}
	}

	// Respond exactly once no matter which exit fires (oversize/timeout/error/end)
	var responded = false;
	function respondOnce(payload) {
		if (responded) return;
		responded = true;
		message.respond(payload);
	}

	var opts;
	try {
		opts = url.parse(AUTH_BASE + path);
		opts.method = method;
		opts.headers = {
			"Content-Type": contentType,
			Accept: "application/json",
			"User-Agent": "Hydravion (AndroidTV 1.4.2)",
			// No Origin header - Keycloak rejects any we could send
		};
	} catch (e) {
		respondOnce({ returnValue: false, error: "invalid path" });
		return;
	}

	var req;
	try {
		req = https.request(opts, (res) => {
			var chunks = [];
			var totalBytes = 0;
			res.on("data", (c) => {
				totalBytes += c.length;
				if (totalBytes > 1048576) {
					// 1 MB limit
					req.destroy();
					respondOnce({ returnValue: false, error: "Response too large" });
					return;
				}
				chunks.push(c);
			});
			res.on("end", () => {
				var data = Buffer.concat(chunks).toString("utf-8");
				// Scrub token responses from logs (access_token, refresh_token, id_token)
				var logData = data;
				try {
					var j = JSON.parse(data);
					if (j.access_token) logData = "{token_response}";
				} catch (e) {}
				var respLine =
					"[SERVICE:AUTH] <- " +
					res.statusCode +
					" " +
					logData.substring(0, 200);
				console.log(respLine);
				_forwardLog(respLine);
				respondOnce({
					returnValue: true,
					status: res.statusCode,
					body: data,
				});
			});
		});
	} catch (e) {
		respondOnce({
			returnValue: false,
			error: "Authentication server unreachable",
		});
		return;
	}

	req.setTimeout(10000, () => {
		req.destroy();
		respondOnce({
			returnValue: false,
			error: "Authentication server unreachable",
		});
	});

	req.on("error", (e) => {
		var errLine = "[SERVICE:AUTH] ERROR " + e.message;
		console.log(errLine);
		_forwardLog(errLine);
		respondOnce({
			returnValue: false,
			error: "Authentication server unreachable",
		});
	});

	if (body) req.write(body);
	req.end();
});

// ── API proxy: forward Floatplane API calls with UA + Bearer ──────────
// Frontend can't set the User-Agent header from webOS XHR (refused), and
// Cloudflare 403s requests without it. Route API calls through here so the
// UA is set server-side, like the auth proxy.

var API_BASE = "https://www.floatplane.com";

service.register("api", (message) => {
	if (!_requirePayload(message)) return;
	var payload = message.payload;
	var apiUrl = payload.url;
	var method = (payload.method || "GET").toUpperCase();
	var token = payload.token || "";
	var body = payload.body || "";
	var contentType = payload.contentType;

	var logLine = "[SERVICE:API] " + method + " " + apiUrl;
	console.log(logLine);
	_forwardLog(logLine);
	var tStart = Date.now();

	if (!apiUrl || typeof apiUrl !== "string") {
		message.respond({ returnValue: false, error: "url is required" });
		return;
	}
	// SSRF guard: only allow Floatplane API requests
	if (apiUrl.indexOf("https://www.floatplane.com") !== 0) {
		message.respond({ returnValue: false, error: "invalid url" });
		return;
	}
	for (var ui = 0; ui < apiUrl.length; ui++) {
		var cc = apiUrl.charCodeAt(ui);
		if (cc < 33 || cc === 127) {
			message.respond({ returnValue: false, error: "invalid url" });
			return;
		}
	}

	var responded = false;
	function respondOnce(payload) {
		if (responded) return;
		responded = true;
		message.respond(payload);
	}

	var opts;
	try {
		opts = url.parse(apiUrl);
		opts.method = method;
		opts.headers = {
			Accept: "application/json",
			"User-Agent": "Hydravion (AndroidTV 1.4.2)",
		};
		if (token) opts.headers.Authorization = "Bearer " + token;
		if (contentType) opts.headers["Content-Type"] = contentType;
	} catch (e) {
		respondOnce({ returnValue: false, error: "invalid url" });
		return;
	}

	var req;
	try {
		req = https.request(opts, (res) => {
			_captureSailsSid(res);
			var chunks = [];
			var totalBytes = 0;
			res.on("data", (c) => {
				totalBytes += c.length;
				if (totalBytes > 4194304) {
					// 4 MB limit - video metadata can be large
					req.destroy();
					respondOnce({ returnValue: false, error: "Response too large" });
					return;
				}
				chunks.push(c);
			});
			res.on("end", () => {
				var data = Buffer.concat(chunks).toString("utf-8");
				console.log(
					"[SERVICE:API] <- " +
						res.statusCode +
						" in " +
						(Date.now() - tStart) +
						"ms",
				);
				respondOnce({
					returnValue: true,
					status: res.statusCode,
					body: data,
				});
			});
		});
	} catch (e) {
		respondOnce({ returnValue: false, error: "API server unreachable" });
		return;
	}

	req.setTimeout(15000, () => {
		req.destroy();
		console.log("[SERVICE:API] timeout after " + (Date.now() - tStart) + "ms");
		respondOnce({ returnValue: false, error: "API server unreachable" });
	});

	req.on("error", (e) => {
		console.log(
			"[SERVICE:API] error '" +
				e.message +
				"' after " +
				(Date.now() - tStart) +
				"ms",
		);
		respondOnce({ returnValue: false, error: "API server unreachable" });
	});

	if (body) req.write(body);
	req.end();
});

// ── Log relay ──────────────────────────────────────────────────────────
// Frontend sends { level, msg, logServer? }. If logServer is provided,
// store it so future _forwardLog calls use the right URL.

service.register("log", (message) => {
	if (!_requirePayload(message)) return;
	var payload = message.payload;
	if (payload.logServer) _setLogServer(payload.logServer);
	var level = (payload.level || "LOG").toUpperCase();
	var msg = payload.msg || "(empty)";
	var line = "[" + level + "] " + msg;
	console.log(line);
	_forwardLog(line);
	message.respond({ returnValue: true });
});

// ── Keep service alive (prevent 5-second idle timeout) ──────────────────
// webOS services shut down after 5s of inactivity. Create a long-lived
// ActivityManager activity to stay alive as long as the app needs it.
var _keepAlive;
service.activityManager.create("keepAlive", (activity) => {
	_keepAlive = activity;
	var msg = "[SERVICE] keepAlive activity created";
	console.log(msg);
	_forwardLog(msg);
});

// ── Live Chat WebSocket proxy ────────────────────────────────────────────
// Browser WebSocket API can't set Origin header. The LS2 service uses
// Node.js ws library which has no origin restrictions.

/** Latest cookies from www.floatplane.com responses (sails.sid session). */
var _sessionCookie = "";

/**
 * Capture the authenticated sails.sid session cookie from an API response.
 * An authenticated (bearer-token) request to www.floatplane.com returns
 * Set-Cookie: sails.sid=... - that session is the ONLY auth the chat
 * socket accepts, so grab it on every response and reuse it for chat.
 * @param {http.IncomingMessage} res
 */
function _captureSailsSid(res) {
	try {
		var sc = res.headers && res.headers["set-cookie"];
		if (!sc) return;
		if (!Array.isArray(sc)) sc = [sc];
		for (var i = 0; i < sc.length; i++) {
			var pair = String(sc[i]).split(";")[0];
			if (pair.indexOf("sails.sid=") === 0) {
				_sessionCookie = pair;
				console.log("[SERVICE] captured sails.sid: " + pair);
				break;
			}
		}
	} catch (e) {}
}

/**
 * Ensure we hold the authenticated sails.sid session cookie. The server
 * sets it in Set-Cookie on an authenticated (bearer-token) request; if we
 * don't have it yet (the first authed call may have gone via the browser),
 * make our own probe request to trigger it.
 * @param {string} token OAuth access token
 * @param {function(string, string)} cb Called with ("sails.sid=<value>") or
 *   ("", detail) explaining why the session cookie is unavailable
 */
function _ensureSessionCookie(token, cb) {
	if (_sessionCookie) return cb(_sessionCookie, "");
	if (!token) return cb("", "no token available");
	var opts = {
		hostname: "www.floatplane.com",
		// user/self with the bearer token is the endpoint proven to set the
		// sails.sid session cookie (v1 404s now; v3 works but the cookie only
		// appears on AUTHENTICATED requests).
		path: "/api/v3/user/self",
		method: "GET",
		headers: {
			Accept: "application/json",
			"User-Agent": "Hydravion (AndroidTV 1.4.2)",
			Authorization: "Bearer " + token,
		},
	};
	var req = https.request(opts, (res) => {
		_captureSailsSid(res);
		if (!_sessionCookie) {
			var detail =
				"probe: no sails.sid (status=" +
				res.statusCode +
				" set-cookie=" +
				JSON.stringify(res.headers["set-cookie"] || null) +
				")";
			console.log("[SERVICE] session probe: " + detail);
			res.resume();
			res.on("end", () => cb("", detail));
			return;
		}
		res.resume();
		res.on("end", () => cb(_sessionCookie, ""));
	});
	req.on("error", (e) => cb("", "probe error: " + e.message));
	req.setTimeout(10000, () => {
		req.destroy();
		cb("", "probe timeout");
	});
	req.end();
}

var _chatConnections = {};

/** Status string per chat connection (surfaced via chat_poll). */
var _chatStatus = {};

/** Full status history per connection - consumed by chat_poll. */
var _chatLog = {};

/** Record a chat status line (latest + history). */
function _setChatStatus(connId, msg) {
	_chatStatus[connId] = msg;
	if (!_chatLog[connId]) _chatLog[connId] = [];
	_chatLog[connId].push(msg);
	if (_chatLog[connId].length > 60) _chatLog[connId].shift();
}

service.register("chat_connect", (message) => {
	if (!_requirePayload(message)) return;
	var connId = message.payload.connectionId || "default";
	var liveStreamId = message.payload.liveStreamId;
	var subscribed = !!message.subscribed;
	if (!liveStreamId) {
		message.respond({ returnValue: false, error: "liveStreamId required" });
		return;
	}

	// Close any existing connection for this connId - clear ping timer first
	if (_chatConnections[connId]) {
		clearInterval(_chatConnections[connId].pingTimer);
		try {
			_chatConnections[connId].ws.close();
		} catch (e) {
			console.error("[CHAT] error closing old ws: " + (e.message || e));
		}
		delete _chatConnections[connId];
	}

	var WWW_WSS =
		"wss://www.floatplane.com/socket.io/?EIO=3&transport=websocket" +
		"&__sails_io_sdk_version=1.2.1" +
		"&__sails_io_sdk_platform=node" +
		"&__sails_io_sdk_language=javascript";
	var CHAT_WSS =
		"wss://chat.floatplane.com/socket.io/?EIO=3&transport=websocket" +
		"&__sails_io_sdk_version=1.2.1" +
		"&__sails_io_sdk_platform=node" +
		"&__sails_io_sdk_language=javascript";

	var log = "[CHAT:" + connId + "] ";
	console.log(log + "connecting to " + liveStreamId);

	var conn = {
		ws: null,
		authWs: null,
		liveStreamId: liveStreamId,
		message: subscribed ? message : null,
		pingTimer: null,
		joined: false,
		token: message.payload.token || "",
		joinPending: false,
		messages: [],
	};
	conn.messages = [];
	_setChatStatus(connId, "connecting");
	// Respond immediately (plain, like the api method) - the app polls
	// chat_poll for status + buffered messages.
	message.respond({ returnValue: true, status: "connecting" });

	/** Join the livestream chat channel (current /ck/ protocol, bare stream id). */
	function joinChannel() {
		console.log(log + "joining /ck/channel/join " + liveStreamId);
		conn.joinPending = true;
		_wsSend(
			conn,
			"1" +
				JSON.stringify([
					"post",
					{
						method: "post",
						headers: {},
						data: { channel: liveStreamId },
						url: "/ck/channel/join",
					},
				]),
		);
	}

	/** Engine.IO frames shared by both sockets. Returns true if handled. */
	function handleEngineFrame(ws, data) {
		if (data.charAt(0) === "0") return true; // EngineIO OPEN
		if (data === "2") {
			// EngineIO PING -> PONG
			if (ws.readyState === WebSocket.OPEN) ws.send("3");
			return true;
		}
		if (data.charAt(0) !== "4") return true;
		return false; // SocketIO frame - caller handles
	}

	/** Open a socket.io connection with the floatplane origin + session cookie. */
	function connectSocket(url, cookie, onSocketIo) {
		var wsHeaders = { Origin: "https://www.floatplane.com" };
		if (cookie) wsHeaders.Cookie = cookie;
		var ws = new WebSocket(url, {
			headers: wsHeaders,
			perMessageDeflate: false,
		});
		ws.on("open", () => {
			ws.send("40"); // EngineIO MESSAGE + SocketIO CONNECT
		});
		ws.on("message", (raw) => {
			var data = raw.toString("utf-8");
			if (!data || handleEngineFrame(ws, data)) return;
			onSocketIo(ws, data.substring(1));
		});
		ws.on("error", (err) => {
			console.error(log + "ws error: " + (err.message || err));
		});
		return ws;
	}

	// Step 2: authenticate the sails.sid session on the www socket. The chat
	// socket rejects the OAuth token directly; the web client syncs the token
	// on the app socket instead, which links the user to the session cookie.
	function openAuthSocket(cookie) {
		console.log(log + "auth socket www - tk/connect");
		var ws = connectSocket(WWW_WSS, cookie, (sock, payload) => {
			if (payload.charAt(0) === "0") {
				// SocketIO connected - send the token sync
				console.log(log + "auth SocketIO connected - tk/connect");
				_setChatStatus(connId, "auth SocketIO connected");
				if (conn.token && sock.readyState === WebSocket.OPEN) {
					sock.send(
						"42" +
							"1" +
							JSON.stringify([
								"post",
								{
									method: "post",
									headers: {},
									data: { token: conn.token },
									url: "/api/v3/socket/tk/connect",
								},
							]),
					);
				}
				return;
			}
			if (payload.charAt(0) === "3") {
				// ACK from tk/connect - the session is now authenticated
				var ackJson = payload.substring(1).replace(/^\d+/, "");
				try {
					var ack0 = JSON.parse(ackJson)[0] || {};
					var authed = ack0.statusCode === 200;
					console.log(log + "auth ack status=" + ack0.statusCode);
					_setChatStatus(
						connId,
						authed ? "session authenticated" : "auth failed " + ack0.statusCode,
					);
				} catch (e) {}
				try {
					sock.close();
				} catch (e) {}
				openChatSocket(cookie);
				return;
			}
		});
		conn.authWs = ws;
		ws.on("error", (err) => {
			console.error(log + "auth ws error: " + (err.message || err));
			_setChatStatus(connId, "auth socket error: " + (err.message || err));
		});
		ws.on("close", () => {
			conn.authWs = null;
			_setChatStatus(connId, "auth socket closed");
			if (!conn.ws) openChatSocket(cookie);
		});
		// Fallback: don't wait forever on the auth ack
		setTimeout(() => {
			if (!conn.ws) {
				try {
					ws.close();
				} catch (e) {}
				openChatSocket(cookie);
			}
		}, 5000);
	}

	// Step 3: the chat socket - join and forward radioChatter to the app.
	function openChatSocket(cookie) {
		if (conn.ws) return;
		console.log(log + "chat socket connecting " + liveStreamId);
		var ws = connectSocket(CHAT_WSS, cookie, (sock, payload) => {
			if (payload.charAt(0) === "0") {
				// SocketIO connected - notify the app, then join
				console.log(log + "SocketIO connected");
				conn.joined = true;
				_setChatStatus(connId, "SocketIO connected");
				joinChannel();
				return;
			}
			if (payload.charAt(0) === "3") {
				// ACK: join result
				var ackJson = payload.substring(1).replace(/^\d+/, "");
				try {
					var ack0 = JSON.parse(ackJson)[0] || {};
					var dbg = "ack status=" + ack0.statusCode;
					if (conn.joinPending) {
						conn.joinPending = false;
						dbg =
							"join " +
							(ack0.statusCode === 200
								? "OK"
								: "FAILED status=" + ack0.statusCode);
					}
					console.log(log + dbg);
					_setChatStatus(connId, dbg);
				} catch (e) {}
				return;
			}
			if (payload.charAt(0) === "2") {
				// EVENT: buffer chat messages for chat_poll
				try {
					var eventData = JSON.parse(payload.substring(1));
					if (
						Array.isArray(eventData) &&
						eventData.length >= 2 &&
						eventData[0] === "radioChatter"
					) {
						conn.messages.push(eventData[1]);
						if (conn.messages.length > 200) conn.messages.shift();
					}
				} catch (e) {}
				return;
			}
		});
		conn.ws = ws;
		_chatConnections[connId] = conn;
		ws.on("close", () => {
			clearInterval(conn.pingTimer);
			console.log(log + "ws closed");
			_setChatStatus(connId, "ws closed");
			// Only delete if this specific connection is still the active one (race guard)
			if (_chatConnections[connId] === conn) delete _chatConnections[connId];
		});
		ws.on("error", (err) => {
			console.error(log + "ws error: " + (err.message || err));
			_setChatStatus(connId, "error: " + (err.message || err));
		});
	}

	// The chat socket is session-authenticated. Ensure we hold the
	// authenticated sails.sid (probe with the bearer token if needed) and
	// join directly. Fall back to __getcookie + www-socket sync otherwise.
	_ensureSessionCookie(conn.token, (authCookie, detail) => {
		if (authCookie) {
			_setChatStatus(
				connId,
				"using authenticated session cookie: " + authCookie,
			);
			openChatSocket(authCookie);
		} else {
			_setChatStatus(connId, detail || "no session cookie");
			_getChatCookie((cookie) => {
				_setChatStatus(
					connId,
					cookie ? "session cookie ok" : "NO session cookie",
				);
				if (conn.token) openAuthSocket(cookie);
				else openChatSocket(cookie);
			});
		}
	});
});

function _wsSend(conn, payload) {
	if (conn && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
		conn.ws.send("42" + payload);
	}
}

service.register("chat_send", (message) => {
	if (!_requirePayload(message)) return;
	var connId = message.payload.connectionId || "default";
	var conn = _chatConnections[connId];
	if (!conn) {
		message.respond({ returnValue: false, error: "Not connected" });
		return;
	}
	var channel = "/live/" + conn.liveStreamId;
	var msgText = message.payload.message;
	// Validate: string, trimmed, non-empty, capped (server limit territory)
	if (typeof msgText !== "string" || !msgText.trim()) {
		message.respond({ returnValue: false, error: "message required" });
		return;
	}
	msgText = msgText.trim().substring(0, 500);

	var packet = JSON.stringify([
		"post",
		{
			method: "post",
			headers: {},
			data: { channel: channel, message: msgText },
			url: "/RadioMessage/sendLivestreamRadioChatter/",
		},
	]);
	_wsSend(conn, packet);
	message.respond({ returnValue: true });
});

service.register("chat_disconnect", (message) => {
	if (!_requirePayload(message)) return;
	var connId = message.payload.connectionId || "default";
	var conn = _chatConnections[connId];
	if (conn) {
		try {
			conn.ws.close();
		} catch (e) {}
		clearInterval(conn.pingTimer);
		delete _chatConnections[connId];
	}
	_setChatStatus(connId, "disconnected");
	message.respond({ returnValue: true });
});

// Poll for chat status + buffered messages (plain request/response - the
// subscription event pattern is unreliable on some webOS targets).
service.register("chat_poll", (message) => {
	if (!_requirePayload(message)) return;
	var connId = message.payload.connectionId || "default";
	var conn = _chatConnections[connId];
	var msgs =
		conn && Array.isArray(conn.messages) ? conn.messages.splice(0) : [];
	var log = _chatLog[connId] ? _chatLog[connId].splice(0) : [];
	message.respond({
		returnValue: true,
		status: _chatStatus[connId] || (conn ? "connected" : "not connected"),
		messages: msgs,
		log: log,
	});
});

// ── Startup ─────────────────────────────────────────────────────────────

var startupMsg = "[HydravionService] started on webOS " + process.version;
console.log(startupMsg);
_forwardLog(startupMsg);
