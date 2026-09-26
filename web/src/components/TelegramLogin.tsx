import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import type { User } from "../lib/types";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

interface LoginStart {
  id: string;
  secret: string;
  expiresAt: string;
  url: string;
  appUrl: string;
}

type PollResult = { status: "pending" } | { status: "ok" | "linked"; user: User };

export function TelegramLogin({ link = false, onDone }: { link?: boolean; onDone(user: User): void | Promise<void> }) {
  const [start, setStart] = useState<LoginStart | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const prepare = useCallback(async () => {
    setStart(null);
    try {
      setStart(await api.post<LoginStart>("/auth/telegram/bot/start", { client: "WEB", link }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось подготовить вход");
    }
  }, [link]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  useEffect(() => {
    if (!start) return;
    const ms = new Date(start.expiresAt).getTime() - Date.now() - 20_000;
    const t = setTimeout(() => {
      setWaiting(false);
      void prepare();
    }, Math.max(ms, 1000));
    return () => clearTimeout(t);
  }, [start, prepare]);

  useEffect(() => {
    if (!waiting || !start) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await api.post<PollResult>("/auth/telegram/bot/poll", { id: start.id, secret: start.secret });
        if (stopped) return;
        if (r.status === "pending") {
          timer = setTimeout(tick, 1500);
          return;
        }
        stopped = true;
        await done.current(r.user);
      } catch (e) {
        if (stopped) return;
        if (!(e instanceof ApiError) || e.status === 429 || e.status >= 500) {
          timer = setTimeout(tick, 4000);
          return;
        }
        setWaiting(false);
        setError(e.message);
        void prepare();
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [waiting, start, prepare]);

  if (waiting && start) {
    return (
      <div className="tg-wait fade-in">
        <div className="tg-wait-icon">
          <Icon name="telegram" size={30} />
          <span className="tg-wait-spin" />
        </div>
        <div className="headline">Подтвердите вход в Telegram</div>
        <div className="subhead muted">
          Бот прислал сообщение — нажмите в нём «Подтвердить вход». Эта страница обновится сама.
        </div>
        <a className="btn gray" href={start.url} target="_blank" rel="noopener noreferrer">
          Открыть Telegram ещё раз
        </a>
        <button className="btn plain" onClick={() => setWaiting(false)}>
          Отмена
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {start ? (
        <a
          className="btn tg-btn"
          href={start.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            setError(null);
            setWaiting(true);
          }}
        >
          <Icon name="telegram" size={22} />
          {link ? "Привязать Telegram" : "Войти через Telegram"}
        </a>
      ) : (
        <button className="btn tg-btn" disabled>
          <Spinner />
        </button>
      )}
      {error && <div className="footnote center danger-text">{error}</div>}
    </div>
  );
}
