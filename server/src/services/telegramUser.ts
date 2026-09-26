import { randomBytes } from "node:crypto";
import { StringSession } from "telegram/sessions/index.js";
import { TelegramClient } from "telegram";
import { Api } from "telegram";
import { badRequest, tooMany } from "../lib/errors.js";

interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  createdAt: number;
}

const pending = new Map<string, PendingLogin>();
const LOGIN_TTL = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.createdAt > LOGIN_TTL) {
      pending.delete(id);
      void p.client.disconnect().catch(() => undefined);
    }
  }
}

function human(e: unknown) {
  const msg = (e as { errorMessage?: string; message?: string }).errorMessage || (e as Error).message || "";
  if (msg.includes("PHONE_NUMBER_INVALID")) return "Номер не найден в Telegram. Пишите в международном виде, например +79001234567";
  if (msg.includes("PHONE_CODE_INVALID")) return "Неверный код";
  if (msg.includes("PHONE_CODE_EXPIRED")) return "Код истёк, запросите новый";
  if (msg.includes("PASSWORD_HASH_INVALID")) return "Неверный пароль двухэтапной защиты";
  if (msg.includes("FLOOD")) return "Telegram ограничил попытки входа. Подождите и попробуйте позже";
  if (msg.includes("API_ID_INVALID") || msg.includes("API_ID_PUBLISHED_FLOOD")) return "api_id или api_hash неверные. Возьмите их на my.telegram.org";
  return msg.slice(0, 200) || "Не удалось войти в Telegram";
}

async function clientOf(apiId: number, apiHash: string, session = "") {
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 2,
    useWSS: true,
    deviceModel: "CHEBU",
    appVersion: "1",
  });
  await client.connect();
  return client;
}

export async function beginTelegramLogin(apiId: number, apiHash: string, phone: string) {
  sweep();
  if (pending.size >= 5) throw tooMany("Слишком много незавершённых входов");
  let client: TelegramClient;
  try {
    client = await clientOf(apiId, apiHash);
    const sent = await client.sendCode({ apiId, apiHash }, phone);
    const id = randomBytes(16).toString("base64url");
    pending.set(id, { client, phone, phoneCodeHash: sent.phoneCodeHash, createdAt: Date.now() });
    return { loginId: id, viaApp: sent.isCodeViaApp };
  } catch (e) {
    throw badRequest(human(e));
  }
}

export async function finishTelegramLogin(loginId: string, code: string, password?: string) {
  const p = pending.get(loginId);
  if (!p || Date.now() - p.createdAt > LOGIN_TTL) throw badRequest("Вход устарел, запросите код ещё раз");
  try {
    try {
      await p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: code }));
    } catch (e) {
      const msg = (e as { errorMessage?: string }).errorMessage ?? "";
      if (msg !== "SESSION_PASSWORD_NEEDED") throw e;
      if (!password) return { needsPassword: true as const };
      await p.client.signInWithPassword(
        { apiId: p.client.apiId, apiHash: p.client.apiHash },
        { password: async () => password, onError: async () => false },
      );
    }
    const session = String(p.client.session.save());
    pending.delete(loginId);
    await p.client.disconnect();
    return { needsPassword: false as const, session };
  } catch (e) {
    throw badRequest(human(e));
  }
}

export async function sessionWorks(apiId: number, apiHash: string, session: string) {
  const client = await clientOf(apiId, apiHash, session);
  try {
    await client.getMe();
    return true;
  } finally {
    await client.disconnect();
  }
}
