import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyWebAppInitData } from "../src/lib/telegram.ts";

const TOKEN = "123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz";
const now = 1_800_000_000;

function signWebApp(fields: Record<string, string>) {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

test("webapp initData: valid accepted, including signature field", () => {
  const initData = signWebApp({
    auth_date: String(now - 5),
    query_id: "AAE",
    signature: "sig",
    user: JSON.stringify({ id: 777, first_name: "Анна", username: "anna" }),
  });
  const r = verifyWebAppInitData(initData, TOKEN, 86400, now);
  assert.equal(r?.id, 777n);
  assert.equal(r?.firstName, "Анна");
});

test("webapp initData: tampered user rejected", () => {
  const initData = signWebApp({ auth_date: String(now), user: JSON.stringify({ id: 1 }) });
  const forged = initData.replace(encodeURIComponent('{"id":1}'), encodeURIComponent('{"id":2}'));
  assert.equal(verifyWebAppInitData(forged, TOKEN, 86400, now), null);
});

test("webapp initData: missing hash rejected", () => {
  assert.equal(verifyWebAppInitData("auth_date=1&user=%7B%22id%22%3A1%7D", TOKEN, 86400, now), null);
});
