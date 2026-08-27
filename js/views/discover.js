/**
 * @fileoverview Discover view - browse ALL creators (not just subscriptions).
 * Grid of creator cards with icon/title/subscriber count, category filter
 * chips, free-text search, and skip-based lazy pagination.
 * Registers into AppCtx.views.discover.
 */
(() => {
	/** @private {number} Next fetch offset */
	var _skip = 0;
	/** @private {boolean} Fetch in flight or exhausted */
	var _loading = false;
	/** @private {boolean} All pages loaded */
	var _done = false;
	/** @private {?string} Active category filter (id) */
	var _category = null;
	/** @private {string} Active search text */
	var _search = "";

	/** Show the discover grid. */
	function showDiscover() {
		AppCtx.util._show("view-discover");
		AppCtx.state._focusCacheView = null;
		_skip = 0;
		_loading = false;
		_done = false;
		var container = document.getElementById("discover-content");
		if (!container) return;
		container.innerHTML =
			'<div id="discover-search-row">' +
			'<input id="discover-search" type="text" placeholder="Search creators..." ' +
			'aria-label="Search creators">' +
			'<button id="discover-search-clear" aria-label="Clear search">✕</button>' +
			"</div>" +
			'<div id="discover-cats"></div>' +
			'<div class="creator-grid" id="discover-grid"></div>' +
			'<div id="discover-loader" style="padding:40px;text-align:center;color:#666">' +
			"Loading creators...</div>";
		_loadCategories();
		_appendPage(container);
		_wireSearch();
	}

	/** Load category filter chips. */
	function _loadCategories() {
		FloatplaneAPI.getCreatorCategories()
			.then((cats) => {
				var host = document.getElementById("discover-cats");
				if (!host) return;
				var arr = Array.isArray(cats) ? cats : [];
				var html =
					'<button class="pill pill-active" data-cat="" tabindex="0">All</button>';
				arr.forEach((c) => {
					html +=
						'<button class="pill" data-cat="' +
						c.id +
						'" tabindex="0">' +
						(c.title || "Category") +
						"</button>";
				});
				host.innerHTML = html;
				host.addEventListener("click", (e) => {
					var b = e.target.closest ? e.target.closest(".pill") : null;
					if (!b) return;
					var prev = _category;
					_category = b.getAttribute("data-cat") || null;
					if (_category === prev) return;
					var pills = host.querySelectorAll(".pill");
					for (var i = 0; i < pills.length; i++)
						pills[i].classList.toggle("pill-active", pills[i] === b);
					_reload();
				});
			})
			.catch(() => {});
	}

	/** Debounced search input. */
	function _wireSearch() {
		var input = document.getElementById("discover-search");
		if (!input) return;
		var clear = document.getElementById("discover-search-clear");
		if (clear)
			clear.addEventListener("click", () => {
				input.value = "";
				_search = "";
				_reload();
				input.focus();
			});
		var t = null;
		input.addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(() => {
				_search = input.value.trim();
				_reload();
			}, 400);
		});
	}

	/** Reset and fetch page 1. */
	function _reload() {
		var container = document.getElementById("discover-content");
		if (!container) return;
		_skip = 0;
		_done = false;
		_loading = false;
		var grid = document.getElementById("discover-grid");
		if (grid) grid.innerHTML = "";
		var loader = document.getElementById("discover-loader");
		if (loader) loader.style.display = "block";
		_appendPage(container);
	}

	/**
	 * Fetch one page of discover creators and append cards.
	 * @param {HTMLElement} container
	 */
	function _appendPage(container) {
		if (_loading || _done) return;
		_loading = true;
		var loader = document.getElementById("discover-loader");
		if (loader) loader.style.display = "block";
		FloatplaneAPI.getDiscoverCreators({
			searchField: _search || undefined,
			categories: _category ? [_category] : undefined,
			skip: _skip,
			limit: 20,
			creatorStats: true,
			featuredBlogPosts: 1,
		})
			.then((resp) => {
				_loading = false;
				var creators =
					resp && Array.isArray(resp.creators) ? resp.creators : [];
				if (loader) loader.style.display = "none";
				if (!creators.length) {
					_done = true;
					var grid0 = document.getElementById("discover-grid");
					if (grid0 && !grid0.children.length) {
						container.innerHTML +=
							'<div class="grid-empty">No creators found</div>';
					}
					return;
				}
				var grid = document.getElementById("discover-grid");
				if (grid) {
					creators.forEach((c) => {
						grid.appendChild(_creatorCard(c));
					});
				}
				_skip += creators.length;
				if (resp && resp.hasMore === false) _done = true;
				_ensureFill(container);
			})
			.catch(() => {
				_loading = false;
				_done = true;
				if (loader) loader.style.display = "none";
			});
	}

	/** @param {Object} c CreatorDiscoverInfo @returns {HTMLElement} */
	function _creatorCard(c) {
		var card = document.createElement("div");
		card.className = "creator-card";
		card.setAttribute("tabindex", "0");
		var icon = c.icon ? AppCtx.util._thumb(c.icon, 200) : "";
		var subs = c.stats && c.stats.subscribers;
		var posts = c.stats && c.stats.posts;
		var chans = c.stats && c.stats.channels ? c.stats.channels.length : 0;
		var catTitle = c.category && c.category.title ? c.category.title : "";
		card.innerHTML =
			'<div class="creator-card-top">' +
			(icon
				? '<img class="creator-card-icon" src="' + icon + '" decoding="async">'
				: '<span class="creator-card-icon">' +
					(c.title || "?").charAt(0).toUpperCase() +
					"</span>") +
			"</div>" +
			'<div class="creator-card-title">' +
			(c.title || "Creator") +
			"</div>" +
			'<div class="creator-card-meta">' +
			(subs !== undefined ? subs.toLocaleString() + " subs" : "") +
			(subs !== undefined && posts !== undefined ? " · " : "") +
			(posts !== undefined ? posts + " posts" : "") +
			(chans ? " · " + chans + " channels" : "") +
			(catTitle ? " · " + catTitle : "") +
			"</div>" +
			(c.description
				? '<div class="creator-card-desc">' +
					c.description.substring(0, 120) +
					"</div>"
				: "");
		card.addEventListener("click", () => {
			if (c.id) {
				showDetail(c.id);
			}
		});
		card.addEventListener("keydown", (e) => {
			if (e.keyCode === 13 && c.id) showDetail(c.id);
		});
		return card;
	}

	/**
	 * Open the discover detail view: creator info, subchannels, subscription
	 * plans with their included features. Subscribe prompts via floatplane.com.
	 * @param {string} creatorId
	 */
	function showDetail(creatorId) {
		AppCtx.util._show("view-discover-detail");
		AppCtx.state._focusCacheView = null;
		var container = document.getElementById("discover-detail-content");
		if (!container) return;
		container.innerHTML =
			'<div id="discover-detail-loader" style="padding:60px;text-align:center;color:#666">Loading creator...</div>';
		FloatplaneAPI.getCreatorInfo(creatorId)
			.then((info) => {
				container.innerHTML = _detailHtml(info, creatorId);
				var first = container.querySelector("[tabindex='0']");
				if (first) first.focus();
			})
			.catch(() => {
				container.innerHTML =
					'<div class="grid-empty">Failed to load creator</div>';
			});
	}

	/** @param {Object} info @param {string} creatorId @returns {string} */
	function _detailHtml(info, creatorId) {
		if (!info) info = {};
		var iconPath = info.icon && info.icon.path ? info.icon.path : "";
		var name = info.title || "Creator";
		var channels = Array.isArray(info.channels) ? info.channels : [];
		var plans = Array.isArray(info.subscriptionPlans)
			? info.subscriptionPlans.filter((p) => p && p.published !== false)
			: [];
		var html =
			'<button class="account-back" tabindex="0">← Back</button>' +
			'<div class="discover-detail-hero">' +
			(iconPath
				? '<img class="discover-detail-icon" src="' +
					iconPath +
					'" decoding="async">'
				: '<span class="discover-detail-icon">' +
					name.charAt(0).toUpperCase() +
					"</span>") +
			'<div class="discover-detail-name">' +
			name +
			"</div>" +
			(info.description
				? '<div class="discover-detail-desc">' + info.description + "</div>"
				: "") +
			"</div>";
		// Subchannels
		if (channels.length) {
			html += '<div class="discover-detail-section"><h3>Channels</h3>';
			channels.forEach((ch) => {
				var chIcon = ch.icon && ch.icon.path ? ch.icon.path : "";
				html +=
					'<div class="discover-detail-channel"><span class="account-label">' +
					(chIcon
						? '<img class="account-c-icon" src="' +
							chIcon +
							'" decoding="async"> '
						: "") +
					(ch.title || "Channel") +
					'</span><span class="account-value">' +
					(ch.about ? ch.about.substring(0, 80) : "") +
					"</span></div>";
			});
			html += "</div>";
		} else {
			html +=
				'<div class="discover-detail-section"><h3>Channels</h3>' +
				'<div class="account-note">No channels listed.</div></div>';
		}
		// Subscription plans
		html += '<div class="discover-detail-section"><h3>Subscription plans</h3>';
		if (!plans.length) {
			html +=
				'<div class="account-note">No subscription plans available.</div>';
		} else {
			plans.forEach((p) => {
				var price = p.price !== undefined ? "$" + p.price : "";
				var priceY = p.priceYearly !== undefined ? "$" + p.priceYearly : "";
				var interval = p.interval || "";
				html +=
					'<div class="plan-card" tabindex="0">' +
					'<div class="plan-title">' +
					(p.title || "Plan") +
					"</div>" +
					'<div class="plan-price">' +
					price +
					(interval === "yearly" ? "/year" : "/month") +
					(priceY ? " · " + priceY + "/yr" : "") +
					"</div>" +
					(p.description
						? '<div class="plan-desc">' +
							p.description.substring(0, 200) +
							"</div>"
						: "") +
					'<button class="plan-sub-btn" data-subscribe="' +
					creatorId +
					'" tabindex="0">Subscribe</button>' +
					"</div>";
			});
		}
		html += "</div>";
		return html;
	}

	/**
	 * Show a modal explaining subscriptions are handled on floatplane.com.
	 * @param {string} creatorId
	 */
	function showSubscribeOverlay(creatorId) {
		var overlay = document.getElementById("discover-sub-overlay");
		if (!overlay) {
			overlay = document.createElement("div");
			overlay.id = "discover-sub-overlay";
			overlay.className = "discover-sub-overlay";
			overlay.innerHTML =
				'<div class="discover-sub-dialog">' +
				"<h3>Subscribe</h3>" +
				"<p>Subscriptions are managed on the Floatplane website. " +
				"Open floatplane.com to subscribe to this creator.</p>" +
				'<button id="discover-sub-close" class="plan-sub-btn" tabindex="0">Close</button>' +
				"</div>";
			document.body.appendChild(overlay);
			document
				.getElementById("discover-sub-close")
				.addEventListener("click", closeSubscribeOverlay);
			document.addEventListener("keydown", (e) => {
				if (e.keyCode === 461 && !overlay.classList.contains("hidden"))
					closeSubscribeOverlay(); // Back
			});
		}
		overlay.classList.remove("hidden");
		var close = overlay.querySelector("#discover-sub-close");
		if (close) close.focus();
	}

	/** Close the subscribe modal. */
	function closeSubscribeOverlay() {
		var overlay = document.getElementById("discover-sub-overlay");
		if (overlay) overlay.classList.add("hidden");
	}

	/** Lazy-load: fetch more when near the bottom. */
	function _ensureFill(container) {
		var view = document.getElementById("view-discover");
		if (view && !view._discScrollWired) {
			view._discScrollWired = true;
			view.addEventListener("scroll", () => {
				if (_done || _loading) return;
				if (view.scrollTop + view.clientHeight > view.scrollHeight - 600) {
					_appendPage(container);
				}
			});
		}
		if (view && !_done && !_loading) {
			if (view.scrollHeight <= view.clientHeight + 100) {
				_appendPage(container);
			}
		}
	}

	// Detail view: back button + subscribe buttons (delegated once).
	(function _wireDetail() {
		document.addEventListener("click", (e) => {
			var back =
				e.target && e.target.closest
					? e.target.closest("#discover-detail-content .account-back")
					: null;
			if (back) {
				showDiscover();
				return;
			}
			var sub =
				e.target && e.target.closest
					? e.target.closest("#discover-detail-content [data-subscribe]")
					: null;
			if (sub) {
				showSubscribeOverlay(sub.getAttribute("data-subscribe"));
				return;
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.keyCode !== 13) return;
			var el = document.activeElement;
			if (!el || !el.closest) return;
			var back =
				el.closest("#discover-detail-content .account-back") ||
				el.closest("#discover-sub-close");
			if (back) {
				e.preventDefault();
				if (el.id === "discover-sub-close") closeSubscribeOverlay();
				else showDiscover();
				return;
			}
			var sub = el.closest("#discover-detail-content [data-subscribe]");
			if (sub) {
				e.preventDefault();
				showSubscribeOverlay(sub.getAttribute("data-subscribe"));
			}
		});
	})();

	AppCtx.views.discover = {
		showDiscover: showDiscover,
		showDetail: showDetail,
		showSubscribeOverlay: showSubscribeOverlay,
		closeSubscribeOverlay: closeSubscribeOverlay,
	};
})();
