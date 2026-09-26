import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { unavailable } from "./errors.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

function explainMailError(e: unknown): never {
  transporter = null;
  const err = e as { code?: string; responseCode?: number; message?: string };
  const code = err.code ?? "";
  const response = err.responseCode ?? 0;
  console.error(`smtp failed: ${code || response} ${(err.message ?? "").slice(0, 180)}`);
  if (code === "EAUTH" || response === 535 || response === 534) {
    throw unavailable("Почта отклонила логин или пароль ящика. В .env укажите полный адрес и пароль этого ящика, затем docker compose up -d");
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "EDNS" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    /timed out|ECONNREFUSED|connect/i.test(err.message ?? "")
  ) {
    throw unavailable(
      "Почтовый сервер не отвечает. На Timeweb Cloud исходящие порты 465 и 587 закрыты по умолчанию: откройте их в панели сервера и повторите",
    );
  }
  throw unavailable("Не удалось отправить письмо. Проверьте SMTP в .env и выполните docker compose up -d");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;color:#1c1c1e">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<div style="font-weight:700;font-size:17px;line-height:32px"><img src="${config.PUBLIC_URL}/logo-192.jpg" width="32" height="32" alt="" style="border-radius:50%;vertical-align:middle;margin-right:10px">CHEBU</div>
<div style="background:#fff;border-radius:14px;padding:24px;margin-top:16px">
<div style="font-size:20px;font-weight:600;margin-bottom:12px">${escapeHtml(title)}</div>
${body}
</div>
<div style="font-size:12px;color:#8e8e93;margin-top:16px">Письмо отправлено автоматически, отвечать на него не нужно.</div>
</div></body></html>`;
}

export async function sendMail(to: string, subject: string, title: string, bodyHtml: string, text: string) {
  const t = getTransporter();
  if (!t) {
    if (config.isProd) throw new Error("SMTP не настроен");
    console.info(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  try {
    await t.sendMail({ from: config.MAIL_FROM, to, subject, text, html: layout(title, bodyHtml) });
  } catch (e) {
    explainMailError(e);
  }
}

export async function sendLoginCode(to: string, code: string) {
  await sendMail(
    to,
    `Код входа: ${code}`,
    "Код для входа",
    `<div style="font-size:34px;font-weight:700;letter-spacing:.3em;margin:8px 0 16px">${code}</div>
<div style="font-size:15px;color:#3a3a3c">Код действует ${config.emailCodeTtlMin} минут. Если вы не запрашивали вход — просто проигнорируйте письмо, никто не получит доступ без этого кода.</div>`,
    `Код для входа в CHEBU: ${code}\nДействует ${config.emailCodeTtlMin} минут. Никому его не сообщайте.`,
  );
}

export async function sendOrderUpdate(to: string, orderNumber: number, statusText: string, note: string) {
  const link = `${config.PUBLIC_URL}/orders/${orderNumber}`;
  await sendMail(
    to,
    `Заказ №${orderNumber}: ${statusText}`,
    `Заказ №${orderNumber}`,
    `<div style="font-size:17px;margin-bottom:8px">${escapeHtml(statusText)}</div>
${note ? `<div style="font-size:15px;color:#3a3a3c;margin-bottom:16px">${escapeHtml(note)}</div>` : ""}
<a href="${link}" style="display:inline-block;background:#1c1c1e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">Открыть заказ</a>`,
    `Заказ №${orderNumber}: ${statusText}\n${note}\n${link}`,
  );
}
