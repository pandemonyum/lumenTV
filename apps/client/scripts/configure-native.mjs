import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDir, "..");

function log(message) {
  console.log(`[configure-native] ${message}`);
}

function patchIos() {
  const plistPath = path.join(clientRoot, "ios", "App", "App", "Info.plist");
  if (!fs.existsSync(plistPath)) {
    log("iOS non ancora generato: salto Info.plist");
    return;
  }

  let content = fs.readFileSync(plistPath, "utf8");
  let changed = false;

  if (!content.includes("<key>NSAppTransportSecurity</key>")) {
    const snippet = `\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoadsForMedia</key>\n\t\t<true/>\n\t\t<key>NSAllowsArbitraryLoadsInWebContent</key>\n\t\t<true/>\n\t</dict>`;
    const rootEnd = content.lastIndexOf("</dict>");
    if (rootEnd < 0) throw new Error(`Info.plist non riconosciuto: ${plistPath}`);
    content = `${content.slice(0, rootEnd)}${snippet}\n${content.slice(rootEnd)}`;
    changed = true;
  }

  if (!content.includes("<key>NSLocalNetworkUsageDescription</key>")) {
    const snippet = `\n\t<key>NSLocalNetworkUsageDescription</key>\n\t<string>LumenTV usa la rete locale per collegarsi al catalogo personale configurato dall'utente.</string>`;
    const rootEnd = content.lastIndexOf("</dict>");
    if (rootEnd < 0) throw new Error(`Info.plist non riconosciuto: ${plistPath}`);
    content = `${content.slice(0, rootEnd)}${snippet}\n${content.slice(rootEnd)}`;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(plistPath, content);
    log("Info.plist iOS configurato per API LAN e media HTTP");
  } else {
    log("Info.plist iOS gia configurato");
  }
}

function patchAndroid() {
  const manifestPath = path.join(clientRoot, "android", "app", "src", "main", "AndroidManifest.xml");
  if (!fs.existsSync(manifestPath)) {
    log("Android non ancora generato: salto manifest");
    return;
  }

  let content = fs.readFileSync(manifestPath, "utf8");
  let changed = false;
  const applicationStart = content.match(/<application\b[^>]*>/)?.[0];
  if (!applicationStart) throw new Error(`Manifest Android non riconosciuto: ${manifestPath}`);

  let patchedStart = applicationStart;
  if (!patchedStart.includes("android:usesCleartextTraffic=")) {
    patchedStart = patchedStart.replace(/>$/, '\n        android:usesCleartextTraffic="true">');
    changed = true;
  }
  if (patchedStart !== applicationStart) content = content.replace(applicationStart, patchedStart);

  if (changed) {
    fs.writeFileSync(manifestPath, content);
    log("Manifest Android configurato per host HTTP dinamici");
  } else {
    log("Manifest Android gia configurato");
  }
}

patchIos();
patchAndroid();
