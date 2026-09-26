import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://x:x@127.0.0.1:1/x",
  SERVER_SECRET: process.env.SERVER_SECRET ?? "x".repeat(40),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? "123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz",
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME ?? "test_bot",
  APNS_KEY_ID: "ABC123DEFG",
  APNS_TEAM_ID: "TEAM123456",
  APNS_KEY: pem.replace(/\n/g, ""),
});

test("apns: key pasted as one line is accepted and JWT verifies", async () => {
  const { apnsConfigured, providerToken } = await import("../src/lib/apns.ts");
  assert.equal(apnsConfigured(), true);
  const jwt = providerToken();
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(Buffer.from(h!, "base64url").toString());
  const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
  assert.deepEqual(header, { alg: "ES256", kid: "ABC123DEFG" });
  assert.equal(payload.iss, "TEAM123456");
  const ok = verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(s!, "base64url"),
  );
  assert.equal(ok, true);
  assert.equal(providerToken(), jwt);
});
