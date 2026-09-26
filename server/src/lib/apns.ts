import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { config } from "../config.js";
import { apnsKeyPlain, getApnsSettings } from "./settings.js";

export type ApnsEnvironment = "SANDBOX" | "PRODUCTION";

const HOSTS: Record<ApnsEnvironment, string> = {
  SANDBOX: "https://api.sandbox.push.apple.com",
  PRODUCTION: "https://api.push.apple.com",
};

export function normalizeApnsKey(raw: string) {
  const body = raw
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  if (!body) return "";
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

export function parseApnsKey(raw: string): KeyObject | null {
  const pem = normalizeApnsKey(raw);
  if (!pem) return null;
  try {
    return createPrivateKey(pem);
  } catch {
    return null;
  }
}

interface Creds {
  keyId: string;
  teamId: string;
  bundleId: string;
  key: KeyObject;
  source: "env" | "admin";
}

let creds: Creds | null | undefined;
let lastProblem: string | null = "Ключи Apple ещё не загружены";

export function resetApns() {
  creds = undefined;
  jwt = null;
  lastProblem = "Ключи Apple ещё не загружены";
}

function finish(keyId: string, teamId: string, bundleId: string, raw: string, source: "env" | "admin"): Creds | null {
  const missing = [!keyId && "Key ID", !teamId && "Team ID", !raw && "ключ .p8"].filter(Boolean);
  if (missing.length) {
    lastProblem =
      "Ключи Apple не заданы. Админка → Настройки → Уведомления на iPhone: вставьте Key ID, Team ID и содержимое файла .p8";
    return (creds = null);
  }
  if (!/^[A-Z0-9]{10}$/.test(keyId)) {
    lastProblem = "Key ID должен состоять из 10 латинских букв и цифр";
    return (creds = null);
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    lastProblem = "Team ID должен состоять из 10 латинских букв и цифр";
    return (creds = null);
  }
  const key = parseApnsKey(raw);
  if (!key) {
    lastProblem = "Ключ .p8 не читается. Вставьте файл целиком, вместе со строками BEGIN/END PRIVATE KEY";
    return (creds = null);
  }
  lastProblem = null;
  return (creds = { keyId, teamId, bundleId, key, source });
}

async function resolve(): Promise<Creds | null> {
  if (creds !== undefined) return creds;
  const envKey = config.APNS_KEY?.trim() ?? "";
  if (config.APNS_KEY_ID && config.APNS_TEAM_ID && envKey) {
    return finish(config.APNS_KEY_ID.trim().toUpperCase(), config.APNS_TEAM_ID.trim().toUpperCase(), config.APNS_BUNDLE_ID.trim(), envKey, "env");
  }
  const stored = await getApnsSettings();
  const keyId = stored.keyId.trim().toUpperCase();
  const teamId = stored.teamId.trim().toUpperCase();
  const bundleId = (stored.bundleId || config.APNS_BUNDLE_ID).trim();
  const raw = apnsKeyPlain(stored);
  return finish(keyId, teamId, bundleId, raw, "admin");
}

export const apnsConfigured = async () => Boolean(await resolve());

export async function apnsProblem() {
  await resolve();
  return lastProblem;
}

export async function apnsPublic() {
  const c = await resolve();
  if (!c) return { configured: false, keyId: "", teamId: "", bundleId: config.APNS_BUNDLE_ID, source: null as "env" | "admin" | null };
  return { configured: true, keyId: c.keyId, teamId: c.teamId, bundleId: c.bundleId, source: c.source };
}

const REASONS: Record<string, string> = {
  InvalidProviderToken: "Apple отклонил ключ: проверьте APNS_KEY_ID, APNS_TEAM_ID и что ключ создан с галочкой APNs",
  ExpiredProviderToken: "Apple отклонил ключ как устаревший, попробуйте ещё раз",
  TopicDisallowed: "Ключ не подходит для этого приложения: проверьте APNS_BUNDLE_ID и команду разработчика",
  BadTopic: "Неверный APNS_BUNDLE_ID — он должен совпадать с Bundle ID в Xcode",
  DeviceTokenNotForTopic: "Токен устройства от другого приложения: проверьте APNS_BUNDLE_ID",
  BadDeviceToken: "Apple не узнал устройство. Откройте приложение заново, чтобы оно обновило токен",
  Unregistered: "Приложение на этом iPhone больше не принимает уведомления. Откройте его заново",
  BadCertificateEnvironment: "Ключ создан не для той среды: при создании выберите Sandbox & Production",
};

export const explainApnsReason = (reason?: string) =>
  (reason && REASONS[reason]) ?? (reason ? `Apple вернул ошибку: ${reason}` : "Нет ответа от серверов Apple");

let jwt: { value: string; issuedAt: number } | null = null;

export async function providerToken() {
  const c = await resolve();
  if (!c) throw new Error(lastProblem ?? "apns");
  const now = Math.floor(Date.now() / 1000);
  if (jwt && now - jwt.issuedAt < 40 * 60) return jwt.value;
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${part({ alg: "ES256", kid: c.keyId })}.${part({ iss: c.teamId, iat: now })}`;
  const signature = sign("sha256", Buffer.from(data), { key: c.key, dsaEncoding: "ieee-p1363" });
  jwt = { value: `${data}.${signature.toString("base64url")}`, issuedAt: now };
  return jwt.value;
}

const sessions = new Map<ApnsEnvironment, ClientHttp2Session>();

function session(env: ApnsEnvironment) {
  const existing = sessions.get(env);
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const s = connect(HOSTS[env]);
  const drop = () => {
    if (sessions.get(env) === s) sessions.delete(env);
  };
  s.on("error", drop);
  s.on("close", drop);
  s.on("goaway", drop);
  s.setTimeout(10 * 60_000, () => s.close());
  s.unref();
  sessions.set(env, s);
  return s;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  reason?: string;
}

export async function sendApns(env: ApnsEnvironment, deviceToken: string, payload: object): Promise<ApnsResult> {
  let token: string;
  let topic: string;
  try {
    token = await providerToken();
    topic = (await resolve())!.bundleId;
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message };
  }
  return new Promise((done) => {
    let req;
    try {
      const body = JSON.stringify(payload);
      req = session(env).request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${token}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        "content-type": "application/json",
      });
      req.end(body);
    } catch (e) {
      done({ ok: false, status: 0, reason: (e as Error).message });
      return;
    }
    let status = 0;
    let data = "";
    const timer = setTimeout(() => {
      req.close(constants.NGHTTP2_CANCEL);
      done({ ok: false, status: 0, reason: "timeout" });
    }, 10_000);
    req.setEncoding("utf8");
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.on("data", (chunk: string) => {
      if (data.length < 4096) data += chunk;
    });
    req.on("end", () => {
      clearTimeout(timer);
      let reason: string | undefined;
      try {
        reason = (JSON.parse(data) as { reason?: string }).reason;
      } catch {
        reason = undefined;
      }
      if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") jwt = null;
      done({ ok: status === 200, status, reason });
    });
    req.on("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, status: 0, reason: e.message });
    });
  });
}
