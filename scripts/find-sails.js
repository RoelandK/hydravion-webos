// Find how the web app's sails.io.js serializes socket.post() data
const fs = require("fs");
const c = fs.readFileSync(process.env.TEMP + "/fp-index.js", "utf8");

for (const pat of [
	".post=function",
	"post:function",
	"SailsSocket.prototype",
	"_emit",
	'"post"',
	"data:data",
	"body:data",
]) {
	let i = c.indexOf(pat),
		n = 0;
	while (i >= 0 && n < 2) {
		console.log("--- " + pat + " @ " + i + " ---");
		console.log(
			c.substring(Math.max(0, i - 150), i + 500).replace(/\s+/g, " "),
		);
		i = c.indexOf(pat, i + 1);
		n++;
	}
	console.log("");
}
