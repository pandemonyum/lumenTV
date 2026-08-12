import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "..");
const source = path.join(clientRoot, "dist");
const target = path.join(clientRoot, "build", "webos-app");
const metadata = path.join(clientRoot, "webos");

if (!fs.existsSync(source)) throw new Error("Build webOS non trovata. Eseguire prima vite build --mode webos.");
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });
for (const file of ["appinfo.json", "icon.png", "largeIcon.png"]) {
  fs.copyFileSync(path.join(metadata, file), path.join(target, file));
}
console.log(`App webOS preparata in ${target}`);
