import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { config } from "../config.js";

export type ApnsEnvironment = "SANDBOX" | "PRODUCTION";

const HOSTS: Record<ApnsEnvironment, string> = {
  SANDBOX: "https://api.sandbox.push.apple.com",
  PRODUCTION: "https://api.push.apple.com",
};

let key: KeyObject | null | undefined;

function privateKey(): KeyObject | null {
  if (key !== undefined) return key;
  const raw = config.APNS_KEY?.trim();
  if (!raw) return (key = null);
  const body = raw
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const pem = `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
  try {
    key = createPrivateKey(pem);
  } catch {
    console.warn("APNS_KEY не удалось прочитать — пуш-уведомления отключены");
    key = null;
  }
  return key;
}

export const apnsConfigured = () => Boolean(config.APNS_KEY_ID && config.APNS_TEAM_ID && privateKey());

let jwt: { value: string; issuedAt: number } | null = null;

export function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (jwt && now - jwt.issuedAt < 40 * 60) return jwt.value;
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${part({ alg: "ES256", kid: config.APNS_KEY_ID })}.${part({ iss: config.APNS_TEAM_ID, iat: now })}`;
  const signature = sign("sha256", Buffer.from(data), { key: privateKey()!, dsaEncoding: "ieee-p1363" });
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

export function sendApns(env: ApnsEnvironment, deviceToken: string, payload: object): Promise<ApnsResult> {
  return new Promise((resolve) => {
    let req;
    try {
      const body = JSON.stringify(payload);
      req = session(env).request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${providerToken()}`,
        "apns-topic": config.APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        "content-type": "application/json",
      });
      req.end(body);
    } catch (e) {
      resolve({ ok: false, status: 0, reason: (e as Error).message });
      return;
    }
    let status = 0;
    let data = "";
    const timer = setTimeout(() => {
      req.close(constants.NGHTTP2_CANCEL);
      resolve({ ok: false, status: 0, reason: "timeout" });
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
      resolve({ ok: status === 200, status, reason });
    });
    req.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, status: 0, reason: e.message });
    });
  });
}
