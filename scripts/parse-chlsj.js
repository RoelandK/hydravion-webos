// Scan ALL base64 blobs in a .chlsj, parse each as WS frames (permessage-deflate).
// Usage: node scripts/parse-chlsj.js <file.chlsj> [frameLimit]
const fs = require("fs");
const zlib = require("zlib");

const file = process.argv[2] || "liveltt2.chlsj";
const LIMIT = parseInt(process.argv[3] || "120", 10);
const c = fs.readFileSync(file, "utf8");
console.log("file:", file);

const re = /"encoding":"base64","encoded":"([^"]+)"/g;
let m,
	n = 0;
let blob = 0;
while ((m = re.exec(c)) && n < LIMIT) {
	blob++;
	let buf;
	try {
		buf = Buffer.from(m[1], "base64");
	} catch (e) {
		continue;
	}
	if (buf.length < 6 || buf.length > 5000000) continue;
	// quick filter: skip obvious audio (ID3) - starts with 0x47 ('G') or ID3
	if (
		buf[0] === 0x47 ||
		(buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33)
	)
		continue;

	let off = 0,
		local = 0;
	while (off + 2 <= buf.length && n < LIMIT && local < 25) {
		const b0 = buf[off],
			b1 = buf[off + 1];
		if ((b0 & 0x0f) === 0 && local > 0) break; // continuation without prior - bail
		const opcode = b0 & 0x0f;
		const masked = (b1 & 0x80) !== 0;
		let len = b1 & 0x7f;
		let hdr = 2;
		if (len === 126) {
			if (off + 4 > buf.length) break;
			len = buf.readUInt16BE(off + 2);
			hdr = 4;
		} else if (len === 127) {
			if (off + 10 > buf.length) break;
			len = Number(buf.readBigUInt64BE(off + 2));
			hdr = 10;
		}
		if (len < 0 || off + hdr + (masked ? 4 : 0) + len > buf.length) break;
		let payload = buf.subarray(
			off + hdr + (masked ? 4 : 0),
			off + hdr + (masked ? 4 : 0) + len,
		);
		if (masked) {
			const key = buf.subarray(off + hdr, off + hdr + 4);
			const out = Buffer.alloc(payload.length);
			for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ key[i & 3];
			payload = out;
		}
		let text = null;
		if (opcode === 0x1) text = payload.toString("utf8");
		else if (opcode === 0x2) {
			try {
				text = zlib.inflateRawSync(payload).toString("utf8");
			} catch (e) {}
			if (!text) text = payload.toString("utf8");
		}
		if (text && text.length > 0) {
			console.log(
				"blob" +
					blob +
					" #" +
					++n +
					" [op=" +
					opcode +
					(masked ? " c2s" : " s2c") +
					"] " +
					text.substring(0, 260).replace(/\s+/g, " "),
			);
			local++;
		}
		off += hdr + (masked ? 4 : 0) + len;
	}
}
