import { useEffect, useRef } from "react";

export type TelegramAuthData = Record<string, string | number>;

declare global {
  interface Window {
    __csTelegramAuth?: (user: TelegramAuthData) => void;
  }
}

export function takeTelegramRedirectResult(): TelegramAuthData | null {
  const m = location.hash.match(/tgAuthResult=([A-Za-z0-9_\-+/=]+)/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const json = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(decodeURIComponent(escape(json)));
    return data && typeof data === "object" && data.hash ? (data as TelegramAuthData) : null;
  } catch {
    return null;
  }
}

export function TelegramLogin({ botUsername, onAuth }: { botUsername: string; onAuth(data: TelegramAuthData): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onAuth);
  cb.current = onAuth;

  useEffect(() => {
    const el = ref.current;
    if (!el || !botUsername) return;
    window.__csTelegramAuth = (user) => cb.current(user);
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-onauth", "__csTelegramAuth(user)");
    el.innerHTML = "";
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
      delete window.__csTelegramAuth;
    };
  }, [botUsername]);

  return <div ref={ref} className="tg-widget" />;
}
