/**
 * @fileoverview Search view - server-side search across subscriptions.
 * Registers into AppCtx.views.search.
 */
(() => {
	/** @param {string} query Server-side search across all subscriptions */
	function doSearch(query) {
		console.log("[NAV] doSearch: " + query);
		AppCtx.util._show("view-loading");
		var results = {};
		var count = 0;
		var totalSubs = AppCtx.state.SUBS.length;
		var done = false;
		var fallback = null;
		var finish = () => {
			if (done) return;
			done = true;
			clearTimeout(fallback);
			renderSearchResults(query, results);
		};
		if (!totalSubs) {
			finish(); // no subscriptions - show the empty state, don't hang
			return;
		}
		// Fallback: render partial results if a request hangs
		fallback = setTimeout(finish, 8000);
		AppCtx.state.SUBS.forEach((sub) => {
			var cid = sub.creator || (sub.plan && sub.plan.id);
			if (!cid) {
				count++;
				return;
			}
			FloatplaneAPI.getVideos(cid, 0, query)
				.then((videos) => {
					if (videos && videos.length) results[cid] = videos;
				})
				.catch(() => {})
				.then(() => {
					count++;
					if (count >= totalSubs) finish();
				});
		});
	}

	/** @param {string} query @param {Object<string, Array>} results Per-creator results */
	function renderSearchResults(query, results) {
		AppCtx.util._show("view-browse");
		AppCtx.state._focusCacheView = null;
		var container = document.getElementById("browse-rows");
		container.innerHTML =
			'<div class="browse-row" style="padding-top:20px"><div class="row-header"><span class="row-title" style="color:#0095D6;cursor:pointer" id="search-back">Back</span></div></div>';
		document.getElementById("search-back").addEventListener("click", () => {
			if (AppCtx.state.CURRENT_CREATOR)
				AppCtx.views.creator.showCreator(AppCtx.state.CURRENT_CREATOR);
			else AppCtx.views.browse.renderBrowse();
		});
		var total = 0;
		var grid = document.createElement("div");
		grid.className = "grid-cards search-grid";
		var col = 0;
		Object.keys(results).forEach((cid) => {
			var videos = results[cid];
			if (!videos || !videos.length) return;
			total += videos.length;
			// One overview grid across all creators (like history/watch-later)
			videos.forEach((vid) => {
				grid.appendChild(
					AppCtx.util._makeVideoCard(vid, cid, "search", 0, col++),
				);
			});
		});
		container.appendChild(grid);
		if (!total)
			container.innerHTML +=
				'<div class="grid-empty" style="padding:60px;text-align:center">No results for "' +
				query +
				'"</div>';
		// Focus first result card so arrow nav works immediately
		var firstCard = container.querySelector(".video-card");
		if (firstCard) firstCard.focus();
	}

	/** Search within current creator context. @param {string} query */
	function doCreatorSearch(query) {
		var cid = AppCtx.state.CURRENT_CREATOR;
		if (!cid) return;
		AppCtx.util._show("view-loading");
		FloatplaneAPI.getVideos(cid, 0, query)
			.then((videos) => {
				var filtered = videos || [];
				// If a specific channel is selected, filter results to that channel
				if (AppCtx.state.CURRENT_CHANNEL_FILTER) {
					filtered = filtered.filter(
						(v) =>
							v.channel && v.channel.id === AppCtx.state.CURRENT_CHANNEL_FILTER,
					);
				}
				if (filtered.length) {
					renderSearchResults(query, { [cid]: filtered });
				} else {
					AppCtx.util._show("view-creator");
				}
			})
			.catch(() => AppCtx.views.creator.showCreator(cid));
	}

	AppCtx.views.search = {
		doSearch: doSearch,
		renderSearchResults: renderSearchResults,
		doCreatorSearch: doCreatorSearch,
	};
})();
