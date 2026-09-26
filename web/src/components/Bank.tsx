import { useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import type { Bank } from "../lib/types";
import { Icon } from "./Icon";
import { Sheet } from "./ui";

export function useBank(id: string | null | undefined): Bank | null {
  const { config } = useAuth();
  if (!id) return null;
  return config?.banks.find((b) => b.id === id) ?? null;
}

export function BankAvatar({ bank, size = 28 }: { bank: Bank; size?: number }) {
  const scale = bank.short.length >= 4 ? 0.28 : bank.short.length === 3 ? 0.32 : bank.short.length === 2 ? 0.38 : 0.46;
  return (
    <span
      className="bank-ava"
      aria-hidden
      style={{ width: size, height: size, background: bank.bg, color: bank.fg, fontSize: Math.round(size * scale) }}
    >
      {bank.short}
    </span>
  );
}

export function BankName({ id, fallback }: { id: string; fallback?: string }) {
  const bank = useBank(id);
  if (!bank) return <>{fallback ?? id}</>;
  return (
    <span className="bank-name">
      <BankAvatar bank={bank} size={20} />
      {bank.name}
    </span>
  );
}

export function BankPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange(id: string): void;
  disabled?: boolean;
}) {
  const { config } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const banks = config?.banks ?? [];
  const current = banks.find((b) => b.id === value) ?? null;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? banks.filter((b) => b.name.toLowerCase().includes(s)) : banks;
  }, [banks, q]);

  return (
    <>
      <button type="button" className="field field-btn" onClick={() => setOpen(true)} disabled={disabled}>
        <label>{label}</label>
        <span className="field-value">
          {current ? (
            <>
              <BankAvatar bank={current} size={24} />
              {current.name}
            </>
          ) : (
            <span className="muted">Выбрать банк</span>
          )}
        </span>
        <span className="cell-chevron">
          <Icon name="chevronRight" size={18} />
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="search mb-12">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск банка" autoFocus />
        </div>
        <div className="list bank-list">
          {value && (
            <button
              type="button"
              className="cell"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <div className="cell-main muted">Не указывать</div>
            </button>
          )}
          {filtered.map((b) => (
            <button
              type="button"
              key={b.id}
              className="cell"
              onClick={() => {
                onChange(b.id);
                setOpen(false);
                setQ("");
              }}
            >
              <BankAvatar bank={b} size={32} />
              <div className="cell-main">{b.name}</div>
              {b.id === value && (
                <span className="accent-text">
                  <Icon name="check" size={20} stroke={2.4} />
                </span>
              )}
            </button>
          ))}
          {!filtered.length && <div className="cell muted">Ничего не нашлось</div>}
        </div>
      </Sheet>
    </>
  );
}
