/**
 * @fileoverview Login view - OAuth2 device auth (QR code + polling).
 * Registers into AppCtx.views.login. Owns POLL_INTERVAL + QR_CODE (login-only).
 */
(() => {
	/** @private {?number} Poll interval ID for device auth */
	var POLL_INTERVAL = null;
	/** @private QRCode instance (reused across login renders) */
	var QR_CODE;

	/** Start OAuth2 device auth - QR code + polling. */
	function startLogin() {
		// Clear any existing poll timer to prevent duplicate loops on relaunch
		if (POLL_INTERVAL) clearInterval(POLL_INTERVAL);
		POLL_INTERVAL = null;
		AppCtx.util._show("view-login");

		// Static signup QR (left panel): floatplane.com - rendered once
		_renderSignupQr();

		document.getElementById("login-qr").innerHTML =
			'<div style="font-size:14px;color:#666;padding:20px">Connecting...</div>';
		document.getElementById("login-code").textContent = "------";
		document.getElementById("login-url").textContent = "";

		// Debug log
		var debug = document.getElementById("login-debug");
		debug.style.display = "none";
		debug.innerHTML = "";

		/** @param {string} msg Append to debug panel + console */
		function _dbg(msg) {
			debug.style.display = "block";
			debug.innerHTML += msg + "<br>";
			try {
				console.log("[NET]", msg.replace(/<[^>]*>/g, ""));
			} catch (e) {}
		}

		_dbg("🔍 Checking network...");

		// Image-based connectivity tests (no CORS needed)
		var img1 = new Image();
		img1.onload = () => {
			_dbg("✅ pbs.fp: OK");
		};
		img1.onerror = () => {
			_dbg("❌ pbs.fp: FAIL");
		};
		img1.src =
			"https://pbs.floatplane.com/creator_icons/59f94c0bdd241b70349eb72b/770551996990709_1551249357205_100x100.jpeg?_=" +
			Date.now();

		// DNS + connectivity via fetch no-cors
		if (typeof fetch !== "undefined") {
			fetch("https://auth.floatplane.com", { mode: "no-cors" })
				.then(() => {
					_dbg("✅ auth.fp: reachable");
				})
				.catch(() => {
					_dbg("❌ auth.fp: UNREACHABLE");
				});
			fetch("https://www.floatplane.com", { mode: "no-cors" })
				.then(() => {
					_dbg("✅ www.fp: reachable");
				})
				.catch(() => {
					_dbg("❌ www.fp: UNREACHABLE");
				});
		}

		// TV info
		if (typeof webOS !== "undefined" && webOS.systemInfo) {
			var sys = webOS.systemInfo();
			_dbg("📍 TV: " + (sys.country || "?") + ", tz: " + (sys.timezone || "?"));
		}

		// Start device auth
		clearInterval(POLL_INTERVAL);
		console.log("[AUTH] Requesting device code...");
		FloatplaneAPI.startDeviceAuth()
			.then((data) => {
				console.log("[AUTH] Device code received:", JSON.stringify(data));
				var uri = data.verification_uri_complete || data.verification_uri;
				var userCode = data.user_code;
				console.log("[AUTH] PIN: " + userCode + " URL: " + uri);
				var expiresIn = data.expires_in;
				var interval = 10;

				document.getElementById("login-code").textContent = userCode;
				document.getElementById("login-url").textContent = uri;

				// QR code
				var qrContainer = document.getElementById("login-qr");
				qrContainer.innerHTML = "";
				try {
					QR_CODE = qrcode(0, "M");
					QR_CODE.addData(uri);
					QR_CODE.make();
					var svg = QR_CODE.createSvgTag(8, 0);
					if (svg && svg.length > 0) qrContainer.innerHTML = svg;
					else throw "empty svg";
				} catch (e) {
					qrContainer.innerHTML =
						'<div style="font-size:14px;color:#999;padding:10px">Visit: <span style="color:#0095D6">' +
						uri +
						"</span></div>";
				}

				// Countdown timer
				var deadline = Date.now() + expiresIn * 1000;
				var timerEl = document.getElementById("login-timer");
				var countdownInterval = setInterval(() => {
					var remaining = Math.round((deadline - Date.now()) / 1000);
					if (remaining <= 0) {
						clearInterval(countdownInterval);
						clearInterval(POLL_INTERVAL);
						if (timerEl)
							timerEl.textContent = "Code expired - getting new one...";
						startLogin();
						return;
					}
					var min = Math.floor(remaining / 60);
					var sec = remaining % 60;
					if (timerEl)
						timerEl.textContent =
							"Expires in " + min + ":" + (sec < 10 ? "0" : "") + sec;
				}, 1000);

				// Poll for authorization (rescheduled on slow_down responses)
				var pollFn = () => {
					if (Date.now() > deadline) {
						clearInterval(POLL_INTERVAL);
						return;
					}
					FloatplaneAPI.pollDeviceAuth(data.device_code)
						.then((res) => {
							if (res.access_token) {
								clearInterval(POLL_INTERVAL);
								clearInterval(countdownInterval);
								onLoginSuccess();
							}
						})
						.catch((err) => {
							if (err.status === 400) {
								try {
									var b = JSON.parse(err.text);
									if (b.error === "slow_down") {
										interval += 2;
										clearInterval(POLL_INTERVAL);
										POLL_INTERVAL = setInterval(pollFn, interval * 1000);
									} else if (b.error === "expired_token")
										clearInterval(POLL_INTERVAL);
								} catch (e) {}
							}
						});
				};
				POLL_INTERVAL = setInterval(pollFn, interval * 1000);
			})
			.catch((err) => {
				console.log("[AUTH] Failed:", JSON.stringify(err));
				var debug = document.getElementById("login-debug");
				if (debug) {
					var d =
						err && err.text
							? String(err.text).substring(0, 500)
							: JSON.stringify(err);
					debug.innerHTML +=
						"Auth FAILED: HTTP " +
						(err && err.status !== undefined ? err.status : "?") +
						"<br>" +
						d;
				}
				document.getElementById("login-qr").innerHTML =
					'<div style="color:#e55;padding:20px;word-break:break-all">Auth error: ' +
					((err && err.text) ||
						(err && err.status !== undefined
							? "HTTP " + err.status
							: "Network error")) +
					"</div>";
				document.getElementById("login-code").textContent = "---";
			});
	}

	/** Called when OAuth flow completes successfully. */
	function onLoginSuccess() {
		document.getElementById("login-qr").innerHTML = "";
		AppCtx.util._show("view-loading");
		AppCtx.views.app.loadSubscriptions();
	}

	/**
	 * Render the static signup QR (left panel) pointing at floatplane.com.
	 * Runs once - idempotent thereafter.
	 */
	function _renderSignupQr() {
		var host = document.getElementById("signup-qr");
		if (!host) return;
		if (host.dataset.done) return;
		host.dataset.done = "1";
		try {
			var q = qrcode(0, "M");
			q.addData("https://www.floatplane.com");
			q.make();
			var svg = q.createSvgTag(8, 0);
			if (svg && svg.length > 0) host.innerHTML = svg;
		} catch (e) {}
	}

	AppCtx.views.login = {
		startLogin: startLogin,
		onLoginSuccess: onLoginSuccess,
	};
})();
