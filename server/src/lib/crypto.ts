import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Keyed hash for values stored in DB (session tokens, one-time codes). */
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

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
