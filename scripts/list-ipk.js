// List contents of a webOS .ipk (ar archive with data.tar.gz member)
const fs = require("fs");
const zlib = require("zlib");
const b = fs.readFileSync(process.argv[2]);
let off = 0;
const members = [];
while (off + 60 <= b.length) {
	const hdr = b.toString("ascii", off, off + 60);
	const name = hdr.substring(0, 16).trim();
	const size = parseInt(hdr.substring(48, 58).trim() || "0", 10);
	if (!name || name === "!<arch>") {
		if (name === "!<arch>") {
			off += 60;
			continue;
		}
		break;
	}
	members.push({ name, size, off: off + 60 });
	off += 60 + size + (size % 2);
	if (off >= b.length) break;
}
console.log(
	"members:",
	members.map((m) => m.name + "(" + m.size + ")").join(", "),
);
const data = members.find((m) => m.name.indexOf("data.tar") !== -1);
if (!data) {
	console.log("no data.tar.gz");
	process.exit(0);
}
const tar = zlib.gunzipSync(b.subarray(data.off, data.off + data.size));
let o = 0;
const names = [];
while (o + 512 <= tar.length) {
	const nh = tar
		.toString("utf8", o, o + 100)
		.replace(/\0/g, "")
		.trim();
	if (!nh) break;
	const sz = parseInt(tar.toString("utf8", o + 124, o + 136).trim() || "0", 8);
	names.push({ n: nh, s: sz });
	o += 512 + Math.ceil(sz / 512) * 512;
}
console.log("total entries:", names.length);
const big = names.filter((e) => e.s > 100000);
console.log("entries >100KB:");
for (const e of big) console.log("  " + e.n + " (" + e.s + ")");
const sus = names.filter((e) =>
	/chlsj|test-chat|parse|find-token|\.md$|ipk$/.test(e.n),
);
console.log("suspicious:");
for (const e of sus) console.log("  " + e.n + " (" + e.s + ")");
