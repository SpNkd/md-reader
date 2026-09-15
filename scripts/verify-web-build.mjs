import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const indexPath = join(dist, "index.html");

if (!existsSync(indexPath)) throw new Error("dist/index.html is missing");
const index = readFileSync(indexPath, "utf8");
if (index.includes("/src/main.ts")) throw new Error("index.html still points at the source entry");
if (!index.includes("manifest.webmanifest")) throw new Error("web manifest is not linked");
if (!existsSync(join(dist, "sw.js"))) throw new Error("service worker is missing");

const assets = join(dist, "assets");
if (!existsSync(assets) || !readdirSync(assets).some((file) => file.endsWith(".js"))) {
  throw new Error("compiled JavaScript asset is missing");
}

const totalBytes = walk(dist).reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`Web build verified: ${totalBytes} bytes across ${walk(dist).length} assets`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
