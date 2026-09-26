import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { verifyLoginWidget, verifyWebAppInitData } from "../src/lib/telegram.ts";

const TOKEN = "123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz";
const now = 1_800_000_000;

function signWidget(data: Record<string, string | number>) {
  const dcs = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(TOKEN).digest();
  return { ...data, hash: createHmac("sha256", secret).update(dcs).digest("hex") };
}

function signWebApp(fields: Record<string, string>) {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

test("login widget: valid signature accepted", () => {
  const data = signWidget({ id: 42, first_name: "Иван", username: "ivan", auth_date: now - 10 });
  const r = verifyLoginWidget(data, TOKEN, 86400, now);
  assert.equal(r?.id, 42n);
  assert.equal(r?.username, "ivan");
});

test("login widget: tampered field rejected", () => {
  const data = signWidget({ id: 42, first_name: "Иван", auth_date: now - 10 });
  assert.equal(verifyLoginWidget({ ...data, id: 43 }, TOKEN, 86400, now), null);
});

test("login widget: extra injected field cannot bypass", () => {
  const data = signWidget({ id: 42, auth_date: now - 10 });
  assert.ok(verifyLoginWidget({ ...data, role: "ADMIN" }, TOKEN, 86400, now));
  assert.equal(verifyLoginWidget({ ...data, first_name: "x" }, TOKEN, 86400, now), null);
});

test("login widget: expired rejected", () => {
  const data = signWidget({ id: 42, auth_date: now - 90000 });
  assert.equal(verifyLoginWidget(data, TOKEN, 86400, now), null);
});

test("login widget: wrong bot token rejected", () => {
  const data = signWidget({ id: 42, auth_date: now });
  assert.equal(verifyLoginWidget(data, TOKEN + "x", 86400, now), null);
});

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
