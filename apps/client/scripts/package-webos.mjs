import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "..");
const appDir = path.join(clientRoot, "build", "webos-app");
const outputDir = path.join(clientRoot, "build", "packages");

if (!fs.existsSync(path.join(appDir, "appinfo.json"))) {
  throw new Error("App webOS non preparata. Eseguire npm run build:webos.");
}
fs.mkdirSync(outputDir, { recursive: true });
const result = spawnSync("ares-package", [appDir, "-o", outputDir], { stdio: "inherit", shell: false });
if (result.error?.code === "ENOENT") {
  console.error("ares-package non trovato. Installare webOS CLI o usare webOS Studio per creare il pacchetto IPK.");
  process.exitCode = 2;
} else if (result.status !== 0) {
  process.exitCode = result.status || 1;
} else {
  console.log(`Pacchetto creato in ${outputDir}`);
}
