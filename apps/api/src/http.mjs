import { verifySessionToken } from "./security.mjs";
import { config } from "./config.mjs";

export class HttpError extends Error {
  constructor(status, message, code = "request_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    ...headers
  });
  response.end(body);
}

export function sendNoContent(response) {
  response.writeHead(204, { "cache-control": "no-store" });
  response.end();
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, "Richiesta troppo grande", "payload_too_large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON non valido", "invalid_json");
  }
}

export function requireAuth(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const payload = match ? verifySessionToken(match[1]) : null;
  if (!payload) throw new HttpError(401, "Autenticazione richiesta", "unauthorized");
  return payload;
}

export function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && (config.allowedOrigins.includes(origin) || config.allowedOrigins.includes("*"))) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-headers", "authorization,content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
}

export function assertEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, "Indirizzo email non valido", "invalid_email");
  }
  return email;
}

export function assertPassword(value) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 8 || password.length > 200) {
    throw new HttpError(400, "La password deve contenere tra 8 e 200 caratteri", "invalid_password");
  }
  return password;
}

export function assertHttpUrl(value, fieldName = "URL") {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new HttpError(400, `${fieldName} non valido`, "invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, `${fieldName} deve usare HTTP o HTTPS`, "invalid_url_scheme");
  }
  return url.toString();
}
