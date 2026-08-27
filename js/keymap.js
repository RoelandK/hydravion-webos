/**
 * @fileoverview webOS remote keycode table - single source of truth for the
 * physical remote keys the app handles. handleKey() in app.js maps these
 * names to view-specific behavior; this file only declares the codes.
 *
 * Mirror of the keymapping.js pattern from Hydravion-Smart-TV, webOS-only.
 */
window.WebOSKeys = (() => {
	/** @const {Object<number,string>} keyCode -> logical action name */
	var MAP = {
		8: "back", // Backspace (fallback for keyboards without 461)
		13: "enter",
		19: "pause",
		27: "back", // Escape
		32: "play", // Space
		33: "pageUp",
		34: "pageDown",
		36: "home",
		37: "left",
		38: "up",
		39: "right",
		40: "down",
		46: "cc", // Delete - subtitles toggle
		67: "cc", // C key - subtitles toggle
		403: "red",
		404: "green",
		405: "yellow",
		406: "blue",
		412: "rewind",
		413: "stop",
		415: "play",
		417: "fastForward",
		445: "exit",
		457: "info",
		461: "back", // webOS Back key
	};

	/** Resolve a keyCode to its logical action name. */
	function name(keyCode) {
		return Object.prototype.hasOwnProperty.call(MAP, keyCode) ? MAP[keyCode] : null;
	}

	return { MAP: MAP, name: name };
})();
