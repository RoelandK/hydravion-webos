// Probe /api/v3/auth/login + captcha/info on floatplane
const https = require("https");

function post(url, body, headers) {
	return new Promise((resolve) => {
		const u = new URL(url);
		const data = body ? JSON.stringify(body) : "";
		const req = https.request(
			{
				hostname: u.hostname,
				port: 443,
				path: u.pathname + u.search,
				method: "POST",
				headers: Object.assign(
					{
						"Content-Type": "application/json",
						Accept: "application/json",
						"User-Agent": "Hydravion (AndroidTV 1.4.2)",
						"Content-Length": Buffer.byteLength(data),
					},
					headers || {},
				),
			},
			(res) => {
				let d = "";
				res.on("data", (c) => (d += c));
				res.on("end", () => {
					console.log(
						"POST " +
							u.pathname +
							" -> " +
							res.statusCode +
							" set-cookie: " +
							JSON.stringify(
								(res.headers["set-cookie"] || []).map((s) => s.split(";")[0]),
							) +
							"\n  body: " +
							d.substring(0, 400),
					);
					resolve({
						status: res.statusCode,
						body: d,
						cookies: res.headers["set-cookie"] || [],
					});
				});
			},
		);
		req.on("error", (e) => {
			console.log("ERR " + e.message);
			resolve(null);
		});
		req.setTimeout(15000, () => {
			req.destroy();
			resolve(null);
		});
		if (data) req.write(data);
		req.end();
	});
}

function get(url) {
	return new Promise((resolve) => {
		const u = new URL(url);
		const req = https.get(
			{
				hostname: u.hostname,
				path: u.pathname + u.search,
				headers: {
					Accept: "application/json",
					"User-Agent": "Hydravion (AndroidTV 1.4.2)",
				},
			},
			(res) => {
				let d = "";
				res.on("data", (c) => (d += c));
				res.on("end", () => {
					console.log(
						"GET " +
							u.pathname +
							" -> " +
							res.statusCode +
							"\n  body: " +
							d.substring(0, 400),
					);
					resolve();
				});
			},
		);
		req.on("error", (e) => {
			console.log("ERR " + e.message);
			resolve();
		});
		req.setTimeout(15000, () => {
			req.destroy();
			resolve();
		});
		req.end();
	});
}

async function main() {
	console.log("=== 1. captcha/info ===");
	await get("https://www.floatplane.com/api/v3/auth/captcha/info");

	console.log(
		"\n=== 2. login with empty body (reveals required fields + captcha) ===",
	);
	await post("https://www.floatplane.com/api/v3/auth/login", {});

	console.log("\n=== 3. login with fake creds (no captcha) ===");
	await post("https://www.floatplane.com/api/v3/auth/login", {
		username: "nobody@example.com",
		password: "wrongpass",
	});
}

main();
