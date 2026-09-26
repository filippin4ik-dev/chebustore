import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://127.0.0.1:4000";
const ORIGIN = "http://localhost:5173";
const LOG = process.env.SERVER_LOG;

async function call(method, path, { token, body, cookie, csrf = true, origin = ORIGIN, form } = {}) {
  const headers = {};
  if (token?.startsWith("cookie:")) headers.Cookie = token.slice(7);
  else if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers["X-CS-CSRF"] = "1";
  if (origin) headers.Origin = origin;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function codeFor(email) {
  for (let i = 0; i < 20; i++) {
    const log = readFileSync(LOG, "utf8");
    const re = new RegExp(`to=${email.replace(/[.@]/g, "\\$&")}[\\s\\S]*?Код для входа в CHEBU: (\\d{6})`, "g");
    const all = [...log.matchAll(re)];
    if (all.length) return all[all.length - 1][1];
    await sleep(250);
  }
  throw new Error(`no code for ${email}`);
}

async function login(email, client = "IOS") {
  const r1 = await call("POST", "/api/auth/email/request", { body: { email } });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  const code = await codeFor(email);
  const r2 = await call("POST", "/api/auth/email/verify", { body: { email, code, client } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  return { ...r2, code };
}

async function customer(email) {
  const r = await login(email, "WEB");
  r.data.token = "cookie:" + r.headers.get("set-cookie").split(";")[0];
  return r;
}

const ok = (name) => console.log(`✔ ${name}`);

const admin = await login("admin@chebustore.ru");
assert.equal(admin.data.user.role, "ADMIN");
const A = admin.data.token;
ok("admin login via email code, bootstrap role ADMIN");

const reuse = await call("POST", "/api/auth/email/verify", { body: { email: "admin@chebustore.ru", code: admin.code, client: "IOS" } });
assert.equal(reuse.status, 400);
ok("one-time code cannot be reused");

const cats = await call("GET", "/api/admin/categories", { token: A });
const hoodies = cats.data.categories.find((c) => c.slug === "hoodies");
const created = await call("POST", "/api/admin/products", {
  token: A,
  body: { title: "Худи оверсайз", description: "Хлопок 100%", categoryId: hoodies.id, basePrice: 499000, oldPrice: 599000 },
});
assert.equal(created.status, 200, JSON.stringify(created.data));
const productId = created.data.product.id;
const variants = await call("PUT", `/api/admin/products/${productId}/variants`, {
  token: A,
  body: { variants: [{ size: "M", stock: 2 }, { size: "L", stock: 1, price: 519000 }, { size: "XL", stock: 0 }] },
});
assert.equal(variants.data.product.variants.length, 3);
ok("admin creates product with variants");

const png = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#777" } }).jpeg().toBuffer();
const fd = new FormData();
fd.append("file", new Blob([png], { type: "image/jpeg" }), "photo.jpg");
const up = await call("POST", `/api/admin/products/${productId}/images`, { token: A, form: fd });
assert.equal(up.status, 200, JSON.stringify(up.data));
const imgUrl = up.data.product.images[0].url;
const media = await fetch(BASE + imgUrl);
assert.equal(media.status, 200);
assert.equal(media.headers.get("content-type"), "image/webp");
ok("product image upload → re-encoded webp served");

const fakeImg = new FormData();
fakeImg.append("file", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "image/png" }), "x.png");
const bad = await call("POST", `/api/admin/products/${productId}/images`, { token: A, form: fakeImg });
assert.equal(bad.status, 400);
ok("non-image disguised as png rejected");

const pay = await call("PUT", "/api/admin/settings/payment", {
  token: A,
  body: { sbpPhone: "+7 900 123-45-67", sbpBank: "tbank", cardNumber: "2200 1234 5678 9012", cardBank: "Сбербанк", recipientName: "Иван И.", instructions: "", paymentWindowHours: 24 },
});
assert.equal(pay.status, 200, JSON.stringify(pay.data));
assert.equal(pay.data.payment.cardBank, "sber");
ok("admin sets payment details, legacy bank names mapped to bank list");

const list = await call("GET", "/api/products?category=hoodies");
assert.equal(list.data.products.length, 1);
const pub = list.data.products[0];
assert.equal(pub.variants.find((v) => v.size === "XL").available, false);
assert.equal(JSON.stringify(pub).includes('"stock"'), false);
ok("public catalog hides exact stock");

const cfg = await call("GET", "/api/config");
assert.equal(JSON.stringify(cfg.data).includes("2200"), false);
ok("public config does not leak payment details");

const cust = await customer("buyer@example.com");
const C = cust.data.token;
assert.equal(cust.data.user.role, "CUSTOMER");

const forbidden = await call("GET", "/api/admin/orders", { token: C });
assert.equal(forbidden.status, 403);
const forbiddenPay = await call("PUT", "/api/admin/settings/payment", { token: C, body: {} });
assert.equal(forbiddenPay.status, 403);
ok("customer cannot access admin API");

await call("POST", "/api/auth/email/request", { body: { email: "app-buyer@example.com" } });
const appDenied = await call("POST", "/api/auth/email/verify", {
  body: { email: "app-buyer@example.com", code: await codeFor("app-buyer@example.com"), client: "IOS" },
});
assert.equal(appDenied.status, 403);
assert.equal(appDenied.data.error.code, "staff_only");
ok("iOS admin app refuses non-staff accounts");

const noAuth = await call("GET", "/api/cart");
assert.equal(noAuth.status, 401);
const garbage = await call("GET", "/api/cart", { token: "garbage" });
assert.equal(garbage.status, 401);
ok("unauthenticated / invalid token rejected");

const M = pub.variants.find((v) => v.size === "M");
const tooMany = await call("PUT", "/api/cart/items", { token: C, body: { variantId: M.id, quantity: 5 } });
assert.equal(tooMany.status, 400);
const addM = await call("PUT", "/api/cart/items", { token: C, body: { variantId: M.id, quantity: 2 } });
assert.equal(addM.data.count, 2);
assert.equal(addM.data.itemsTotal, 998000);
ok("cart respects stock, server computes totals");

const order = await call("POST", "/api/orders", {
  token: C,
  body: { contactName: "Покупатель Тест", contactPhone: "+7 999 111-22-33", deliveryMethod: "CDEK", deliveryAddress: "Москва, ул. Тестовая, 1" },
});
assert.equal(order.status, 200, JSON.stringify(order.data));
const O = order.data.order;
assert.equal(O.status, "AWAITING_PAYMENT");
assert.equal(O.total, 998000 + 50000);
assert.equal(O.payment.cardNumber, "2200 1234 5678 9012");
ok(`checkout → order №${O.number}, stock reserved, requisites shown`);

const after = await call("GET", "/api/products/" + pub.slug);
assert.equal(after.data.product.variants.find((v) => v.size === "M").available, false);
ok("stock decremented after checkout");

const other = await customer("other@example.com");
const peek = await call("GET", `/api/orders/${O.number}`, { token: other.data.token });
assert.equal(peek.status, 404);
const peekReceipt = await call("POST", `/api/orders/${O.number}/receipt`, { token: other.data.token, form: new FormData() });
assert.equal(peekReceipt.status, 404);
ok("other users cannot see or pay someone else's order (IDOR)");

const receipt = new FormData();
receipt.append("file", new Blob([png], { type: "image/jpeg" }), "receipt.jpg");
const rc = await call("POST", `/api/orders/${O.number}/receipt`, { token: C, form: receipt });
assert.equal(rc.status, 200, JSON.stringify(rc.data));
assert.equal(rc.data.order.status, "PAYMENT_REVIEW");
const rid = rc.data.order.receipts[0].id;
const ownFile = await call("GET", `/api/orders/${O.number}/receipts/${rid}`, { token: C });
assert.equal(ownFile.status, 200);
assert.equal(ownFile.headers.get("cache-control"), "private, no-store");
const otherFile = await call("GET", `/api/admin/receipts/${rid}`, { token: other.data.token });
assert.equal(otherFile.status, 403);
ok("receipt upload → PAYMENT_REVIEW; receipt private");

const rej = await call("POST", `/api/admin/orders/${O.number}/reject`, { token: A, body: { reason: "Сумма не совпадает" } });
assert.equal(rej.status, 200, JSON.stringify(rej.data));
let st = await call("GET", `/api/orders/${O.number}`, { token: C });
assert.equal(st.data.order.status, "AWAITING_PAYMENT");
assert.equal(st.data.order.rejectReason, "Сумма не совпадает");
const rc2 = new FormData();
rc2.append("file", new Blob([png], { type: "image/jpeg" }), "receipt2.jpg");
await call("POST", `/api/orders/${O.number}/receipt`, { token: C, form: rc2 });
const appr = await call("POST", `/api/admin/orders/${O.number}/approve`, { token: A });
assert.equal(appr.status, 200, JSON.stringify(appr.data));
st = await call("GET", `/api/orders/${O.number}`, { token: C });
assert.equal(st.data.order.status, "ASSEMBLING");
assert.equal(st.data.order.payment, null);
ok("reject → re-upload → approve → ASSEMBLING; requisites hidden after payment");

const cancelPaid = await call("POST", `/api/orders/${O.number}/cancel`, { token: C });
assert.equal(cancelPaid.status, 409);
ok("customer cannot cancel a paid order");

const skip = await call("POST", `/api/admin/orders/${O.number}/status`, { token: A, body: { to: "COMPLETED" } });
assert.equal(skip.status, 409);
for (const [to, extra] of [["SHIPPED", { trackingNumber: "CDEK123" }], ["READY_FOR_PICKUP", { pickupInfo: "ПВЗ на Ленина, 5" }], ["COMPLETED", {}]]) {
  const r = await call("POST", `/api/admin/orders/${O.number}/status`, { token: A, body: { to, ...extra } });
  assert.equal(r.status, 200, `${to}: ${JSON.stringify(r.data)}`);
}
st = await call("GET", `/api/orders/${O.number}`, { token: C });
assert.equal(st.data.order.status, "COMPLETED");
assert.equal(st.data.order.history.length, 8);
ok("status flow: собирается → в доставке → можно забрать → получен (invalid jumps blocked)");

const L = pub.variants.find((v) => v.size === "L");
await call("PUT", "/api/cart/items", { token: C, body: { variantId: L.id, quantity: 1 } });
const o2 = await call("POST", "/api/orders", { token: C, body: { contactName: "Покупатель", contactPhone: "+79991112233", deliveryMethod: "HAND" } });
assert.equal(o2.data.order.total, 519000);
const c2 = await call("POST", `/api/orders/${o2.data.order.number}/cancel`, { token: C });
assert.equal(c2.data.order.status, "CANCELLED");
const again = await call("GET", "/api/products/" + pub.slug);
assert.equal(again.data.product.variants.find((v) => v.size === "L").available, true);
ok("variant price override used; cancel returns stock");

const resend = await call("POST", "/api/auth/email/request", { body: { email: "buyer@example.com" } });
assert.ok(resend.data.resendIn > 0);
ok("resend cooldown enforced");

const web = await login("web@example.com", "WEB");
const setCookie = web.headers.get("set-cookie");
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /SameSite=Lax/i);
assert.equal(web.data.token, undefined);
const cookie = setCookie.split(";")[0];
const me = await call("GET", "/api/auth/me", { cookie });
assert.equal(me.data.user.email, "web@example.com");
const noCsrf = await call("PUT", "/api/cart/items", { cookie, csrf: false, body: { variantId: L.id, quantity: 1 } });
assert.equal(noCsrf.status, 403);
const evil = await call("PUT", "/api/cart/items", { cookie, origin: "https://evil.example", body: { variantId: L.id, quantity: 1 } });
assert.equal(evil.status, 403);
const good = await call("PUT", "/api/cart/items", { cookie, body: { variantId: L.id, quantity: 1 } });
assert.equal(good.status, 200);
ok("web: httpOnly cookie, token not exposed to JS, CSRF enforced");

