/**
 * @fileoverview Floatplane API client - handles auth, tokens, and all API endpoints.
 * Uses XHR with fetch fallback for webOS CORS compatibility, or a native JS Service
 * (webOS LS2) when available to bypass CORS/Origin restrictions entirely.
 */

/** @const {boolean} Debug mode - enables remote log relay to rokico.be */
var DEBUG = false;

/** @const {string} Remote log server (only used when DEBUG=true) */
var LOG_SERVER = "http://rokico.be:9999/log";

/** @const {string} Luna service ID for Hydravion's background service */
var NATIVE_SERVICE = "luna://com.hydravion.tv.service";

/**
 * Call the native LS2 service, wrapped in a Promise.
 * Falls back to the external proxy if the service is unavailable.
 * @param {string} method
 * @param {Object} params
 * @param {number} [timeout]
 * @returns {Promise<Object>}
 */
function _callNativeService(method, params, timeout) {
	return new Promise((resolve, reject) => {
		if (typeof webOS !== "undefined" && webOS.service) {
			var t0 = Date.now();
			var to = setTimeout(() => {
				reject({
					error: "service timeout",
					method: method,
					ms: Date.now() - t0,
				});
			}, timeout || 15000);
			webOS.service.request(NATIVE_SERVICE, {
				method: method,
				parameters: params,
				onSuccess: (resp) => {
					clearTimeout(to);
					console.log("[SVC] " + method + " ok in " + (Date.now() - t0) + "ms");
					if (resp.returnValue) resolve(resp);
					else reject(resp);
				},
				onFailure: (err) => {
					clearTimeout(to);
					console.log(
						"[SVC] " + method + " failed in " + (Date.now() - t0) + "ms",
					);
					reject(err);
				},
			});
		} else {
			reject({ error: "no native service" });
		}
	});
}

/** Send all logs directly to the remote log server (only when DEBUG=true). */
var _logRelayActive = false;
if (DEBUG) {
	_logRelayActive = true;
}
(() => {
	function _send(level, args) {
		if (!_logRelayActive) return;
		try {
			var msg = Array.prototype.map
				.call(args, (a) =>
					typeof a === "object" ? JSON.stringify(a) : String(a),
				)
				.join(" ");
			var xhr = new XMLHttpRequest();
			xhr.open("POST", LOG_SERVER, true);
			xhr.setRequestHeader("Content-Type", "application/json");
			xhr.send(JSON.stringify({ level: level, msg: msg }));
		} catch (e) {}
	}
	var origLog = console.log;
	var origWarn = console.warn;
	var origError = console.error;
	console.log = function () {
		_send("LOG", arguments);
		origLog.apply(console, arguments);
	};
	console.warn = function () {
		_send("WARN", arguments);
		origWarn.apply(console, arguments);
	};
	console.error = function () {
		_send("ERROR", arguments);
		origError.apply(console, arguments);
	};
	window.onerror = (msg, url, line, col, err) => {
		_send("UNCAUGHT", [msg, url, line]);
	};
})();

