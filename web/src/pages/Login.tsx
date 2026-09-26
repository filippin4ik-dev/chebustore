import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { EmailCodeForm } from "../components/EmailCodeForm";
import { takeTelegramRedirectResult, TelegramLogin, type TelegramAuthData } from "../components/TelegramLogin";
import { NavBar } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import type { User } from "../lib/types";

export function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default function Login() {
  const { user, setUser, config, miniApp, refreshCart } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<"telegram" | "email">("telegram");

  useEffect(() => {
    const redirected = takeTelegramRedirectResult();
    if (redirected) void onTelegram(redirected);
  }, []);

  if (user) return <Navigate to={next} replace />;

  if (miniApp) {
    return (
      <>
        <NavBar title="Вход" />
        <div className="page-center">
          <div className="title-3">Не удалось войти через Telegram</div>
          <div className="subhead muted">Закройте и откройте магазин заново из чата с ботом.</div>
        </div>
      </>
    );
  }

  async function done(u: User) {
    setUser(u);
    await refreshCart().catch(() => undefined);
    navigate(next, { replace: true });
  }

  async function onTelegram(data: TelegramAuthData) {
    try {
      const r = await api.post<{ user: User }>("/auth/telegram/widget", { data, client: "WEB" });
      await done(r.user);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось войти", true);
    }
  }

  return (
    <>
      <NavBar title="Вход" back />
      <div className="container narrow" style={{ maxWidth: 420 }}>
        <img className="logo mt-16" src="/logo-192.jpg" alt="CHEBU" width={72} height={72} />
        <h1 className="large-title">Вход</h1>
        <p className="subhead muted" style={{ marginTop: 0 }}>
          Один аккаунт для сайта, Telegram и приложения на iPhone.
        </p>
        <div className="segmented mt-16">
          <button className={tab === "telegram" ? "active" : ""} onClick={() => setTab("telegram")}>
            Telegram
          </button>
          <button className={tab === "email" ? "active" : ""} onClick={() => setTab("email")}>
            Почта
          </button>
        </div>
        <div className="mt-24">
          {tab === "telegram" ? (
            <div className="stack">
              {config?.botUsername ? (
                <TelegramLogin botUsername={config.botUsername} onAuth={onTelegram} />
              ) : (
                <div className="footnote center">Вход через Telegram временно недоступен</div>
              )}
              <div className="footnote center">
                Нажмите кнопку и подтвердите вход в Telegram. Мы получим только имя и username — без доступа к перепискам.
              </div>
            </div>
          ) : (
            <EmailCodeForm mode="login" onDone={done} />
          )}
        </div>
      </div>
    </>
  );
}
