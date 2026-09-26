import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return transporter;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;color:#1c1c1e">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<div style="font-weight:700;font-size:15px;letter-spacing:.08em">ЧЕБУ STORE</div>
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
  await t.sendMail({ from: config.MAIL_FROM, to, subject, text, html: layout(title, bodyHtml) });
}

export async function sendLoginCode(to: string, code: string) {
  await sendMail(
    to,
    `Код входа: ${code}`,
    "Код для входа",
    `<div style="font-size:34px;font-weight:700;letter-spacing:.3em;margin:8px 0 16px">${code}</div>
<div style="font-size:15px;color:#3a3a3c">Код действует ${config.emailCodeTtlMin} минут. Если вы не запрашивали вход — просто проигнорируйте письмо, никто не получит доступ без этого кода.</div>`,
    `Код для входа в ЧЕБУ STORE: ${code}\nДействует ${config.emailCodeTtlMin} минут. Никому его не сообщайте.`,
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
