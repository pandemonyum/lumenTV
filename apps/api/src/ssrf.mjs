import dns from "node:dns/promises";
import net from "node:net";
import { HttpError } from "./http.mjs";

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export async function assertPublicUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new HttpError(400, "URL non valido", "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Sono ammessi soltanto URL HTTP e HTTPS", "invalid_url_scheme");
  }
  if (url.username || url.password) {
    throw new HttpError(400, "Le credenziali HTTP nell'autorità dell'URL non sono ammesse", "embedded_credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new HttpError(400, "Indirizzo locale non ammesso", "private_address");
  }

  if (net.isIP(hostname)) {
    if ((net.isIPv4(hostname) && isPrivateIPv4(hostname)) || (net.isIPv6(hostname) && isPrivateIPv6(hostname))) {
      throw new HttpError(400, "Indirizzo privato non ammesso", "private_address");
    }
    return url;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, "Impossibile risolvere il dominio", "dns_error");
  }
  if (!records.length) throw new HttpError(400, "Dominio senza indirizzi", "dns_error");
  for (const record of records) {
    if ((record.family === 4 && isPrivateIPv4(record.address)) || (record.family === 6 && isPrivateIPv6(record.address))) {
      throw new HttpError(400, "Il dominio risolve verso una rete privata", "private_address");
    }
  }
  return url;
}

export async function safeFetch(urlValue, options = {}) {
  const {
    maxRedirects = 5,
    timeoutMs = 20000,
    headers = {},
    method = "GET"
  } = options;

  let current = await assertPublicUrl(urlValue);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        method,
        redirect: "manual",
        headers: {
          "user-agent": "LumenTV/0.1 playlist-importer",
          accept: "*/*",
          ...headers
        },
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new HttpError(504, "Timeout verso il server remoto", "upstream_timeout");
      throw new HttpError(502, "Connessione al server remoto non riuscita", "upstream_connection_error");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new HttpError(502, "Redirect remoto senza destinazione", "invalid_redirect");
      current = await assertPublicUrl(new URL(location, current));
      continue;
    }
    return response;
  }
  throw new HttpError(502, "Troppi redirect remoti", "too_many_redirects");
}

export async function readBodyLimited(response, maxBytes, onProgress = null) {
  if (!response.ok) throw new HttpError(502, `Il server remoto ha risposto ${response.status}`, "upstream_http_error");
  const declared = Number.parseInt(response.headers.get("content-length") || "0", 10);
  if (declared > maxBytes) throw new HttpError(413, "Risorsa remota troppo grande", "remote_too_large");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Risorsa remota troppo grande", "remote_too_large");
    }
    chunks.push(Buffer.from(value));
    onProgress?.(total);
  }
  return Buffer.concat(chunks);
}
