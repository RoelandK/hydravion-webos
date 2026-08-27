/**
 * @fileoverview Notifications view - new-video/live detection, bell badges,
 * dropdown list. Registers into AppCtx.views.notifications.
 * Owns _notifPollTimer + _NOTIF_POLL_MS (notifications-only state).
 */
(() => {
	var _notifPollTimer = null;
	var _NOTIF_POLL_MS = 300000;

	function _startNotificationPolling() {
		clearInterval(_notifPollTimer);
		_notifPollTimer = setInterval(_checkForUpdates, _NOTIF_POLL_MS);
	}

	function _stopNotificationPolling() {
		clearInterval(_notifPollTimer);
		_notifPollTimer = null;
	}

	function _checkForUpdates() {
		for (var ci = 0; ci < AppCtx.state.SUBS.length; ci++) {
			var cid =
				AppCtx.state.SUBS[ci].creator ||
				(AppCtx.state.SUBS[ci].plan && AppCtx.state.SUBS[ci].plan.id);
			if (!cid) continue;
			var info = AppCtx.state.CREATOR_INFO[cid];
			if (!info) continue;
			((cid2, info2) => {
				FloatplaneAPI.getVideos(cid2, 0, "")
					.then((vids) => {
						if (!vids || !vids.length) return;
						var newest = vids[0];
						var lastId = localStorage.getItem("notif_lastVideo_" + cid2);
						if (lastId && lastId !== (newest.id || newest.guid)) {
							_notifyNewVideo(cid2, info2, newest);
							// Update AppCtx.state.VIDEOS cache so browse shows the new card
							AppCtx.util._setCache(cid2, vids);
							if (AppCtx.state.CURRENT_VIEW === "browse")
								AppCtx.views.browse.renderBrowse();
						}
						localStorage.setItem(
							"notif_lastVideo_" + cid2,
							newest.id || newest.guid,
						);
					})
					.catch(() => {});
			})(cid, info);
		}
	}

	function _notifyNewVideo(cid, info, video) {
		var list = _loadNotifList();
		var videoId = video.id || video.guid;
		var key = "video_" + videoId;
		for (var ni = 0; ni < list.length; ni++) {
			if (list[ni].key === key) return;
		}
		list.unshift({
			key: key,
			type: "video",
			creatorId: cid,
			videoId: videoId,
			creator: info.title || cid,
			title: video.title || "New video",
			ts: Date.now(),
		});
		if (list.length > 5) list.length = 5;
		_saveNotifList(list);
		_renderNotifBadge();
	}

	function _loadNotifList() {
		try {
			var raw = localStorage.getItem("notif_list");
			return raw ? JSON.parse(raw) : [];
		} catch (e) {
			return [];
		}
	}

	function _saveNotifList(list) {
		try {
			localStorage.setItem("notif_list", JSON.stringify(list));
		} catch (e) {}
	}

	function _renderNotifBadge() {
		var list = _loadNotifList();
		var count = list.length > 99 ? "99+" : String(list.length);
		// Update badge on both browse and creator bells
		var badges = ["notif-badge", "creator-notif-badge"];
		for (var bi = 0; bi < badges.length; bi++) {
			var badge = document.getElementById(badges[bi]);
			if (!badge) continue;
			if (list.length) {
				badge.textContent = count;
				badge.classList.remove("hidden");
			} else {
				badge.classList.add("hidden");
			}
		}
	}

	function _navToNotif(n) {
		if (n.type !== "video" || !n.creatorId || !n.videoId) return;
		// Close any open notification dropdown
		var ndd = document.getElementById("notif-dropdown");
		var cdd = document.getElementById("creator-notif-dropdown");
		if (ndd && !ndd.classList.contains("hidden")) ndd.classList.add("hidden");
		if (cdd && !cdd.classList.contains("hidden")) cdd.classList.add("hidden");
		// Try to find the video in AppCtx.state.VIDEOS cache
		var vids = AppCtx.state.VIDEOS[n.creatorId];
		var vid = null;
		if (vids) {
			for (var vi = 0; vi < vids.length; vi++) {
				if ((vids[vi].id || vids[vi].guid) === n.videoId) {
					vid = vids[vi];
					break;
				}
			}
		}
		if (vid) {
			AppCtx.views.details.showDetails(vid, n.creatorId);
		}
	}

	function _renderNotifList() {
		var list = _loadNotifList();
		var html = "";
		if (!list.length) {
			html = '<div class="empty">No new notifications</div>';
		} else {
			for (var ni = 0; ni < list.length; ni++) {
				var n = list[ni];
				var cls = n.type === "live" ? "notif-live" : "notif-video";
				var icon = n.type === "live" ? "\u25cf " : "\u25b6 ";
				html +=
					'<div class="notif-item" tabindex="0" data-idx="' +
					ni +
					'"><div class="' +
					cls +
					'">' +
					icon +
					n.title +
					'</div><div class="notif-creator">' +
					n.creator +
					"</div></div>";
			}
		}
		var el = document.getElementById("notif-list");
		if (el) el.innerHTML = html;
		var cel = document.getElementById("creator-notif-list");
		if (cel) cel.innerHTML = html;
		// Attach click handlers to both lists
		var containers = [el, cel];
		for (var ci = 0; ci < containers.length; ci++) {
			var container = containers[ci];
			if (!container) continue;
			var items = container.querySelectorAll(".notif-item");
			for (var nii = 0; nii < items.length; nii++) {
				((idx) => {
					items[nii].addEventListener("click", () => {
						_navToNotif(list[idx]);
					});
					items[nii].addEventListener("keydown", (e) => {
						if (e.keyCode === 13) {
							_navToNotif(list[idx]);
						}
					});
				})(parseInt(items[nii].getAttribute("data-idx"), 10));
			}
		}
	}

	function _focusFirstNotif(dd) {
		var first = dd.querySelector(".notif-item");
		if (first) first.focus();
	}

	function _setupNotifButton() {
		var btn = document.getElementById("btn-notif");
		var dd = document.getElementById("notif-dropdown");
		var clearBtn = document.getElementById("notif-clear");
		if (btn && dd && !btn._notifWired) {
			btn._notifWired = true;
			btn.onclick = (e) => {
				e.stopPropagation();
				_renderNotifList();
				dd.classList.toggle("hidden");
				AppCtx.state._focusCacheView = null; // dropdown items change the focusable set
				if (!dd.classList.contains("hidden")) _focusFirstNotif(dd);
			};
			if (clearBtn) {
				clearBtn.onclick = () => {
					_saveNotifList([]);
					_renderNotifBadge();
					_renderNotifList();
					dd.classList.add("hidden");
				};
			}
			document.addEventListener("click", (e) => {
				if (!dd.contains(e.target) && e.target !== btn)
					dd.classList.add("hidden");
			});
		}
		// Creator view bell
		var cbtn = document.getElementById("creator-btn-notif");
		var cdd = document.getElementById("creator-notif-dropdown");
		var cclearBtn = document.getElementById("creator-notif-clear");
		if (cbtn && cdd && !cbtn._cNotifWired) {
			cbtn._cNotifWired = true;
			cbtn.onclick = (e) => {
				e.stopPropagation();
				_renderNotifList();
				cdd.classList.toggle("hidden");
				AppCtx.state._focusCacheView = null; // dropdown items change the focusable set
				if (!cdd.classList.contains("hidden")) _focusFirstNotif(cdd);
			};
			if (cclearBtn) {
				cclearBtn.onclick = () => {
					_saveNotifList([]);
					_renderNotifBadge();
					_renderNotifList();
					cdd.classList.add("hidden");
				};
			}
			document.addEventListener("click", (e) => {
				if (!cdd.contains(e.target) && e.target !== cbtn)
					cdd.classList.add("hidden");
			});
		}
	}

	AppCtx.views.notifications = {
		_startNotificationPolling: _startNotificationPolling,
		_stopNotificationPolling: _stopNotificationPolling,
		_checkForUpdates: _checkForUpdates,
		_notifyNewVideo: _notifyNewVideo,
		_loadNotifList: _loadNotifList,
		_saveNotifList: _saveNotifList,
		_renderNotifBadge: _renderNotifBadge,
		_navToNotif: _navToNotif,
		_renderNotifList: _renderNotifList,
		_focusFirstNotif: _focusFirstNotif,
		_setupNotifButton: _setupNotifButton,
	};
})();
