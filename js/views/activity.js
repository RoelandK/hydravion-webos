/**
 * @fileoverview Activity view - the current user's activity feed
 * (comments they've posted). Registers into AppCtx.views.activity.
 */
(() => {
	/**
	 * Render the activity feed as a simple list of comment entries.
	 * Each entry: { time, comment, postTitle, postId, creatorTitle, creatorUrl }.
	 * Selecting an entry opens the post's details.
	 */
	function showActivity() {
		AppCtx.util._show("view-activity");
		AppCtx.state._focusCacheView = null;
		var container = document.getElementById("activity-content");
		if (!container) return;
		container.innerHTML =
			'<div id="activity-loader" style="padding:60px;text-align:center;color:#666">Loading activity...</div>';

		// Activity needs the user's id (?id=) - fetch self info first
		FloatplaneAPI.getUserSelf()
			.then((self) => {
				var userId = (self && self.id) || "";
				return FloatplaneAPI.getActivity(userId);
			})
			.then((resp) => {
				container.innerHTML = "";
				var items = resp && Array.isArray(resp.activity) ? resp.activity : [];
				if (!items.length) {
					container.innerHTML = '<div class="grid-empty">No activity yet</div>';
					return;
				}
				// visibility: "public" | "private" | "hidden" - if private,
				// note it but still show the list (it's the user's own feed).
				if (resp.visibility === "private") {
					var visNote = document.createElement("div");
					visNote.className = "grid-empty";
					visNote.textContent =
						"Your activity is set to private - only you can see this.";
					container.appendChild(visNote);
				}
				var list = document.createElement("div");
				list.className = "activity-list";
				items.forEach((item) => {
					if (!item || item.hidden) return;
					var div = document.createElement("div");
					div.className = "activity-item";
					div.setAttribute("tabindex", "0");
					var when = item.time ? AppCtx.util._fmtDate(item.time) : "";
					var postTitle = item.postTitle || "Untitled post";
					var creatorTitle = item.creatorTitle || "";
					var comment = (item.comment || "").replace(/<[^>]*>/g, "");
					div.innerHTML =
						'<div class="activity-top"><span class="activity-creator">' +
						creatorTitle +
						'</span><span class="activity-time">' +
						when +
						"</span></div>" +
						'<div class="activity-post">' +
						postTitle +
						"</div>" +
						'<div class="activity-comment">' +
						comment +
						"</div>";
					div.addEventListener("click", () => {
						if (!item.postId) return;
						FloatplaneAPI.getPostInfo(item.postId)
							.then((post) => {
								if (!post) {
									AppCtx.util._toast("Video unavailable");
									return;
								}
								post.thumbnail =
									post.thumbnail || (post.creator && post.creator.icon) || null;
								AppCtx.views.details.showDetails(
									post,
									(post.creator && post.creator.id) || "",
								);
							})
							.catch(() => {
								AppCtx.util._toast("Video unavailable");
							});
					});
					div.addEventListener("keydown", (e) => {
						if (e.keyCode === 13) div.click();
					});
					list.appendChild(div);
				});
				container.appendChild(list);
				var first = list.querySelector(".activity-item");
				if (first) first.focus();
			})
			.catch(() => {
				container.innerHTML =
					'<div class="grid-empty">Failed to load activity</div>';
			});
	}

	AppCtx.views.activity = {
		showActivity: showActivity,
	};
})();
