// Test v8 - use ALL cookies from the liveltt2.chlsj recording (authenticated
// sails.sid + cf_clearance + _cfuvid) to prove the join protocol works.
const WebSocket = require("ws");

const SID =
	"sails.sid=s%3AwoBz5HDGzqpmwzWOnze8kYVyZjY_vtYV.uat412A2r0p3Ja1Uv30fzzHnG71R3jJzx8z7jxCUz58" +
	"; _cfuvid=q8Av3HAPK05_FHyBEu_1RXQvuwuE_EWiC8x3eQxV37o-1786559889.175183-1.0.1.1-cpLSt6xlqQCN6dCgKpIDXsQitULjHWKGiyg9rTE0fMw" +
	"; cf_clearance=8vBaU4ClQaJtfLz5UB4mofLsNLec7uiiOdwi4fdPswM-1786745894-1.2.1.1-onmLB6r6rKIq_CNrys3fS4FkROgvtquc1rvXzDr9_5Z2LCdWhiVGi8uWMz6hU1gsFJORVOtFjm1UR1sTx2FhyUGEwF_gYbsyRn0tAAb_f8.Ue0KgGf57UGpvyuNTihn5pcaRjBw5JU9KPUwMWvj28WtKr5YNkk61Rkz_kPNS1Z9HGIQ20lPG7RgH076F6.CKcDbsPtEjfDRSiR.rfYx5oSxSkxWpk2W.0PWPobGVRvOAx76V2X4Ujekh7SSQNE5c7e1ZwwePAcKhHWyQEw6RtanBt7XCFMq3ocHVIFdiIPpRi1NA5ZxOEZdVXnEwO_aHz0EuLTIaUlHeZ90hKo4z1jHWVRVAXvcM2DgNqu80oIY";
const STREAM = process.argv[2] || "5c13f3c006f1be15e08e05c0";

const wsUrl =
	"wss://chat.floatplane.com/socket.io/?EIO=3&transport=websocket" +
	"&__sails_io_sdk_version=1.2.1" +
	"&__sails_io_sdk_platform=node" +
	"&__sails_io_sdk_language=javascript";
const ws = new WebSocket(wsUrl, {
	headers: { Origin: "https://www.floatplane.com", Cookie: SID },
});

ws.on("open", () => {
	console.log("[WS] open");
	ws.send("40");
});
ws.on("message", (raw) => {
	const data = raw.toString("utf8");
	if (data.charAt(0) === "0") {
		console.log("[engine] open");
		return;
	}
	if (data === "2") {
		ws.send("3");
		return;
	}
	if (data.charAt(0) !== "4") return;
	const payload = data.substring(1);
	if (payload.charAt(0) === "0") {
		console.log("[WS] SocketIO CONNECTED - joining /ck/channel/join");
		ws.send(
			"42" +
				"1" +
				JSON.stringify([
					"post",
					{
						method: "post",
						headers: {},
						data: { channel: STREAM },
						url: "/ck/channel/join",
					},
				]),
		);
		return;
	}
	if (payload.charAt(0) === "3") {
		console.log(
			"[ACK] " + payload.substring(1).replace(/^\d+/, "").substring(0, 200),
		);
		return;
	}
	if (payload.charAt(0) === "2") {
		console.log("[EVENT] " + payload.substring(1).substring(0, 160));
		return;
	}
});
ws.on("error", (e) => console.log("[err] " + e.message));
ws.on("close", (code, reason) =>
	console.log("[CLOSED] " + code + " " + reason.toString()),
);
setTimeout(() => {
	console.log("[done] 15s");
	process.exit(0);
}, 15000);