var FloatplaneAPI = (() => {
	/** @const {string} Base URL for Floatplane API */
	var BASE = "https://www.floatplane.com";

	/** @const {string} OAuth2 client ID from Hydravion AndroidTV */
	var CLIENT_ID = "hydravion";

	/** @const {string} User-Agent for Cloudflare compatibility */
	var UA = "Hydravion (AndroidTV 1.4.2)";

	/** @private {?string} Cached access token */
	var _token = null;

	/** @private {?string} OIDC refresh token (long-lived) */
	var _refreshToken = null;

	/** @private {number} Access token expiry timestamp (ms since epoch) */
	var _expiresAt = 0;

	/** @private {?number} Proactive refresh timer ID */
	var _refreshTimer = null;

	/**
	 * Set User-Agent header on XHR, silently failing if webOS blocks it.
	 * @param {XMLHttpRequest} xhr
	 */
	function _setUA(xhr) {
		try {
			xhr.setRequestHeader("User-Agent", UA);
		} catch (e) {
			_log("UA header blocked");
		}
	}

	/** Log + show toast for 5s (visible on TV). @param {string} msg */
	function _log(msg) {
		try {
			console.warn(msg);
		} catch (e) {}
		try {
			var t = document.getElementById("toast");
			if (t) {
				t.textContent = msg;
				t.classList.add("show");
				var _toastEl = t;
				setTimeout(() => {
					if (_toastEl) _toastEl.classList.remove("show");
				}, 5000);
			}
		} catch (e) {}
	}

	/** Restore tokens from localStorage on init. */
	function _loadTokens() {
		try {
			_token = localStorage.getItem("fp_access_token");
			_refreshToken = localStorage.getItem("fp_refresh_token");
			_expiresAt = parseInt(localStorage.getItem("fp_expires_at") || "0", 10);
		} catch (e) {
			_token = null;
		}
	}

	/**
	 * Schedule an async token refresh before expiry.
	 * @param {number} expiresIn Seconds until access token expires
	 */
	function _scheduleRefresh(expiresIn) {
		clearTimeout(_refreshTimer);
		// Refresh 90s before expiry to give margin for network latency
		var delayMs = Math.max(10000, (expiresIn || 1800) * 1000 - 90000);
		_refreshTimer = setTimeout(() => {
			refreshAccessToken().catch(() => {});
		}, delayMs);
	}

	/**
	 * Persist tokens to localStorage.
	 * @param {string} accessToken
	 * @param {?string} refreshToken
	 * @param {number} expiresIn Seconds until access token expires
	 */
	function _saveTokens(accessToken, refreshToken, expiresIn) {
		_token = accessToken;
		_refreshToken = refreshToken;
		_expiresAt = Date.now() + (expiresIn || 1800) * 1000;
		_scheduleRefresh(expiresIn || 1800);
		try {
			localStorage.setItem("fp_access_token", accessToken);
			localStorage.setItem("fp_refresh_token", refreshToken || "");
			localStorage.setItem("fp_expires_at", String(_expiresAt));
		} catch (e) {}
	}

	/** Remove all stored tokens. */
	function clearTokens() {
		_token = null;
		_refreshToken = null;
		_expiresAt = 0;
		try {
			localStorage.removeItem("fp_access_token");
			localStorage.removeItem("fp_refresh_token");
			localStorage.removeItem("fp_expires_at");
		} catch (e) {}
	}

	/**
	 * Check if user has a stored refresh token (logged in).
	 * @returns {boolean}
	 */
	function isLoggedIn() {
		if (!_token && !_refreshToken) _loadTokens();
		return !!_refreshToken;
	}

	/**
	 * Get the current access token.
	 * Proactive refresh is handled by _scheduleRefresh. Falls back to sync
	 * refresh only if token is already expired (emergency path).
	 * @returns {?string}
	 */
	function getAccessToken() {
		if (!_token && !_refreshToken) _loadTokens();
		// NOTE: no sync refresh fallback here - that used to hit the external
		// auth proxy (rokico.be) synchronously. Disabled: show a toast instead.
		// The async 401/403 retry path in _request() handles refreshes via
		// the native service only.
		return _token;
	}

	/**
	 * URL-encode an object for form-urlencoded POST (Keycloak OIDC).
	 * @param {Object} obj
	 * @returns {string}
	 */
	function _urlEncode(obj) {
		var parts = [];
		for (var k in obj) {
			// The hasOwn call is patched for webOS Chrome 68 (safe pattern)
			if (Object.prototype.hasOwnProperty.call(obj, k)) {
				parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
			}
		}
		return parts.join("&");
	}

	/**
	 * Auth POST - native LS2 service only. The external proxy fallback
	 * (rokico.be) is DISABLED: on service failure we toast and reject instead.
	 * @param {string} path Keycloak OIDC path (e.g. /realms/floatplane/...)
	 * @param {Object} data Form parameters
	 * @returns {Promise<Object>} Resolves with parsed JSON
	 */
	function _authPost(path, data) {
		// If native is latched dead, don't stall 8s a second time - fail fast
		// so the caller can toast immediately instead of hanging.
		if (_nativeDead)
			return Promise.reject({
				error: "service timeout",
				method: "auth",
				ms: 0,
			});
		var body = _urlEncode(data);
		return _callNativeService(
			"auth",
			{
				path: path,
				method: "POST",
				body: body,
				contentType: "application/x-www-form-urlencoded",
			},
			3000,
		).then(
			(resp) => {
				console.log(
					"[AUTH-SERVICE] " +
						path +
						" status=" +
						resp.status +
						" body=" +
						(resp.body || "").substring(0, 200),
				);
				// Pass through any HTTP response (2xx, 4xx, etc.) - caller handles them
				if (resp.status >= 200 && resp.status < 300) {
					try {
						return JSON.parse(resp.body);
					} catch (e) {
						throw { status: resp.status, text: resp.body };
					}
				}
				// Non-2xx from service - re-throw for caller
				throw { status: resp.status, text: resp.body };
			},
			(err) => {
				// Service call itself failed (timeout/unavailable) - no proxy
				// fallback anymore, surface it instead.
				_log("Auth service unavailable - check TV connection");
				throw (
					(err && (err.error || err.message)) ||
					(err && err.status) || { status: 0, text: "Auth service unavailable" }
				);
			},
		);
	}

	// webOS refuses to set the User-Agent header on XHR, and Cloudflare 403s
	// without it - the service sets UA server-side when the native path is used.
	var _nativeDead = false; // latched true after 2 consecutive timeouts
	var _nativeFails = 0; // consecutive native timeouts
	var _nativeRetryAt = 0; // ms - allow a native retry after this (service may have been relaunched)
	function _nativeAvailable() {
		if (_nativeDead && Date.now() > _nativeRetryAt) {
			_nativeDead = false;
			_nativeFails = 0;
		}
		return (
			!_nativeDead &&
			typeof webOS !== "undefined" &&
			webOS.service &&
			typeof _callNativeService === "function"
		);
	}
	/**
	 * Standard API request with JSON body and Bearer auth.
	 * Auto-refreshes token on 401/403.
	 * @param {string} method HTTP method
	 * @param {string} url Full URL
	 * @param {Object} [body] JSON body
	 * @param {boolean} [skipRetry] Skip auto-refresh on 401/403
	 * @returns {Promise<Object>}
	 */
	function _request(method, url, body, skipRetry) {
		var useNative = _nativeAvailable();
		console.log(
			"[REQ] " +
				method +
				" " +
				url.split("/").slice(-1)[0] +
				" via " +
				(useNative ? "native" : "xhr"),
		);
		var doRequest;
		if (useNative) {
			doRequest = () => {
				var tN = Date.now();
				return _callNativeService(
					"api",
					{
						url: url,
						method: method,
						token: _token,
						body: body ? JSON.stringify(body) : "",
						contentType: body ? "application/json" : "",
					},
					3000,
				).then(
					(resp) => {
						console.log(
							"[REQ] native -> " +
								resp.status +
								" in " +
								(Date.now() - tN) +
								"ms " +
								(resp.body || "").substring(0, 120),
						);
						return { status: resp.status, text: resp.body };
					},
					(err) => {
						// A timeout means the service isn't responding - stop
						// trying it for the rest of the session (it just adds
						// latency to every request). But TV node services
						// cold-start slowly, so a single timeout is often just
						// the first call racing the service boot. Only latch
						// after 2 consecutive timeouts, and re-arm a retry
						// after 30s in case the service was relaunched.
						if (err && err.error === "service timeout") {
							_nativeFails++;
							if (_nativeFails >= 2) {
								_nativeDead = true;
								_nativeRetryAt = Date.now() + 30000;
							}
						}
						console.log(
							"[REQ] native failed in " +
								(Date.now() - tN) +
								"ms (" +
								(err && (err.error || err.message)) +
								"), falling back to xhr",
						);
						return _xhrRequest(method, url, body);
					},
				);
			};
		} else {
			doRequest = () => _xhrRequest(method, url, body);
		}
		return doRequest().then(
			(xhr) => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						return JSON.parse(xhr.text);
					} catch (e) {
						return xhr.text;
					}
				}
				if (
					(xhr.status === 401 || xhr.status === 403) &&
					!skipRetry &&
					_refreshToken
				) {
					return refreshAccessToken().then(() =>
						_request(method, url, body, true),
					);
				}
				throw { status: xhr.status, text: xhr.text };
			},
			(err) => {
				throw err;
			},
		);
	}

	/** Plain XHR request (fallback when native service is unavailable). */
	function _xhrRequest(method, url, body) {
		return new Promise((resolve, reject) => {
			var t0 = Date.now();
			var xhr = new XMLHttpRequest();
			xhr.open(method, url, true);
			_setUA(xhr);
			xhr.setRequestHeader("Accept", "application/json");
			if (_token) xhr.setRequestHeader("Authorization", "Bearer " + _token);
			if (body) xhr.setRequestHeader("Content-Type", "application/json");
			xhr.onload = () => {
				console.log(
					"[XHR] " +
						method +
						" " +
						url.split("/").slice(-1)[0] +
						" -> " +
						xhr.status +
						" in " +
						(Date.now() - t0) +
						"ms",
				);
				resolve({ status: xhr.status, text: xhr.responseText });
			};
			xhr.onerror = () => {
				console.log(
					"[XHR] " +
						method +
						" " +
						url.split("/").slice(-1)[0] +
						" error in " +
						(Date.now() - t0) +
						"ms",
				);
				reject({ status: 0, text: "Network error" });
			};
			try {
				if (body) xhr.send(JSON.stringify(body));
				else xhr.send();
			} catch (e) {
				console.warn("[XHR] send failed", e);
				reject({ status: 0, text: "send error" });
			}
		});
	}

	// --- OAuth2 Device Auth ---

	/** Start OAuth2 device authorization flow. @returns {Promise<Object>} */
	function startDeviceAuth() {
		return _authPost("/realms/floatplane/protocol/openid-connect/auth/device", {
			client_id: CLIENT_ID,
			scope: "openid offline_access",
		});
	}

	/**
	 * Poll for token after user authorizes via device code.
	 * @param {string} deviceCode
	 * @returns {Promise<Object>}
	 */
	function pollDeviceAuth(deviceCode) {
		return _authPost("/realms/floatplane/protocol/openid-connect/token", {
			client_id: CLIENT_ID,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			device_code: deviceCode,
		}).then((data) => {
			if (data.access_token)
				_saveTokens(data.access_token, data.refresh_token, data.expires_in);
			return data;
		});
	}

	/** @returns {Promise<Object>} */
	function refreshAccessToken() {
		if (!_refreshToken) return Promise.reject("No refresh token");
		return _authPost("/realms/floatplane/protocol/openid-connect/token", {
			client_id: CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: _refreshToken,
		}).then((data) => {
			if (data.access_token)
				_saveTokens(
					data.access_token,
					data.refresh_token || _refreshToken,
					data.expires_in,
				);
			return data;
		});
	}

	/** Revoke token and clear local storage. @returns {Promise} */
	function revokeToken() {
		if (!_token) return Promise.resolve();
		return _authPost("/realms/floatplane/protocol/openid-connect/revoke", {
			client_id: CLIENT_ID,
			token: _token,
		})
			.catch(() => {})
			.then(() => {
				clearTokens();
			});
	}

	// --- API Endpoints ---

	/** @returns {Promise<Array>} User's subscriptions */
	function getSubscriptions() {
		return _request("GET", BASE + "/api/v3/user/subscriptions");
	}

	/** @param {string} creatorId @returns {Promise<Object>} Creator info including channels */
	function getCreatorInfo(creatorId) {
		return _request(
			"GET",
			BASE + "/api/v3/creator/info?id=" + encodeURIComponent(creatorId),
		);
	}

	/**
	 * Discover/browse creators (all creators, not just subscriptions).
	 * GET /api/v3/creator/discover
	 * @param {Object} opts { searchField, categories[], skip, limit, creatorStats }
	 * @returns {Promise<Object>} { creators: [{id,title,urlname,icon,description,category,stats,featuredBlogPosts}], total, hasMore }
	 */
	function getDiscoverCreators(opts) {
		opts = opts || {};
		var params = [];
		if (opts.searchField)
			params.push("searchField=" + encodeURIComponent(opts.searchField));
		if (opts.categories && opts.categories.length)
			params.push(
				"categories=" + encodeURIComponent(opts.categories.join(",")),
			);
		if (opts.skip) params.push("skip=" + opts.skip);
		params.push("limit=" + (opts.limit || 20));
		if (opts.creatorStats !== false) params.push("creatorStats=true");
		params.push(
			"featuredBlogPosts=" +
				(opts.featuredBlogPosts !== undefined ? opts.featuredBlogPosts : 1),
		);
		return _request(
			"GET",
			BASE + "/api/v3/creator/discover?" + params.join("&"),
		);
	}

	/**
	 * List creator categories for discover filters.
	 * GET /api/v3/creator/category/list -> [{ id, title }]
	 * @returns {Promise<Array<Object>>}
	 */
	function getCreatorCategories() {
		return _request("GET", BASE + "/api/v3/creator/category/list");
	}

	/**
	 * Subscribe to a creator (uses their default/first available plan).
	 * POST /api/v3/creator/subscribe with { id: creatorId }
	 * @param {string} creatorId
	 * @returns {Promise<Object>}
	 */
	function subscribeToCreator(creatorId) {
		return _request("POST", BASE + "/api/v3/creator/subscribe", {
			id: creatorId,
		});
	}

	/**
	 * Unsubscribe from a creator.
	 * POST /api/v3/creator/unsubscribe with { id: creatorId }
	 * @param {string} creatorId
	 * @returns {Promise<Object>}
	 */
	function unsubscribeFromCreator(creatorId) {
		return _request("POST", BASE + "/api/v3/creator/unsubscribe", {
			id: creatorId,
		});
	}

	/**
	 * @param {string} creatorId
	 * @param {number} [offset] Pagination offset
	 * @param {string} [search] Server-side text search
	 * @returns {Promise<Array>}
	 */
	function getVideos(creatorId, offset, search) {
		var url =
			BASE + "/api/v3/content/creator?id=" + encodeURIComponent(creatorId);
		if (offset) url += "&fetchAfter=" + encodeURIComponent(offset);
		if (search) url += "&search=" + encodeURIComponent(search);
		return _request("GET", url);
	}

	/**
	 * Get the user's watch history (undocumented endpoint).
	 * @param {number} [offset]
	 * @returns {Promise<Array>} Array of {userId, contentId, contentType, progress (0-100), updatedAt, blogPost}
	 */
	function getHistory(offset) {
		return _request(
			"GET",
			BASE + "/api/v3/content/history?offset=" + (offset || 0),
		);
	}

	/**
	 * Get the current user's activity feed (comments they've made).
	 * Requires the user id: GET /api/v3/user/activity?id=<userId>
	 * @param {string} userId Current user's ID
	 * @returns {Promise<Object>} { visibility, activity: [{time, comment, postTitle, postId, creatorTitle, creatorUrl, hidden}] }
	 */
	function getActivity(userId) {
		return _request(
			"GET",
			BASE + "/api/v3/user/activity?id=" + encodeURIComponent(userId || ""),
		);
	}

	/**
	 * Get the current user's self info (email, displayName, accounts, etc).
	 * GET /api/v3/user/self -> UserSelfInfo { id, username, displayName, email, ... }
	 * @returns {Promise<Object>}
	 */
	function getUserSelf() {
		return _request("GET", BASE + "/api/v3/user/self");
	}

	/**
	 * List the user's connected third-party accounts (Discord, etc).
	 * GET /api/v3/connect/list -> [{ remoteSiteName, remoteUserName, ... }]
	 * @returns {Promise<Array<Object>>}
	 */
	function getConnections() {
		return _request("GET", BASE + "/api/v3/connect/list");
	}

	/**
	 * List the current user's payment invoices.
	 * @returns {Promise<Object>} Invoice list response
	 */
	function getInvoices() {
		return _request("GET", BASE + "/api/v3/payment/invoice/list");
	}

	/**
	 * Get the user's per-channel notification settings.
	 * @returns {Promise<Object>} { settings: [{creator, channels}], emailNotificationsEnabled }
	 */
	function getChannelNotifications() {
		return _request("GET", BASE + "/api/v3/user/notification/channels/list");
	}

	/**
	 * Update per-channel notification settings.
	 * POST /api/v3/user/notification/channels
	 * Body: { settings: [{channel, enabled}], emailNotificationsEnabled }
	 * @param {Object} payload Full settings payload
	 * @returns {Promise<Object>}
	 */
	function updateChannelNotifications(payload) {
		return _request(
			"POST",
			BASE + "/api/v3/user/notification/channels",
			payload,
		);
	}

	function getChannelVideos(creatorId, channelId, offset) {
		var url =
			BASE +
			"/api/v3/content/creator?id=" +
			encodeURIComponent(creatorId) +
			"&channel=" +
			encodeURIComponent(channelId);
		if (offset) url += "&fetchAfter=" + encodeURIComponent(offset);
		return _request("GET", url);
	}

	/**
	 * @param {string} entityId Video attachment ID
	 * @param {string} [scenario]
	 * @returns {Promise<Object>} Delivery info with CDN URLs
	 */
	function getDeliveryInfo(entityId, scenario) {
		scenario = scenario || "onDemand";
		return _request(
			"GET",
			BASE +
				"/api/v3/delivery/info?scenario=" +
				scenario +
				"&entityId=" +
				encodeURIComponent(entityId),
		);
	}

	/**
	 * Get live stream delivery info.
	 * Uses entityKind=livestream param (required for correct offline detection).
	 * @param {string} liveStreamId
	 * @returns {Promise<string|null>} Live stream HLS URL or null
	 */
	function getLiveDeliveryInfo(liveStreamId) {
		return _request(
			"GET",
			BASE +
				"/api/v3/delivery/info?scenario=live" +
				"&entityId=" +
				encodeURIComponent(liveStreamId) +
				"&entityKind=livestream",
		).then((d) => {
			// 202 empty response = offline, 200 with data = live
			if (!d) return null;
			if (typeof d !== "object") return null;
			var group = d.groups && d.groups[0];
			if (!group || !group.variants || !group.variants.length) return null;
			var cdn =
				(group.origins && group.origins[0] && group.origins[0].url) || "";
			var variant = group.variants[0];
			if (!variant || !variant.url) {
				if (d.urls && d.urls.hls) return d.urls.hls;
				return null;
			}
			var url = variant.url;
			if (url.indexOf("/") === 0 && cdn) url = cdn + url;
			return url;
		});
	}

	/** @param {string} videoId @returns {Promise<Object>} Full video metadata */
	function getVideoInfo(videoId) {
		return _request(
			"GET",
			BASE + "/api/v3/content/video?id=" + encodeURIComponent(videoId),
		);
	}

	/**
	 * @param {string} contentId Blog post ID
	 * @param {?string} cursor Pagination cursor
	 * @param {number} [limit]
	 * @returns {Promise<Array>}
	 */
	function getComments(contentId, cursor, limit) {
		var url =
			BASE + "/api/v3/comment?blogPost=" + encodeURIComponent(contentId);
		// Match the webapp: sortBy/sortDirection params return the response
		// shape that includes per-comment badges.
		url += "&limit=" + (limit || 20);
		url += "&sortBy=createdAt&sortDirection=DESC";
		if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
		return _request("GET", url);
	}

	/** @param {string} postId @returns {Promise<Object>} Post data including userInteraction */
	function getPostInfo(postId) {
		return _request(
			"GET",
			BASE + "/api/v3/content/post?id=" + encodeURIComponent(postId),
		);
	}

	/**
	 * Fetch supporter badge definitions by ID (batch).
	 * POST /api/v3/achievement/perks with { ids: [...] } - returns an array
	 * of { id, type, title, image: { path } }.
	 * @param {string[]} ids Badge IDs (from comment .badges)
	 * @returns {Promise<Array<Object>>}
	 */
	function getBadgePerks(ids) {
		return _request("POST", BASE + "/api/v3/achievement/perks", {
			ids: ids || [],
		});
	}

	/**
	 * Post a comment (or reply) on a blog post.
	 * POST /api/v3/comment/reply { blogPost, text, replyTo? }
	 * Verified against the webapp bundle (4.5.12): replyTo is the parent
	 * comment id - omit it for a top-level comment.
	 * @param {string} contentId Blog post ID
	 * @param {string} text Comment body
	 * @param {?string} [replyTo] Parent comment ID for a threaded reply
	 * @returns {Promise<Object>} Created comment (CommentReplyInfo shape)
	 */
	function postComment(contentId, text, replyTo) {
		return _request("POST", BASE + "/api/v3/comment/reply", {
			blogPost: contentId,
			text: text,
			replyTo: replyTo || undefined,
		});
	}

	/**
	 * Like a comment.
	 * POST /api/v3/comment/like { comment, blogPost }
	 * @param {string} commentId Comment ID
	 * @param {string} contentId Blog post ID
	 * @returns {Promise<Object>}
	 */
	function likeComment(commentId, contentId) {
		return _request("POST", BASE + "/api/v3/comment/like", {
			comment: commentId,
			blogPost: contentId,
		});
	}

	/**
	 * Dislike a comment.
	 * POST /api/v3/comment/dislike { comment, blogPost }
	 * @param {string} commentId Comment ID
	 * @param {string} contentId Blog post ID
	 * @returns {Promise<Object>}
	 */
	function dislikeComment(commentId, contentId) {
		return _request("POST", BASE + "/api/v3/comment/dislike", {
			comment: commentId,
			blogPost: contentId,
		});
	}

	/**
	 * Delete a comment (creator or author only).
	 * POST /api/v3/comment/delete { comment }
	 * @param {string} commentId Comment ID
	 * @returns {Promise<Object>}
	 */
	function deleteComment(commentId) {
		return _request("POST", BASE + "/api/v3/comment/delete", {
			comment: commentId,
		});
	}

	/**
	 * Local watch-later list (not on floatplane.com - app-only feature).
	 * Stored in localStorage as an array of {id, title, thumb, creatorId, added}.
	 */
	function getWatchLater() {
		try {
			return JSON.parse(localStorage.getItem("fp_watch_later") || "[]");
		} catch (e) {
			return [];
		}
	}
	function isInWatchLater(id) {
		var list = getWatchLater();
		for (var wi = 0; wi < list.length; wi++)
			if (list[wi].id === id) return true;
		return false;
	}
	function addToWatchLater(vid) {
		var list = getWatchLater();
		for (var wi = 0; wi < list.length; wi++)
			if (list[wi].id === vid.id) return list; // already there
		list.unshift({
			id: vid.id,
			title: vid.title || "",
			thumb: (vid.thumbnail && vid.thumbnail.path) || "",
			thumbSmall:
				vid.thumbnail &&
				vid.thumbnail.childImages &&
				vid.thumbnail.childImages.length
					? vid.thumbnail.childImages
					: null,
			creatorId: vid.creatorId || null,
			creatorTitle: vid.creatorTitle || "",
			releaseDate: vid.releaseDate || "",
			likes: vid.likes !== undefined ? vid.likes : null,
			dislikes: vid.dislikes !== undefined ? vid.dislikes : null,
			duration:
				vid.metadata && vid.metadata.videoDuration
					? vid.metadata.videoDuration
					: null,
			added: Date.now(),
		});
		try {
			localStorage.setItem("fp_watch_later", JSON.stringify(list));
		} catch (e) {}
		return list;
	}
	function removeFromWatchLater(id) {
		var list = getWatchLater();
		list = list.filter((item) => item.id !== id);
		try {
			localStorage.setItem("fp_watch_later", JSON.stringify(list));
		} catch (e) {}
		return list;
	}
	function clearWatchLater() {
		try {
			localStorage.removeItem("fp_watch_later");
		} catch (e) {}
		return [];
	}

	/**
	 * Report watch progress to the server (feeds the watch history).
	 * POST /api/v3/content/progress with { id, contentType, progress }.
	 * @param {string} id Content/post ID
	 * @param {string} contentType e.g. "blogPost"
	 * @param {number} progress 0-100 percent
	 * @returns {Promise<Object>}
	 */
	function updateProgress(id, contentType, progress) {
		return _request("POST", BASE + "/api/v3/content/progress", {
			id: id,
			contentType: contentType || "blogPost",
			progress: progress,
		});
	}

	/**
	 * Fetch watch progress for multiple videos.
	 * @param {string[]} ids Video/post IDs
	 * @returns {Promise<Object<string,number>>} Map of id -> percent (0-100)
	 */
	function getProgress(ids) {
		if (!ids || !ids.length) return Promise.resolve({});
		// Floatplane 400s when too many ids are batched in one request - chunk.
		var CHUNK = 10;
		var chunks = [];
		for (var ci = 0; ci < ids.length; ci += CHUNK)
			chunks.push(ids.slice(ci, ci + CHUNK));
		return Promise.all(
			chunks.map((chunkIds) => {
				var url = BASE + "/api/v3/content/progress?contentType=blogPost";
				for (var pi = 0; pi < chunkIds.length; pi++)
					url += "&ids[" + pi + "]=" + encodeURIComponent(chunkIds[pi]);
				return _request("GET", url)
					.then((data) => {
						var map = {};
						if (Array.isArray(data)) {
							for (var di = 0; di < data.length; di++) {
								var item = data[di];
								if (item && item.id !== undefined) {
									// Floatplane may return 'percent' or 'progress' or a raw number
									var pct =
										item.percent !== undefined
											? item.percent
											: item.progress !== undefined
												? item.progress
												: typeof item.value === "number"
													? item.value
													: 0;
									if (pct > 0) map[item.id] = Math.min(100, Math.round(pct));
								}
							}
						} else if (data && typeof data === "object") {
							// Or it could return { id1: percent1, id2: percent2 }
							for (var dk in data) {
								if (typeof data[dk] === "number" && data[dk] > 0)
									map[dk] = Math.min(100, Math.round(data[dk]));
							}
						}
						return map;
					})
					.catch(() => ({}));
			}),
		).then((maps) => {
			var merged = {};
			for (var mi = 0; mi < maps.length; mi++) {
				for (var mk in maps[mi]) merged[mk] = maps[mi][mk];
			}
			return merged;
		});
	}

	/** @param {string} contentId @returns {Promise} */
	function likeContent(contentId) {
		return _request("POST", BASE + "/api/v3/content/like", {
			id: contentId,
			contentType: "blogPost",
		});
	}

	/** @param {string} contentId @returns {Promise} */
	function dislikeContent(contentId) {
		return _request("POST", BASE + "/api/v3/content/dislike", {
			id: contentId,
			contentType: "blogPost",
		});
	}

	_loadTokens();

	var _api = {
		/**
		 * Decode the JWT access token payload to get user info.
		 * @returns {{sub?:string, preferred_username?:string, email?:string, name?:string}}
		 */
		getUserInfo: () => {
			var t = getAccessToken();
			if (!t) return {};
			try {
				var payload = t.split(".")[1];
				if (!payload) return {};
				var padded = payload;
				while (padded.length % 4 !== 0) padded += "=";
				return JSON.parse(atob(padded));
			} catch (e) {
				return {};
			}
		},
		isLoggedIn: isLoggedIn,
		getAccessToken: getAccessToken,
		clearTokens: clearTokens,
		startDeviceAuth: startDeviceAuth,
		pollDeviceAuth: pollDeviceAuth,
		refreshAccessToken: refreshAccessToken,
		revokeToken: revokeToken,
		getSubscriptions: getSubscriptions,
		getCreatorInfo: getCreatorInfo,
		getDiscoverCreators: getDiscoverCreators,
		getCreatorCategories: getCreatorCategories,
		subscribeToCreator: subscribeToCreator,
		unsubscribeFromCreator: unsubscribeFromCreator,
		getVideos: getVideos,
		getHistory: getHistory,
		getActivity: getActivity,
		getUserSelf: getUserSelf,
		getConnections: getConnections,
		getInvoices: getInvoices,
		getChannelNotifications: getChannelNotifications,
		updateChannelNotifications: updateChannelNotifications,
		getChannelVideos: getChannelVideos,
		getDeliveryInfo: getDeliveryInfo,
		getLiveDeliveryInfo: getLiveDeliveryInfo,
		getVideoInfo: getVideoInfo,
		getComments: getComments,
		getPostInfo: getPostInfo,
		getBadgePerks: getBadgePerks,
		postComment: postComment,
		likeComment: likeComment,
		dislikeComment: dislikeComment,
		deleteComment: deleteComment,
		getWatchLater: getWatchLater,
		isInWatchLater: isInWatchLater,
		addToWatchLater: addToWatchLater,
		removeFromWatchLater: removeFromWatchLater,
		clearWatchLater: clearWatchLater,
		getProgress: getProgress,
		updateProgress: updateProgress,
		likeContent: likeContent,
		dislikeContent: dislikeContent,
	};
	// Typo guard: accessing an unknown method throws a clear error at runtime
	// instead of the opaque "X is not a function" crash. The static call-site
	// check in scripts/smoke-load.js catches these at build time.
	return new Proxy(_api, {
		get(t, p) {
			if (typeof p === "symbol" || p in t) return t[p];
			throw new TypeError(
				"FloatplaneAPI." + String(p) + " does not exist - check js/api.js",
			);
		},
	});
})();
