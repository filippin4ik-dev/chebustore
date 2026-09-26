interface TgWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  platform: string;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(event: string, cb: () => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  disableVerticalSwipes?: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

const FLAG = "cs_tg_miniapp";

function launchedFromTelegram() {
  if (location.hash.includes("tgWebAppData") || location.search.includes("tgWebAppStartParam")) {
    sessionStorage.setItem(FLAG, "1");
    return true;
  }
  return sessionStorage.getItem(FLAG) === "1";
}

let webApp: TgWebApp | null = null;

export async function initTelegram(): Promise<TgWebApp | null> {
  if (!launchedFromTelegram()) return null;
  await new Promise<void>((resolve) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  const app = window.Telegram?.WebApp;
  if (!app || !app.initData) {
    sessionStorage.removeItem(FLAG);
    return null;
  }
  webApp = app;
  const applyTheme = () => {
    document.documentElement.dataset.theme = app.colorScheme;
    syncTelegramChrome();
  };
  applyTheme();
  app.onEvent("themeChanged", applyTheme);
  app.ready();
  app.expand();
  app.disableVerticalSwipes?.();
  return app;
}

export function syncTelegramChrome() {
  if (!webApp) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const color = /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : webApp.colorScheme === "dark" ? "#000000" : "#f2f2f7";
  try {
    webApp.setHeaderColor(color);
    webApp.setBackgroundColor(color);
  } catch {
    return;
  }
}

export const tg = () => webApp;
export const isMiniApp = () => webApp !== null;

export function haptic(kind: "success" | "error" | "light" | "select") {
  const h = webApp?.HapticFeedback;
  if (!h) return;
  if (kind === "success" || kind === "error") h.notificationOccurred(kind);
  else if (kind === "select") h.selectionChanged();
  else h.impactOccurred("light");
}
