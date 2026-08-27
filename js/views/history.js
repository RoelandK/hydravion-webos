/**
 * @fileoverview Watch History view - creator-style grid, 20 per page,
 * lazy-loads more as the user scrolls. Registers into AppCtx.views.history.
 */
(() => {
	/** @private {number} Next fetch offset */
	var _offset = 0;
	/** @private {boolean} Fetch in flight or exhausted */
	var _loading = false;
	/** @private {boolean} All pages loaded */
	var _done = false;

	/**
	 * Format a watched timestamp as Today / Yesterday / date.
	 * @param {string|number} iso ISO date string or ms
	 * @returns {string}
	 */
	function _watchedLabel(iso) {
		if (!iso) return "";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		var now = new Date();
		var startOfToday = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		).getTime();
		var startOfDay = new Date(
			d.getFullYear(),
			d.getMonth(),
			d.getDate(),
		).getTime();
		var daysAgo = Math.round((startOfToday - startOfDay) / 86400000);
		if (daysAgo === 0) return "Watched today";
		if (daysAgo === 1) return "Watched yesterday";
		return (
			"Watched " +
			d.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			})
		);
	}

	/**
	 * Show the watch history grid. First page renders immediately; more
	 * pages append as the scroll container nears the bottom.
	 */
	function showHistory() {
		AppCtx.util._show("view-history");
		AppCtx.state._focusCacheView = null;
		_offset = 0;
		_loading = false;
		_done = false;
		var container = document.getElementById("history-content");
		if (!container) return;
		container.innerHTML =
			'<div class="video-grid" id="history-grid"></div>' +
			'<div id="history-loader" style="padding:40px;text-align:center;color:#666">Loading history...</div>';
		var grid = document.getElementById("history-grid");
		if (!grid) return;
		_appendPage(container, grid);
	}

	/**
	 * Fetch one page of history and append creator-style grid cards.
	 * @param {HTMLElement} container
	 * @param {HTMLElement} grid
	 */
	function _appendPage(container, grid) {
		if (_loading || _done) return;
		_loading = true;
		var loader = document.getElementById("history-loader");
		if (loader) loader.style.display = "block";
		FloatplaneAPI.getHistory(_offset)
			.then((entries) => {
				_loading = false;
				var arr = Array.isArray(entries) ? entries : [];
				if (loader) {
					// 20 per page from the API - hide the spinner after the
					// first page if fewer than a full page came back
					if (arr.length < 20) loader.style.display = "none";
				}
				if (!arr.length) {
					_done = true;
					if (loader) loader.style.display = "none";
					if (!grid.children.length) {
						container.innerHTML =
							'<div class="grid-empty">No watch history yet</div>';
					}
					return;
				}
				var before = grid.children.length;
				arr.forEach((entry) => {
					var vid = entry && entry.blogPost;
					if (!vid || !vid.id) return; // guard: some entries have blogPost:{}
					if (!entry.progress || entry.progress <= 0) return; // unwatched
					var card = AppCtx.views.creator._makeGridCard(vid, 400);
					// Prepend the watched date (keeps the like/dislike icons)
					var meta = card.querySelector(".grid-card-meta");
					if (meta) {
						var wSpan = document.createElement("span");
						wSpan.className = "history-watched";
						wSpan.textContent = _watchedLabel(entry.updatedAt);
						meta.insertBefore(wSpan, meta.firstChild);
					}
					// Server progress bar (reuse resume-bar on the thumb)
					var pct = Math.min(100, entry.progress);
					var thumb = card.querySelector(".grid-card-thumb");
					if (thumb && pct > 0) {
						var bar = document.createElement("div");
						bar.className = "resume-bar";
						bar.style.width = pct + "%";
						thumb.appendChild(bar);
					}
					card.addEventListener("click", () => {
						AppCtx.views.details.showDetails(
							vid,
							(vid.creator && vid.creator.id) || "",
						);
					});
					card.addEventListener("keydown", (e) => {
						if (e.keyCode === 13) {
							AppCtx.views.details.showDetails(
								vid,
								(vid.creator && vid.creator.id) || "",
							);
						}
					});
					grid.appendChild(card);
				});
				_offset += arr.length;
				if (arr.length < 20) _done = true;
				// Focus the first card on the initial render
				if (before === 0 && grid.children.length) {
					var first = grid.querySelector(".grid-card");
					if (first) first.focus();
				}
				// If the first page didn't fill the screen, keep loading
				_ensureFill(container, grid);
			})
			.catch(() => {
				_loading = false;
				_done = true;
				if (loader) loader.style.display = "none";
				if (!grid.children.length) {
					container.innerHTML =
						'<div class="grid-empty">Failed to load history</div>';
				}
			});
	}

	/**
	 * Lazy-load: if the grid doesn't yet fill the viewport (tall TV screen),
	 * fetch another page. Also wire a scroll listener for near-bottom loads.
	 * @param {HTMLElement} container
	 * @param {HTMLElement} grid
	 */
	function _ensureFill(container, grid) {
		var view = document.getElementById("view-history");
		if (view && !view._histScrollWired) {
			view._histScrollWired = true;
			view.addEventListener("scroll", () => {
				if (_done || _loading) return;
				// Load when within ~600px of the bottom
				if (view.scrollTop + view.clientHeight > view.scrollHeight - 600) {
					_appendPage(container, grid);
				}
			});
		}
		// Fill the viewport on first render
		if (view && !_done && !_loading) {
			if (view.scrollHeight <= view.clientHeight + 100) {
				_appendPage(container, grid);
			}
		}
	}

	AppCtx.views.history = {
		showHistory: showHistory,
	};
})();
