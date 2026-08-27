/**
 * @fileoverview Account view - sub-menu + read-only pages.
 * Pages: Profile, Notifications, Connected accounts, Security,
 * Billing > Subscriptions, Billing > Invoices. No password reset.
 * Registers into AppCtx.views.account.
 */
(() => {
	/** @private {?Object} Cached user self info */
	var _selfCache = null;
	/** @private {boolean} True when a sub-page is open (not the menu) */
	var _inPage = false;
	/** @private {?string} Page we should focus when returning to the menu */
	var _returnPage = null;

	/**
	 * Show the account sub-menu. Renders the page list; selecting a page
	 * renders it inline (replacing the menu).
	 */
	function showAccount() {
		AppCtx.util._show("view-account");
		AppCtx.state._focusCacheView = null;
		var returning = _inPage; // back-nav from a sub-page
		_inPage = false;
		if (!returning) _returnPage = null; // fresh entry from sidebar
		var container = document.getElementById("account-content");
		if (!container) return;
		container.innerHTML = _menuHtml();
		// innerHTML replaced the nodes - force re-wire + focus
		container._acctWired = false;
		_wireItems(container);
		// Restore focus to the menu item we came back from
		if (_returnPage) {
			var item = container.querySelector(
				'.account-menu-item[data-page="' + _returnPage + '"]',
			);
			_returnPage = null;
			if (item) item.focus();
		}
	}

	/**
	 * Back handler: from a sub-page return to the account menu, else let the
	 * app handle it (navigate away). Called by the app's global Back handler.
	 * @returns {boolean} true if handled here (sub-page was open)
	 */
	function handleBack() {
		if (_inPage) {
			showAccount();
			return true;
		}
		return false;
	}

	/** @returns {string} Sub-menu HTML */
	function _menuHtml() {
		var items = [
			["profile", "Profile"],
			["notifications", "Notifications"],
			["connected", "Connected accounts"],
			["security", "Security"],
			["subs", "Billing - Subscriptions"],
			["invoices", "Billing - Invoices"],
		];
		var html = '<div class="account-menu">';
		for (var i = 0; i < items.length; i++) {
			html +=
				'<button class="account-menu-item" tabindex="0" data-page="' +
				items[i][0] +
				'">' +
				items[i][1] +
				"</button>";
		}
		html += "</div>";
		return html;
	}

	// Wire menu items + back buttons directly (no document-level delegation,
	// which fights the app's universal Enter handling). Up/Down navigation is
	// handled by the app's spatial nav; Enter/click here just opens the page.
	function _wireItems(container) {
		if (!container || container._acctWired) return;
		container._acctWired = true;
		// Use function + this, NOT arrows over loop vars (classic closure bug)
		var items = container.querySelectorAll(".account-menu-item");
		for (var i = 0; i < items.length; i++) {
			items[i].addEventListener("click", function () {
				openPage(this.getAttribute("data-page"));
			});
		}
		var backs = container.querySelectorAll(".account-back");
		for (var bi = 0; bi < backs.length; bi++) {
			backs[bi].addEventListener("click", () => {
				showAccount();
			});
		}
		// Focus first item after wiring
		var first = container.querySelector("[tabindex='0']");
		if (first) first.focus();
	}

	/**
	 * Ensure user self info is loaded (email, username, displayName).
	 * @returns {Promise<Object>}
	 */
	function _getSelf() {
		if (_selfCache) return Promise.resolve(_selfCache);
		return FloatplaneAPI.getUserSelf()
			.then((d) => {
				_selfCache = d || {};
				return _selfCache;
			})
			.catch(() => {
				_selfCache = {};
				return _selfCache;
			});
	}

	/** @param {string} page Page id from the menu */
	function openPage(page) {
		_inPage = true;
		_returnPage = page;
		var container = document.getElementById("account-content");
		if (!container) return;
		container.innerHTML =
			'<div id="account-page-loader" style="padding:40px;text-align:center;color:#666">Loading...</div>';
		_getSelf().then((self) => {
			// Invoices are async - render skeleton, then fill the card in place
			var render = () => {
				var back = container.querySelector(".account-back");
				container._acctWired = false;
				_wireItems(container);
				if (back) back.focus();
			};
			if (page === "invoices") {
				container.innerHTML = _pageInvoices();
				render();
				_fillInvoices(container);
				return;
			}
			switch (page) {
				case "profile":
					container.innerHTML = _pageProfile(self);
					break;
				case "notifications":
					container.innerHTML = _pageNotifications();
					break;
				case "connected":
					container.innerHTML = _pageConnected(self);
					break;
				case "security":
					container.innerHTML = _pageSecurity(self);
					break;
				case "subs":
					container.innerHTML = _pageSubscriptions();
					break;
			}
			render();
		});
	}

	/** @returns {string} Back link HTML (shared) */
	function _backHtml() {
		return '<button class="account-back" tabindex="0">← Back</button>';
	}

	/** @param {Object} self @returns {string} */
	function _pageProfile(self) {
		var img =
			self.profileImage && self.profileImage.path
				? '<img class="account-avatar" src="' +
					self.profileImage.path +
					'" decoding="async">'
				: '<span class="account-avatar">' +
					(self.username || "?").charAt(0).toUpperCase() +
					"</span>";
		return (
			_backHtml() +
			'<div class="account-card">' +
			'<h3 class="account-h">Profile</h3>' +
			img +
			'<div class="account-row"><span class="account-label">Username</span><span class="account-value">' +
			(self.username || "-") +
			"</span></div>" +
			'<div class="account-row"><span class="account-label">Display name</span><span class="account-value">' +
			(self.displayName || "-") +
			"</span></div>" +
			'<div class="account-row"><span class="account-label">Email</span><span class="account-value">' +
			(self.email || "-") +
			"</span></div>" +
			"</div>"
		);
	}

	/** @returns {string} */
	function _pageNotifications() {
		var html =
			_backHtml() +
			'<div class="account-card"><h3 class="account-h">Notifications</h3>' +
			'<div class="account-note" id="notif-loading">Loading...</div></div>';
		FloatplaneAPI.getChannelNotifications()
			.then((resp) => {
				var card = document.querySelector("#account-content .account-card");
				if (!card) return;
				// Keep a working copy of the full settings for updates
				var settings =
					resp && Array.isArray(resp.settings) ? resp.settings : [];
				var emailOn = !!(resp && resp.emailNotificationsEnabled);
				var emailRow =
					'<div class="account-row"><span class="account-label">Email notifications</span>' +
					'<button class="account-toggle' +
					(emailOn ? "" : " off") +
					'" data-email="1" tabindex="0">' +
					(emailOn ? "On" : "Off") +
					"</button></div>";
				card.innerHTML = '<h3 class="account-h">Notifications</h3>' + emailRow;
				if (!settings.length) {
					card.innerHTML +=
						'<div class="account-note">No per-creator notification settings.</div>';
					return;
				}
				// Render each creator + its channels as toggle rows
				settings.forEach((s) => {
					var creator = (s && s.creator) || {};
					var cid = creator.id || (typeof creator === "string" ? creator : "");
					var info = cid ? AppCtx.state.CREATOR_INFO[cid] || {} : {};
					var title = info.title || creator.title || cid || "Creator";
					card.innerHTML +=
						'<div class="account-row account-creator"><span class="account-label">' +
						title +
						"</span></div>";
					var chans = Array.isArray(s.channels) ? s.channels : [];
					chans.forEach((cs, ci) => {
						var ch = cs && cs.channel;
						// Resolve channel info: the notification payload may only
						// carry an id; match it against the creator's channel list.
						var chId = typeof ch === "string" ? ch : ch && (ch.id || ch._id);
						var chInfo = null;
						if (ch && (ch.title || ch.name)) chInfo = ch;
						else if (chId && Array.isArray(info.channels)) {
							for (var chi2 = 0; chi2 < info.channels.length; chi2++) {
								if (info.channels[chi2].id === chId) {
									chInfo = info.channels[chi2];
									break;
								}
							}
						}
						var chTitle = (chInfo && (chInfo.title || chInfo.name)) || "";
						if (!chTitle && typeof cs === "string") chTitle = cs;
						var chIcon =
							chInfo && chInfo.icon && chInfo.icon.path ? chInfo.icon.path : "";
						var enabled = cs.enabled !== false;
						var btn =
							'<button class="account-toggle' +
							(enabled ? "" : " off") +
							'" data-creator-idx="' +
							settings.indexOf(s) +
							'" data-chan-idx="' +
							ci +
							'" tabindex="0">' +
							(enabled ? "On" : "Off") +
							"</button>";
						card.innerHTML +=
							'<div class="account-row account-chan"><span class="account-label">' +
							(chIcon
								? '<img class="account-c-icon" src="' +
									chIcon +
									'" decoding="async"> '
								: "") +
							(chTitle || "Channel") +
							'</span><span class="account-value">' +
							btn +
							"</span></div>";
					});
				});
				// Toggle handlers (delegated via card click, direct Enter)
				card.addEventListener("click", (e) => {
					var t = e.target.closest ? e.target.closest(".account-toggle") : null;
					if (!t) return;
					if (t.hasAttribute("data-email")) {
						emailOn = !emailOn;
						t.textContent = emailOn ? "On" : "Off";
						t.classList.toggle("off", !emailOn);
						_saveNotifSettings(settings, emailOn);
						return;
					}
					var si = parseInt(t.getAttribute("data-creator-idx"), 10);
					var ci = parseInt(t.getAttribute("data-chan-idx"), 10);
					var s = settings[si];
					if (!s || !s.channels || !s.channels[ci]) return;
					s.channels[ci].enabled = s.channels[ci].enabled === false;
					var on = s.channels[ci].enabled;
					t.textContent = on ? "On" : "Off";
					t.classList.toggle("off", !on);
					_saveNotifSettings(settings, emailOn);
				});
				card.addEventListener("keydown", (e) => {
					if (e.keyCode !== 13) return;
					var t = document.activeElement;
					if (!t || !t.classList || !t.classList.contains("account-toggle"))
						return;
					e.preventDefault();
					t.click();
				});
			})
			.catch(() => {
				var card = document.querySelector("#account-content .account-card");
				if (card)
					card.innerHTML +=
						'<div class="account-note">Failed to load notification settings.</div>';
			});
		return html;
	}

	/**
	 * Push updated notification settings to the server (full replacement).
	 * @param {Array<Object>} settings
	 * @param {boolean} emailOn
	 */
	function _saveNotifSettings(settings, emailOn) {
		// The update endpoint takes a FLAT list: settings: [{channel: <id>, enabled}].
		// Flatten each creator's channels into one entry per channel.
		var out = [];
		(settings || []).forEach((s) => {
			(s.channels || []).forEach((cs) => {
				var ch = cs && cs.channel;
				var chId = typeof ch === "string" ? ch : ch && (ch.id || ch._id);
				if (!chId) return;
				out.push({
					channel: chId,
					enabled: cs.enabled !== false,
				});
			});
		});
		FloatplaneAPI.updateChannelNotifications({
			settings: out,
			emailNotificationsEnabled: !!emailOn,
		})
			.then((resp) => {
				console.log(
					"[NOTIF-SAVE] ok: " + JSON.stringify(resp).substring(0, 300),
				);
			})
			.catch((err) => {
				console.warn(
					"[NOTIF-SAVE] FAILED. sent=" +
						JSON.stringify({
							settings: out,
							emailNotificationsEnabled: !!emailOn,
						}).substring(0, 800),
				);
				console.warn(
					"[NOTIF-SAVE] error: " +
						(err && (err.text || err.message || err.error)),
				);
				AppCtx.util._toast("Failed to save notification settings");
			});
	}
	/** @param {Object} self @returns {string} */
	function _pageConnected(self) {
		var html =
			_backHtml() +
			'<div class="account-card"><h3 class="account-h">Connected accounts</h3>' +
			'<div class="account-note" id="connected-loading">Loading...</div></div>';
		FloatplaneAPI.getConnections()
			.then((accounts) => {
				var card = document.querySelector("#account-content .account-card");
				if (!card) return;
				var arr = Array.isArray(accounts) ? accounts : [];
				if (!arr.length) {
					card.innerHTML =
						'<h3 class="account-h">Connected accounts</h3>' +
						'<div class="account-note">No connection options found.</div>';
					return;
				}
				var rows = "";
				arr.forEach((a) => {
					// connect/list items: { key, name, iconWhite, connected,
					//   connectedAccount: { remoteUserName, ... } | null }
					var site = a.name || a.key || "Account";
					var isConnected = a.connected && a.connectedAccount;
					var user =
						(a.connectedAccount && a.connectedAccount.remoteUserName) || "";
					var icon = a.iconWhite || "";
					if (icon && icon.indexOf("http") !== 0)
						icon = "https://www.floatplane.com" + icon;
					rows +=
						'<div class="account-row"><span class="account-label">' +
						(icon
							? '<img class="account-c-icon" src="' +
								icon +
								'" decoding="async"> '
							: "") +
						site +
						'</span><span class="account-value">' +
						(isConnected ? user : "Not connected") +
						"</span></div>";
				});
				card.innerHTML = '<h3 class="account-h">Connected accounts</h3>' + rows;
			})
			.catch(() => {
				var card = document.querySelector("#account-content .account-card");
				if (card)
					card.innerHTML =
						'<h3 class="account-h">Connected accounts</h3>' +
						'<div class="account-note">Failed to load connected accounts.</div>';
			});
		return html;
	}
	/** @param {Object} self @returns {string} */
	function _pageSecurity(self) {
		var roles = [];
		if (self.isAdministrator) roles.push("Administrator");
		if (self.isModerator) roles.push("Moderator");
		if (self.isGlobalModerator) roles.push("Global Moderator");
		var html =
			_backHtml() +
			'<div class="account-card"><h3 class="account-h">Security</h3>' +
			'<div class="account-row"><span class="account-label">Email</span><span class="account-value">' +
			(self.email || "-") +
			"</span></div>" +
			'<div class="account-row"><span class="account-label">Account type</span><span class="account-value">' +
			(self.isSpoofed ? "Spoofed" : "Standard") +
			"</span></div>" +
			(roles.length
				? '<div class="account-row"><span class="account-label">Roles</span><span class="account-value">' +
					roles.join(", ") +
					"</span></div>"
				: "") +
			'<div class="account-note">Password changes, two-factor authentication, and backup codes are managed on floatplane.com. Password reset is not available in this app.</div></div>';
		return html;
	}

	/** @returns {string} */
	function _pageSubscriptions() {
		var subs = AppCtx.state.SUBS || [];
		var html =
			_backHtml() +
			'<div class="account-card"><h3 class="account-h">Subscriptions</h3>';
		if (!subs.length) {
			html += '<div class="account-note">No active subscriptions.</div>';
		} else {
			subs.forEach((sub) => {
				var info =
					AppCtx.state.CREATOR_INFO[sub.creator || (sub.plan && sub.plan.id)] ||
					{};
				var iconPath = info.icon && info.icon.path ? info.icon.path : "";
				html +=
					'<div class="account-row"><span class="account-label">' +
					(iconPath
						? '<img class="account-c-icon" src="' +
							iconPath +
							'" decoding="async"> '
						: "") +
					(info.title || sub.creator || "Creator") +
					'</span><span class="account-value">' +
					(sub.plan && sub.plan.title ? sub.plan.title : "Active") +
					"</span></div>";
			});
		}
		html += "</div>";
		return html;
	}

	/** @returns {string} Invoice page skeleton (rows filled async) */
	function _pageInvoices() {
		return (
			_backHtml() +
			'<div class="account-card"><h3 class="account-h">Billing - Invoices</h3>' +
			'<div class="account-note" id="invoice-loading">Loading...</div></div>'
		);
	}
	/**
	 * Fetch invoices and fill the card, using the container reference passed
	 * at render time (avoids re-querying the live DOM, which can be stale).
	 * Invoice: { id, date, amountDue, amountTax, amountNet, currency, paid,
	 *           refunded, forgiven, subscriptions: [{ periodStart, periodEnd,
	 *           value, amountTotal, amountSubtotal, amountTax, plan: { title } }] }
	 * Amounts are in dollars (not cents).
	 * @param {HTMLElement} container #account-content
	 */
	function _fillInvoices(container) {
		FloatplaneAPI.getInvoices()
			.then((resp) => {
				if (!container || !container.isConnected) return; // navigated away
				var card = container.querySelector(".account-card");
				if (!card) return;
				var list =
					resp && Array.isArray(resp.invoices)
						? resp.invoices
						: Array.isArray(resp)
							? resp
							: [];
				if (!list.length) {
					card.innerHTML =
						'<h3 class="account-h">Billing - Invoices</h3>' +
						'<div class="account-note">No invoices found.</div>';
					return;
				}
				// Newest first (by date, then id)
				list.sort((a, b) => {
					var ta = a && a.date ? new Date(a.date).getTime() : 0;
					var tb = b && b.date ? new Date(b.date).getTime() : 0;
					if (tb !== ta) return tb - ta;
					return String(b && b.id).localeCompare(String(a && a.id));
				});
				var rows = "";
				var _money = (v, cur) =>
					(v !== undefined ? Number(v).toFixed(2) : "0.00") +
					" " +
					(cur || "USD");
				list.forEach((inv) => {
					var cur = inv.currency || "USD";
					var date = inv.date
						? new Date(inv.date).toLocaleDateString("en-US", {
								month: "short",
								day: "numeric",
								year: "numeric",
							})
						: "";
					var status = inv.paid
						? "Paid"
						: inv.refunded
							? "Refunded"
							: inv.forgiven
								? "Forgiven"
								: inv.status
									? inv.status
									: "Due";
					// Invoice header line: Invoice <id> - <date> - <amount> - <status>
					rows +=
						'<div class="account-row inv-head"><span class="account-label">Invoice ' +
						(inv.id || inv.paymentProcessorInvoiceId || "-") +
						" - " +
						date +
						'</span><span class="account-value">' +
						_money(inv.amountDue, cur) +
						" - " +
						status +
						"</span></div>";
					// One line per subscription: plan title + period + amounts
					var subs = Array.isArray(inv.subscriptions) ? inv.subscriptions : [];
					if (!subs.length) {
						rows +=
							'<div class="account-note inv-sub">Amount ' +
							_money(inv.amountDue, cur) +
							" · Subtotal " +
							_money(
								inv.amountNet !== undefined ? inv.amountNet : inv.amountDue,
								cur,
							) +
							" · Taxes " +
							_money(inv.amountTax, cur) +
							"</div>";
					} else {
						subs.forEach((s) => {
							var plan =
								(s.plan && (s.plan.title || s.plan.name)) ||
								(s.subscription && s.subscription.title) ||
								"Subscription";
							var ps = s.periodStart
								? new Date(s.periodStart).toLocaleDateString("en-US", {
										month: "short",
										day: "numeric",
										year: "numeric",
									})
								: "";
							var pe = s.periodEnd
								? new Date(s.periodEnd).toLocaleDateString("en-US", {
										month: "short",
										day: "numeric",
										year: "numeric",
									})
								: "";
							rows +=
								'<div class="account-row inv-sub"><span class="account-label">' +
								plan +
								(ps && pe ? " - " + ps + " - " + pe : "") +
								'</span><span class="account-value">Amount ' +
								_money(
									s.amountTotal !== undefined ? s.amountTotal : s.value,
									cur,
								) +
								"</span></div>";
						});
					}
				});
				card.innerHTML = '<h3 class="account-h">Billing - Invoices</h3>' + rows;
			})
			.catch(() => {
				if (!container || !container.isConnected) return;
				var card = container.querySelector(".account-card");
				if (card)
					card.innerHTML =
						'<h3 class="account-h">Billing - Invoices</h3>' +
						'<div class="account-note">Failed to load invoices.</div>';
			});
	}
	AppCtx.views.account = {
		showAccount: showAccount,
		openPage: openPage,
		handleBack: handleBack,
	};
})();
