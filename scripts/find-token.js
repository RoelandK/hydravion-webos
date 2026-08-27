// Find a Bearer token in the .chlsj recordings
const fs = require("fs");
for (const f of [
	"liveltt2.chlsj",
	"websiteloadwithlikes.chlsj",
	"liveltt.chlsj",
	"1newvid.chlsj",
	"badges.chlsj",
	"hasprogress.chlsj",
]) {
	const c = fs.readFileSync(f, "utf8");
	const m = /"authorization"\s*:\s*"Bearer ([^"]+)/.exec(c);
	if (m) {
		console.log(f + ": TOKEN " + m[1].substring(0, 50) + "...");
		fs.writeFileSync("test-token.txt", m[1]);
	} else {
		console.log(f + ": no bearer");
	}
}
