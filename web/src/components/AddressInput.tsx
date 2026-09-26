import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

interface Suggestion {
  value: string;
  postalCode: string;
  city: string;
  hasHouse: boolean;
}

export function AddressInput({
  value,
  onChange,
  placeholder,
  withPostalCode,
}: {
  value: string;
  onChange(v: string): void;
  placeholder: string;
  withPostalCode?: boolean;
}) {
  const { config } = useAuth();
  const enabled = Boolean(config?.addressSuggest);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const skip = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setItems([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<{ suggestions: Suggestion[] }>("/address/suggest", { query: q });
        if (id !== seq.current) return;
        setItems(r.suggestions);
        setOpen(r.suggestions.length > 0);
      } catch {
        if (id === seq.current) setItems([]);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [value, enabled]);

  const pick = (s: Suggestion) => {
    const full = withPostalCode && s.postalCode && !s.value.startsWith(s.postalCode) ? `${s.postalCode}, ${s.value}` : s.value;
    skip.current = s.hasHouse;
    onChange(s.hasHouse ? full : `${s.value}, `);
    setHint(s.hasHouse ? null : "Добавьте дом и квартиру");
    setOpen(false);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setHint("Браузер не умеет определять местоположение");
      return;
    }
    setLocating(true);
    setHint(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await api.post<{ suggestions: Suggestion[] }>("/address/locate", {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
          if (r.suggestions.length) {
            setItems(r.suggestions);
            setOpen(true);
          } else setHint("Не нашли адрес рядом — введите вручную");
        } catch (e) {
          setHint(e instanceof ApiError ? e.message : "Не удалось определить адрес");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setHint("Разрешите доступ к геопозиции или введите адрес вручную");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="address">
      <div className="field">
        <textarea
          required
          minLength={5}
          maxLength={400}
          autoComplete="street-address"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ minHeight: 64 }}
        />
      </div>
      {enabled && (
        <button type="button" className="cell action locate-btn" onClick={locate} disabled={locating}>
          {locating ? <Spinner /> : <Icon name="pin" size={20} />}
          <div className="cell-main">Определить мой адрес</div>
        </button>
      )}
      {open && items.length > 0 && (
        <div className="suggest pop-in" role="listbox">
          {items.map((s) => (
            <button
              type="button"
              key={s.value}
              className="suggest-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
            >
              <Icon name="pin" size={16} />
              <span>
                {s.value}
                {s.postalCode && <span className="muted"> · {s.postalCode}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {hint && <div className="address-hint footnote">{hint}</div>}
    </div>
  );
}
