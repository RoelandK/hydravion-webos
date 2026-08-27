/**
 * @fileoverview Watch Later view - local list of saved videos (app-only,
 * not on floatplane.com). Cards open the creator's detail page.
 * Registers into AppCtx.views.watchlater.
 */
(() => {
	/** @private {Array<HTMLElement>} Accumulated cards between HTML + DOM pass */
	var _tmpCards = [];

	/** @private {?number} Clear-all confirm re-arm timer */
	var _armTimer = null;

	/** Wire the header clear-all button (static HTML, runs once at load). */
	function _wireClearAll() {
		var btn = document.getElementById("wl-clear-all");
		if (!btn) return;
		btn.addEventListener("click", () => {
			if (btn.dataset.armed) {
				FloatplaneAPI.clearWatchLater();
				var container = document.getElementById("watchlater-content");
				if (container) {
					container.innerHTML =
						'<div class="no-comments" style="padding:30px 40px 10px;text-align:center">' +
						"No videos saved yet - maybe you want to re-watch something?" +
						'</div><div class="wl-suggest-title">From your watch history</div>' +
						'<div class="grid-cards" id="wl-suggest"></div>';
					_showHistorySuggestions(container);
				}
				btn.dataset.armed = "";
				btn.textContent = "✕ Clear all";
				return;
			}
			btn.dataset.armed = "1";
			btn.textContent = "✕ Confirm?";
			if (_armTimer) clearTimeout(_armTimer);
			_armTimer = setTimeout(() => {
				btn.dataset.armed = "";
				btn.textContent = "✕ Clear all";
			}, 3000);
		});
	}

	/** Show the watch-later grid. */
	function showWatchLater() {
		AppCtx.util._show("view-watchlater");
		AppCtx.state._focusCacheView = null;
		var container = document.getElementById("watchlater-content");
		if (!container) return;
		var items = FloatplaneAPI.getWatchLater();
		if (!items.length) {
			container.innerHTML =
				'<div class="no-comments" style="padding:30px 40px 10px;text-align:center">' +
				"No videos saved yet - maybe you want to re-watch something?" +
				'</div><div class="wl-suggest-title">From your watch history</div>' +
				'<div class="grid-cards" id="wl-suggest"></div>';
			_showHistorySuggestions(container);
			return;
		}
		var html = '<div class="grid-cards">';
		for (var i = 0; i < items.length; i++) {
			var it = items[i];
			// Rebuild the stored item into the full video-card shape so we can
			// reuse _makeVideoCard (standard 320px card: thumb, title, date
			// footer, likes) instead of a hand-rolled taller variant.
			var vid = {
				id: it.id,
				guid: it.id,
				title: it.title || "Untitled",
				thumbnail: {
					path: it.thumb || "",
					childImages: it.thumbSmall || [],
				},
				creatorId: it.creatorId || null,
				creatorTitle: it.creatorTitle || "",
				creator: it.creatorId
					? { id: it.creatorId, title: it.creatorTitle || "" }
					: null,
				releaseDate: it.releaseDate || "",
				likes: it.likes,
				dislikes: it.dislikes,
				metadata: it.duration ? { videoDuration: it.duration } : {},
			};
			// Bypass the card's own click handler (it opens details with the
			// wrong creator context) - the container delegate below navigates.
			vid._wlCard = true;
			var card = AppCtx.util._makeVideoCard(
				vid,
				it.creatorId || "",
				"watchlater",
				0,
				i,
			);
			card.classList.add("wl-card");
			card.setAttribute("data-id", it.id);
			card.setAttribute("data-creator", it.creatorId || "");
			card.setAttribute("role", "button");
			var remove = document.createElement("button");
			remove.className = "wl-remove";
			remove.tabIndex = "0";
			remove.setAttribute("aria-label", "Remove");
			remove.textContent = "✕";
			card.appendChild(remove);
			_tmpCards.push(card);
		}
		container.innerHTML = html;
		var _grid = container.querySelector(".grid-cards");
		for (var gi = 0; gi < _tmpCards.length; gi++)
			_grid.appendChild(_tmpCards[gi]);
		_tmpCards.length = 0;
		// Card click → open details (delegated so removal clicks don't fight)
		container.onclick = (e) => {
			var card = e.target.closest(".wl-card");
			if (!card) return;
			if (e.target.closest(".wl-remove")) {
				FloatplaneAPI.removeFromWatchLater(card.getAttribute("data-id"));
				card.parentNode.removeChild(card);
				if (!container.querySelector(".wl-card")) {
					container.innerHTML =
						'<div class="no-comments" style="padding:40px;text-align:center">No saved videos yet.</div>';
				}
				return;
			}
			_openSaved(
				card.getAttribute("data-id"),
				card.getAttribute("data-creator"),
			);
		};
		// Enter on a card opens it too (cards are divs, not buttons)
		container.onkeydown = (e) => {
			if (e.keyCode !== 13) return;
			var card = e.target.closest(".wl-card");
			if (!card) return;
			if (e.target.classList.contains("wl-remove")) return; // remove button handles itself
			e.preventDefault();
			_openSaved(
				card.getAttribute("data-id"),
				card.getAttribute("data-creator"),
			);
		};
		var first = container.querySelector(".wl-card");
		if (first) {
			setTimeout(() => first.focus(), 50);
		}
		// Old entries saved before releaseDate/duration were stored lack the
		// date - fetch post info and patch them in place (best-effort).
		_backfillMissing(container);
	}

	/**
	 * For saved items missing releaseDate, fetch the post info and update
	 * the localStorage entry so the card footer shows the release date.
	 * @param {HTMLElement} container
	 */
	function _backfillMissing(container) {
		var items = FloatplaneAPI.getWatchLater();
		var missing = [];
		for (var bi = 0; bi < items.length; bi++) {
			if (!items[bi].releaseDate) missing.push(items[bi].id);
		}
		if (!missing.length) return;
		var _queue = missing.slice();
		var _next = () => {
			if (!_queue.length) return;
			var id = _queue.shift();
			FloatplaneAPI.getPostInfo(id)
				.then((post) => {
					if (!post) return;
					var list = FloatplaneAPI.getWatchLater();
					for (var li = 0; li < list.length; li++) {
						if (list[li].id === id) {
							list[li].releaseDate = post.releaseDate || list[li].releaseDate;
							list[li].likes = post.likes != null ? post.likes : list[li].likes;
							list[li].dislikes =
								post.dislikes != null ? post.dislikes : list[li].dislikes;
							if (post.metadata && post.metadata.videoDuration)
								list[li].duration = post.metadata.videoDuration;
							break;
						}
					}
					try {
						localStorage.setItem("fp_watch_later", JSON.stringify(list));
					} catch (e) {}
					// Patch the rendered card's footer in place (no full re-render)
					var card = container.querySelector('.wl-card[data-id="' + id + '"]');
					if (card) {
						var footer = card.querySelector(".card-footer");
						if (footer) {
							var dateText = AppCtx.util._fmtDate(post.releaseDate);
							if (dateText) {
								var dateSpan = document.createElement("span");
								dateSpan.textContent = dateText;
								footer.insertBefore(dateSpan, footer.firstChild);
							}
							// Replace "null" like/dislike text if present
							var like = card.querySelector(".card-like");
							if (like) {
								var likeVal = post.likes != null ? post.likes : "";
								var likeSpan = like.querySelector("span");
								if (likeSpan && likeSpan.textContent === "null")
									likeSpan.textContent = likeVal;
							}
						}
					}
				})
				.catch(() => {})
				.finally(_next);
		};
		_next();
	}

	/**
	 * Empty state: suggest 4-5 random videos from the user's watch history
	 * ("maybe you want to re-watch?"). Best-effort - silent on failure.
	 * @param {HTMLElement} container
	 */
	function _showHistorySuggestions(container) {
		FloatplaneAPI.getHistory(0)
			.then((entries) => {
				var arr = Array.isArray(entries) ? entries : [];
				// Only watched videos (progress > 0)
				var watched = arr.filter(
					(e) => e && e.blogPost && e.blogPost.id && e.progress > 0,
				);
				if (!watched.length) return;
				// Pick up to 5, shuffled (Fisher-Yates)
				for (var si = watched.length - 1; si > 0; si--) {
					var rj = Math.floor(Math.random() * (si + 1));
					var tmp = watched[si];
					watched[si] = watched[rj];
					watched[rj] = tmp;
				}
				var picks = watched.slice(0, 5);
				var host = container.querySelector("#wl-suggest");
				if (!host) return;
				// Reuse the standard video card (matches the saved grid + browse)
				var frag = document.createDocumentFragment();
				for (var pi = 0; pi < picks.length; pi++) {
					var vid = picks[pi].blogPost;
					vid._wlCard = true;
					var card = AppCtx.util._makeVideoCard(
						vid,
						(vid.creator && vid.creator.id) || "",
						"watchlater",
						1,
						pi,
					);
					card.classList.add("wl-card");
					card.setAttribute("data-id", vid.id);
					card.setAttribute(
						"data-creator",
						(vid.creator && vid.creator.id) || "",
					);
					card.setAttribute("role", "button");
					frag.appendChild(card);
				}
				host.appendChild(frag);
				host.onclick = (e) => {
					var card = e.target.closest(".wl-card");
					if (!card) return;
					_openSaved(
						card.getAttribute("data-id"),
						card.getAttribute("data-creator"),
					);
				};
				host.onkeydown = (e) => {
					if (e.keyCode !== 13) return;
					var card = e.target.closest(".wl-card");
					if (!card) return;
					e.preventDefault();
					_openSaved(
						card.getAttribute("data-id"),
						card.getAttribute("data-creator"),
					);
				};
				var first = host.querySelector(".wl-card");
				if (first) setTimeout(() => first.focus(), 50);
			})
			.catch(() => {}); // silent: suggestions are best-effort
	}

	/**
	 * Open a saved video's detail page. Needs the creator id to navigate back
	 * into the creator view; fall back to browse.
	 * @param {string} id
	 * @param {string} creatorId
	 */
	function _openSaved(id, creatorId) {
		FloatplaneAPI.getPostInfo(id)
			.then((post) => {
				if (!post) {
					AppCtx.util._toast("Video unavailable");
					return;
				}
				var vid = post;
				vid.thumbnail =
					post.thumbnail || (post.creator && post.creator.icon) || null;
				AppCtx.views.details.showDetails(vid, creatorId || "");
			})
			.catch(() => {
				AppCtx.util._toast("Video unavailable");
			});
	}

	AppCtx.views.watchlater = {
		showWatchLater: showWatchLater,
	};

	// Wire the header clear-all button once (static HTML).
	_wireClearAll();
})();
