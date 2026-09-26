import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmailCodeForm } from "../components/EmailCodeForm";
import { takeTelegramRedirectResult, TelegramLogin, type TelegramAuthData } from "../components/TelegramLogin";
import { Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { User } from "../lib/types";

export default function AppAuth() {
  const [params] = useSearchParams();
  const { user, setUser, config } = useAuth();
  const challenge = params.get("challenge") ?? "";
  const state = params.get("state") ?? "";
  const valid = /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^[A-Za-z0-9_-]{16,128}$/.test(state);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [tab, setTab] = useState<"telegram" | "email">(params.get("method") === "email" ? "email" : "telegram");
  const sent = useRef(false);

  useEffect(() => {
    if (!user || !valid || sent.current) return;
    sent.current = true;
    setRedirecting(true);
    api
      .post<{ redirect: string }>("/auth/app/code", { challenge, state })
      .then((r) => {
        setUser(null);
        window.location.replace(r.redirect);
      })
      .catch((e) => {
        setRedirecting(false);
        setError(e instanceof ApiError ? e.message : "Ошибка");
      });
  }, [user, valid, challenge, state, setUser]);

  async function onTelegram(data: TelegramAuthData) {
    try {
      const r = await api.post<{ user: User }>("/auth/telegram/widget", { data, client: "WEB" });
      setUser(r.user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось войти");
    }
  }

  useEffect(() => {
    const redirected = takeTelegramRedirectResult();
    if (redirected) void onTelegram(redirected);
  }, []);

  if (!valid) {
    return <div className="page-center subhead muted">Откройте вход из приложения CHEBU.</div>;
  }

  return (
    <div className="container narrow" style={{ maxWidth: 420 }}>
      <h1 className="large-title">Вход в CHEBU</h1>
      <p className="subhead muted" style={{ marginTop: 0 }}>
        Приложение для сотрудников магазина.
      </p>
      {redirecting ? (
        <div className="page-center">
          <Spinner />
          <div className="subhead muted">Возвращаемся в приложение…</div>
        </div>
      ) : (
        <>
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
              config?.botUsername && <TelegramLogin botUsername={config.botUsername} onAuth={onTelegram} />
            ) : (
              <EmailCodeForm mode="login" onDone={setUser} />
            )}
          </div>
          {error && <div className="footnote center mt-16" style={{ color: "var(--red)" }}>{error}</div>}
        </>
      )}
    </div>
  );
}
