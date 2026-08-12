import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API terminata con codice ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Il server non è ancora in ascolto.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timeout avvio API");
}

test("API health, registrazione e login", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lumentv-test-"));
  const port = 21000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["apps/api/src/server.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LUMENTV_HOST: "127.0.0.1",
      LUMENTV_PORT: String(port),
      LUMENTV_DATABASE: path.join(temporary, "test.sqlite"),
      LUMENTV_IMAGE_DIR: path.join(temporary, "images"),
      LUMENTV_SECRET: "test-secret-test-secret-test-secret-123",
      LUMENTV_ALLOWED_ORIGINS: "*"
    }
  });
  t.after(() => new Promise((resolve) => {
    child.once("exit", () => {
      fs.rmSync(temporary, { recursive: true, force: true });
      resolve();
    });
    child.kill("SIGTERM");
  }));

  const health = await waitForHealth(baseUrl, child);
  assert.equal(health.status, "ok");
  assert.equal(health.videoProxy, false);

  const shortPasswordResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "short@example.com", password: "short" })
  });
  assert.equal(shortPasswordResponse.status, 400);
  const shortPasswordError = await shortPasswordResponse.json();
  assert.equal(shortPasswordError.error.code, "invalid_password");

  const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: "password123" })
  });
  assert.equal(registerResponse.status, 201);
  const registration = await registerResponse.json();
  assert.ok(registration.token);

  const meResponse = await fetch(`${baseUrl}/api/me`, {
    headers: { authorization: `Bearer ${registration.token}` }
  });
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json()).email, "test@example.com");

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "test@example.com", password: "password123" })
  });
  assert.equal(loginResponse.status, 200);
});
