// Bundles src/tag/ose.ts → public/ose.js (minified, ES2018, IIFE) and fails if it exceeds 6 KB gzipped (CAP-07).
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public/ose.js");
await build({
  entryPoints: [path.join(root, "src/tag/ose.ts")],
  outfile: out,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018"],
  legalComments: "none",
  logLevel: "warning",
});
const gz = gzipSync(readFileSync(out)).length;
console.log(`ose.js built: ${gz} bytes gzipped`);
if (gz > 6144) {
  console.error("ose.js exceeds the 6 KB gzipped budget");
  process.exit(1);
}