await call("POST", "/api/auth/email/request", { body: { email: "victim@example.com" } });
let last;
for (let i = 0; i < 6; i++) {
  last = await call("POST", "/api/auth/email/verify", { body: { email: "victim@example.com", code: "000000", client: "IOS" } });
}
assert.equal(last.status, 429);
ok("code brute-force locked after 5 attempts");

const sessions = await call("GET", "/api/account/sessions", { cookie });
assert.equal(sessions.data.sessions.length, 1);
assert.equal(sessions.data.sessions[0].current, true);
await call("POST", "/api/auth/logout", { cookie });
const revoked = await call("GET", "/api/auth/me", { cookie });
assert.equal(revoked.data.user, null);
ok("logout revokes session server-side (stolen cookie useless)");

const users = await call("GET", "/api/admin/users?q=other@example.com", { token: A });
const otherId = users.data.users[0].id;
await call("PATCH", `/api/admin/users/${otherId}`, { token: A, body: { isBlocked: true } });
const blocked = await call("GET", "/api/cart", { token: other.data.token });
assert.equal(blocked.status, 401);
const selfDemote = await call("PATCH", `/api/admin/users/${admin.data.user.id}`, { token: A, body: { role: "CUSTOMER" } });
assert.equal(selfDemote.status, 400);
ok("blocking user revokes sessions; admin cannot demote self");

