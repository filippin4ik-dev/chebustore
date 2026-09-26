import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function keyedHash(purpose: string, value: string): string {
  return createHmac("sha256", config.SERVER_SECRET).update(`${purpose}:${value}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function numericCode(digits = 6): string {
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, "0");
}

function purposeKey(purpose: string) {
  return createHash("sha256").update(`${purpose}:${config.SERVER_SECRET}`).digest();
}

export function seal(purpose: string, plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", purposeKey(purpose), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function open(purpose: string, sealed: string) {
  const [v, iv, enc, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("bad_seal");
  const d = createDecipheriv("aes-256-gcm", purposeKey(purpose), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
