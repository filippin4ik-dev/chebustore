import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { STATUS_LABEL } from "../lib/format";
import { tg } from "../lib/telegram";
import { useToast } from "../lib/toast";
import type { OrderStatus } from "../lib/types";
import { Icon, type IconName } from "./Icon";

export function Spinner() {
  return <div className="spinner" aria-label="Загрузка" />;
}

export function PageLoader() {
  return (
    <div className="page-center">
      <Spinner />
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="page-center">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <div className="title-3">{title}</div>
      {text && <div className="subhead muted" style={{ maxWidth: 320 }}>{text}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Empty
      icon="close"
      title="Не получилось загрузить"
      text={message}
      action={
        retry && (
          <button className="btn small gray" onClick={retry}>
            Повторить
          </button>
        )
      }
    />
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge s-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function NavBar({ title, back, right }: { title?: string; back?: boolean | string; right?: ReactNode }) {
  const navigate = useNavigate();
  const webApp = tg();
  const goBack = useCallback(() => {
    if (typeof back === "string") navigate(back);
    else if (window.history.length > 1) navigate(-1);
    else navigate("/");
  }, [back, navigate]);

  useEffect(() => {
    if (!webApp) return;
    if (back) {
      webApp.BackButton.show();
      webApp.BackButton.onClick(goBack);
      return () => {
        webApp.BackButton.offClick(goBack);
        webApp.BackButton.hide();
      };
    }
    webApp.BackButton.hide();
  }, [webApp, back, goBack]);

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <div className="navbar-side">
          {back && !webApp && (
            <button className="nav-btn" onClick={goBack} aria-label="Назад">
              <Icon name="chevronLeft" size={26} stroke={2.2} />
              Назад
            </button>
          )}
        </div>
        <div className="navbar-title">{title}</div>
        <div className="navbar-side right">{right}</div>
      </div>
    </header>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        <div className="sheet-head">
          <span />
          <div className="headline">{title}</div>
          <div style={{ textAlign: "right" }}>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть" style={{ width: 30, height: 30 }}>
              <Icon name="close" size={16} stroke={2.4} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyValue({ label, value, display }: { label: ReactNode; value: string; display?: string }) {
  const toast = useToast();
  return (
    <div className="cell">
      <div className="cell-main">
        <div className="footnote">{label}</div>
        <div className="mono" style={{ marginTop: 2 }}>{display ?? value}</div>
      </div>
      <button
        className="copy"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => toast("Скопировано"),
            () => toast("Не удалось скопировать", true),
          );
        }}
      >
        Копировать
      </button>
    </div>
  );
}

export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<{ url: string; type: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    api
      .blobUrl(path)
      .then((r) => {
        url = r.url;
        setSrc(r);
      })
      .catch(() => setFailed(true));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (failed) return <div className="footnote">Файл недоступен</div>;
  if (!src) return <Spinner />;
  if (src.type === "application/pdf" || (src.type === "image/heic" && broken)) {
    const pdf = src.type === "application/pdf";
    return (
      <a className="btn small gray" href={src.url} download={`${alt}.${pdf ? "pdf" : "heic"}`}>
        <Icon name="doc" size={18} /> {pdf ? "Скачать PDF" : "Скачать фото (HEIC)"}
      </a>
    );
  }
  return (
    <a href={src.url} target="_blank" rel="noreferrer">
      <img src={src.url} alt={alt} className={className} onError={() => setBroken(true)} />
    </a>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return fnRef
      .current()
      .then((d) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const refresh = useCallback(
    () =>
      fnRef
        .current()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch(() => undefined),
    [],
  );
  useEffect(() => void reload(), deps);
  return { data, setData, error, loading, reload, refresh };
}

export function Stepper({ value, min = 0, max, onChange }: { value: number; min?: number; max: number; onChange(v: number): void }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Меньше">
        <Icon name={value <= 1 && min === 0 ? "trash" : "minus"} size={16} stroke={2} />
      </button>
      <span>{value}</span>
      <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Больше">
        <Icon name="plus" size={16} stroke={2} />
      </button>
    </div>
  );
}