const prisma = new PrismaClient();
const tgStart = await call("POST", "/api/auth/telegram/bot/start", { body: { client: "WEB" } });
assert.equal(tgStart.status, 200, JSON.stringify(tgStart.data));
assert.match(tgStart.data.url, /^https:\/\/t\.me\/.+\?start=login_[A-Za-z0-9_-]{22}$/);
const pending = await call("POST", "/api/auth/telegram/bot/poll", { body: { id: tgStart.data.id, secret: tgStart.data.secret } });
assert.equal(pending.data.status, "pending");
const wrongSecret = await call("POST", "/api/auth/telegram/bot/poll", { body: { id: tgStart.data.id, secret: "x".repeat(43) } });
assert.equal(wrongSecret.status, 400);
await prisma.telegramLogin.update({
  where: { publicId: tgStart.data.id },
  data: { status: "CONFIRMED", telegramId: 777000111n, tgUsername: "tgbuyer", tgFirstName: "Тест" },
});
const tgDone = await call("POST", "/api/auth/telegram/bot/poll", { body: { id: tgStart.data.id, secret: tgStart.data.secret } });
assert.equal(tgDone.data.status, "ok", JSON.stringify(tgDone.data));
assert.equal(tgDone.data.user.telegramUsername, "tgbuyer");
assert.equal(tgDone.data.token, undefined);
assert.match(tgDone.headers.get("set-cookie") ?? "", /HttpOnly/i);
const tgReplay = await call("POST", "/api/auth/telegram/bot/poll", { body: { id: tgStart.data.id, secret: tgStart.data.secret } });
assert.equal(tgReplay.status, 400);
ok("telegram bot login: secret-bound, one-time, httpOnly cookie");

const tgIos = await call("POST", "/api/auth/telegram/bot/start", { body: { client: "IOS" } });
await prisma.telegramLogin.update({ where: { publicId: tgIos.data.id }, data: { status: "CONFIRMED", telegramId: 777000111n } });
const tgIosDenied = await call("POST", "/api/auth/telegram/bot/poll", { body: { id: tgIos.data.id, secret: tgIos.data.secret } });
assert.equal(tgIosDenied.status, 403);
assert.equal(tgIosDenied.data.error.code, "staff_only");
ok("telegram bot login into iOS admin app refused for customers");
await prisma.$disconnect();

const audit = await call("GET", "/api/admin/audit", { token: A });
assert.ok(audit.data.logs.some((l) => l.action === "payment.approve"));
ok(`audit log recorded ${audit.data.logs.length} actions`);

const stats = await call("GET", "/api/admin/stats", { token: A });
assert.equal(stats.data.revenue.day.sum, 1048000);
ok("dashboard revenue correct");

console.log("\nВсе e2e-проверки пройдены");
