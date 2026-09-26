import type { DeliveryMethod, OrderStatus } from "./types";

export function rub(kopecks: number) {
  const value = kopecks / 100;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: value % 1 ? 2 : 0 })} ₽`;
}

export function date(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "срок истёк";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "Ожидает оплаты",
  PAYMENT_REVIEW: "Проверяем оплату",
  ASSEMBLING: "Собирается",
  SHIPPED: "В доставке",
  READY_FOR_PICKUP: "Можно забрать",
  COMPLETED: "Получен",
  CANCELLED: "Отменён",
};

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: "Самовывоз",
  COURIER: "Курьер",
  POST: "Почта / ПВЗ",
};

const PROGRESS: OrderStatus[] = ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "ASSEMBLING", "SHIPPED", "READY_FOR_PICKUP", "COMPLETED"];

export function progressStep(status: OrderStatus) {
  if (status === "CANCELLED") return 0;
  return Math.max(0, PROGRESS.indexOf(status));
}

export function userName(u: { firstName: string | null; lastName: string | null; email: string | null; telegramUsername: string | null }) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return name || (u.telegramUsername ? `@${u.telegramUsername}` : u.email) || "Покупатель";
}

export function clientLabel(client: "WEB" | "MINIAPP" | "IOS", ua: string | null) {
  if (client === "MINIAPP") return "Telegram Mini App";
  if (client === "IOS") return "Приложение iPhone";
  if (!ua) return "Браузер";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /YaBrowser/.test(ua)
      ? "Яндекс Браузер"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Браузер";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "";
  return os ? `${browser}, ${os}` : browser;
}

export const toKopecks = (rubles: string) => Math.round(parseFloat(rubles.replace(",", ".").replace(/\s/g, "") || "0") * 100);
export const toRubles = (kopecks: number | null | undefined) => (kopecks == null ? "" : String(kopecks / 100));
