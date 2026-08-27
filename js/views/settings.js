/**
 * @fileoverview Settings view - overlay open/close + device IP logging.
 * Registers into AppCtx.views.settings. No shared state deps (DOM + webOS only).
 */
(() => {
	function showSettings() {
		console.log("[UI] showSettings");
		// Log the device's own IP so we can see it in the Python logger
		if (typeof webOS !== "undefined" && webOS.service) {
			webOS.service.request("luna://com.webos.service.connectionmanager", {
				method: "getStatus",
				parameters: {},
				onSuccess: (r) => {
					var ip =
						(r.wired && r.wired.ipAddress) ||
						(r.wifi && r.wifi.ipAddress) ||
						r.ipAddress ||
						"not connected (simulator?)";
					console.log("[NET] My IP: " + ip);
				},
				onFailure: () => {},
			});
		}
		document.getElementById("settings-overlay").classList.remove("hidden");
		var firstSet = document.querySelector(".set-btn");
		if (firstSet) firstSet.focus();
	}

	function hideSettings() {
		console.log("[UI] hideSettings");
		document.getElementById("settings-overlay").classList.add("hidden");
	}

	AppCtx.views.settings = {
		showSettings: showSettings,
		hideSettings: hideSettings,
	};
})();
