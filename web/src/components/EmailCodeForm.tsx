import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { Spinner } from "./ui";

/** Passwordless email flow: request a one-time code, then confirm it (login or link to current account). */
export function EmailCodeForm({ mode, client = "WEB", onDone }: { mode: "login" | "link"; client?: "WEB"; onDone(user: User): void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const request = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ resendIn: number }>("/auth/email/request", { email });
      setResendIn(r.resendIn);
      setStep("code");
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === "login"
          ? await api.post<{ user: User }>("/auth/email/verify", { email, code: value, client })
          : await api.post<{ user: User }>("/account/link/email", { email, code: value });
      onDone(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (step === "email") {
    return (
      <form onSubmit={request} className="stack">
        <input
          className="input"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ background: "var(--surface)", height: 50 }}
        />
        {error && <div className="footnote" style={{ color: "var(--red)" }}>{error}</div>}
        <button className="btn block" disabled={busy || !email}>
          {busy ? <Spinner /> : "Получить код"}
        </button>
        <div className="footnote center">Пароль не нужен — пришлём одноразовый код на почту.</div>
      </form>
    );
  }

  return (
    <div className="stack">
      <div className="subhead center">
        Код отправлен на <b>{email}</b>
      </div>
      <input
        className="code-input"
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="••••••"
        value={code}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(v);
          if (v.length === 6) verify(v);
        }}
      />
      {error && <div className="footnote center" style={{ color: "var(--red)" }}>{error}</div>}
      {busy && (
        <div className="row-flex" style={{ justifyContent: "center" }}>
          <Spinner />
        </div>
      )}
      <div className="row-flex" style={{ justifyContent: "space-between" }}>
        <button className="link-btn subhead" onClick={() => setStep("email")}>
          Другая почта
        </button>
        <button className="link-btn subhead" disabled={resendIn > 0 || busy} onClick={() => request()} style={{ opacity: resendIn > 0 ? 0.4 : 1 }}>
          {resendIn > 0 ? `Отправить снова через ${resendIn} с` : "Отправить снова"}
        </button>
      </div>
    </div>
  );
}
