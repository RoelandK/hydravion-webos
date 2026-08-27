// Probe: can /ck/channel/join work with an ANONYMOUS session?
// No pre-seeded cookies. Steps:
//   1. GET chat.floatplane.com/__getcookie -> anonymous sails.sid
//   2. Connect the chat socket.io WS with that cookie
//   3. Send /ck/channel/join for STREAM
//   4. Log the join ACK + any radioChatter events for ~20s
const https = require("https");
const WebSocket = require("ws");

const STREAM = process.argv[2] || "5c13f3c006f1be15e08e05c0";
const UA = "Hydravion (AndroidTV 1.4.2)";

function getChatCookie() {
	return new Promise((resolve) => {
		const req = https.get(
			"https://chat.floatplane.com/__getcookie",
			{ headers: { "User-Agent": UA, Accept: "application/json" } },
			(res) => {
				const cookies = res.headers["set-cookie"] || [];
				res.resume();
				let sid = "";
				for (const c of cookies) {
					if (c.indexOf("sails.sid") !== -1) {
						sid = c.split(";")[0];
						break;
					}
				}
				console.log(
					"[cookie] status=" +
						res.statusCode +
						" set-cookie=" +
						JSON.stringify(cookies.map((c) => c.split(";")[0])),
				);
				resolve(sid);
			},
		);
		req.on("error", (e) => {
			console.log("[cookie] ERR " + e.message);
			resolve("");
		});
		req.setTimeout(8000, () => {
			req.destroy();
			resolve("");
		});
	});
}

async function main() {
	const sid = await getChatCookie();
	if (!sid) {
		console.log("[FAIL] no anonymous session cookie");
		process.exit(1);
	}
	console.log("[cookie] anonymous sails.sid: " + sid);

	const wsUrl =
		"wss://chat.floatplane.com/socket.io/?EIO=3&transport=websocket" +
		"&__sails_io_sdk_version=1.2.1" +
		"&__sails_io_sdk_platform=node" +
		"&__sails_io_sdk_language=javascript";
	const ws = new WebSocket(wsUrl, {
		headers: { Origin: "https://www.floatplane.com", Cookie: sid },
		perMessageDeflate: false,
	});
	let joined = false;

	ws.on("open", () => ws.send("40"));
	ws.on("message", (raw) => {
		const data = raw.toString("utf8");
		if (data.charAt(0) === "0") return; // engine open
		if (data === "2") return ws.send("3"); // ping->pong
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
			const ack = payload.substring(1).replace(/^\d+/, "");
			try {
				const code = JSON.parse(ack)[0].statusCode;
				console.log(
					"[ACK] join statusCode=" +
						code +
						(code === 200 ? " OK" : " REJECTED"),
				);
				if (code === 200) joined = true;
			} catch (e) {
				console.log("[ACK] " + ack.substring(0, 200));
			}
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
		console.log(
			joined
				? "[RESULT] ANONYMOUS CHAT WORKS"
				: "[RESULT] anonymous join failed",
		);
		process.exit(0);
	}, 20000);
}

main();
