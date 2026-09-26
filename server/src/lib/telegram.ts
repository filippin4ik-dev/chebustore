import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramIdentity {
  id: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  authDate: number;
  hash: string;
}

function hexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function checkAge(authDate: number, maxAgeSec: number, now: number) {
  if (!Number.isFinite(authDate) || authDate <= 0) return false;
  const age = now - authDate;
  return age <= maxAgeSec && age >= -60;
}

export function verifyWebAppInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  now = Math.floor(Date.now() / 1000),
): TelegramIdentity | null {
  if (initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  if (!hexEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!checkAge(authDate, maxAgeSec, now)) return null;

  let user: Record<string, unknown>;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return null;
  }
  const idStr = String(user.id ?? "");
  if (!/^\d{1,20}$/.test(idStr)) return null;

  return {
    id: BigInt(idStr),
    username: typeof user.username === "string" ? user.username : undefined,
    firstName: typeof user.first_name === "string" ? user.first_name : undefined,
    lastName: typeof user.last_name === "string" ? user.last_name : undefined,
    photoUrl: typeof user.photo_url === "string" ? user.photo_url : undefined,
    authDate,
    hash,
  };
}
