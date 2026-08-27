// Inspect LoginResponse / LoginRequest schemas + captcha requirement
const fs = require("fs");
const c = fs.readFileSync(process.env.TEMP + "/fp-index.js", "utf8");

function show(label, pat, len) {
	const i = c.indexOf(pat);
	console.log("=== " + label + " @" + i + " ===");
	if (i >= 0) {
		console.log(
			c.substring(Math.max(0, i - 100), i + len).replace(/\s+/g, " "),
		);
	}
	console.log("");
}

show("LoginRequestToJSON", "LoginRequestToJSONTyped=", 600);
show("LoginResponseFromJSON", "LoginResponseFromJSONTyped=", 700);
show("captcha/info usage", "/api/v3/auth/captcha/info", 700);
