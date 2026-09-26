import { useEffect, useState } from "react";
import { BankPicker } from "../components/Bank";
import { ErrorState, PageLoader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DELIVERY_HINT, DELIVERY_LABEL, DELIVERY_ORDER, toKopecks, toRubles } from "../lib/format";
import { applyTheme, BG_DARK_MAX, BG_LIGHT_MIN, BG_PRESETS, luminance, onColor, THEME_PRESETS } from "../lib/theme";
import { useToast } from "../lib/toast";
import type { DeliveryMethod, PaymentSettings, StoreSettings } from "../lib/types";

export default function AdminSettings() {
  const { user, config } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "ADMIN";
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [payment, setPayment] = useState<PaymentSettings | null>(null);
  const [prices, setPrices] = useState<Record<DeliveryMethod, string>>({ CDEK: "", RUSSIAN_POST: "", HAND: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"store" | "payment" | null>(null);

  useEffect(() => {
    api
      .get<{ store: StoreSettings; payment: PaymentSettings | null }>("/admin/settings")
      .then((r) => {
        setStore(r.store);
        setPayment(r.payment);
        setPrices({
          CDEK: toRubles(r.store.deliveryPrices.CDEK),
          RUSSIAN_POST: toRubles(r.store.deliveryPrices.RUSSIAN_POST),
          HAND: toRubles(r.store.deliveryPrices.HAND),
        });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (store) applyTheme(store);
  }, [store?.accentLight, store?.accentDark, store?.bgLight, store?.bgDark]);

  useEffect(() => () => applyTheme(config?.theme), [config]);

  if (error) return <ErrorState message={error} />;
  if (!store) return <PageLoader />;

  const set = <K extends keyof StoreSettings>(k: K, v: StoreSettings[K]) => setStore({ ...store, [k]: v });

  const saveStore = async () => {
    setSaving("store");
    try {
      const r = await api.put<{ store: StoreSettings }>("/admin/settings/store", {
        ...store,
        deliveryPrices: {
          CDEK: toKopecks(prices.CDEK),
          RUSSIAN_POST: toKopecks(prices.RUSSIAN_POST),
          HAND: toKopecks(prices.HAND),
        },
      });
      setStore(r.store);
      if (config)
        config.theme = { accentLight: r.store.accentLight, accentDark: r.store.accentDark, bgLight: r.store.bgLight, bgDark: r.store.bgDark };
      toast("Настройки магазина сохранены");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const savePayment = async () => {
    if (!payment) return;
    setSaving("payment");
    try {
      const r = await api.put<{ payment: PaymentSettings }>("/admin/settings/payment", payment);
      setPayment(r.payment);
      toast("Реквизиты сохранены. Новые заказы получат их автоматически.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const p = <K extends keyof PaymentSettings>(k: K, v: PaymentSettings[K]) => payment && setPayment({ ...payment, [k]: v });
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const bgLightBad = luminance(store.bgLight) < BG_LIGHT_MIN;
  const bgDarkBad = luminance(store.bgDark) > BG_DARK_MAX;
  const paymentReady = payment ? Boolean(payment.sbpPhone.trim() || payment.cardNumber.trim()) : true;

  return (
    <div className="container narrow">
      <h1 className="large-title">Настройки</h1>

      {isAdmin && payment && (
        <>
          {!paymentReady && (
            <div className="banner warn mt-8">
              Реквизиты не заполнены — покупатели не смогут оформить заказ. Укажите телефон СБП или номер карты.
            </div>
          )}
          <div className="section">
            <div className="section-header">Реквизиты для оплаты</div>
            <div className="list">
              <div className="field">
                <label>СБП телефон</label>
                <input value={payment.sbpPhone} onChange={(e) => p("sbpPhone", e.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" />
              </div>
              <BankPicker label="Банк СБП" value={payment.sbpBank} onChange={(v) => p("sbpBank", v)} />
              <div className="field">
                <label>Номер карты</label>
                <input
                  value={payment.cardNumber}
                  onChange={(e) => p("cardNumber", e.target.value.replace(/[^\d ]/g, ""))}
                  placeholder="2200 0000 0000 0000"
                  inputMode="numeric"
                />
              </div>
              <BankPicker label="Банк карты" value={payment.cardBank} onChange={(v) => p("cardBank", v)} />
              <div className="field">
                <label>Получатель</label>
                <input value={payment.recipientName} onChange={(e) => p("recipientName", e.target.value)} placeholder="Иван И." />
              </div>
              <div className="field">
                <label>Срок оплаты, ч</label>
                <input
                  value={payment.paymentWindowHours}
                  inputMode="numeric"
                  onChange={(e) => p("paymentWindowHours", Number(e.target.value.replace(/\D/g, "")) || 1)}
                />
              </div>
              <div className="field">
                <textarea
                  value={payment.instructions}
                  onChange={(e) => p("instructions", e.target.value)}
                  maxLength={1000}
                  placeholder="Инструкция покупателю (необязательно)"
                  style={{ minHeight: 64 }}
                />
              </div>
            </div>
            <div className="section-footer">
              Реквизиты хранятся только на сервере и показываются покупателю лишь внутри его неоплаченного заказа. Изменение
              фиксируется в журнале.
            </div>
          </div>
          <button className="btn block" onClick={savePayment} disabled={saving !== null}>
            {saving === "payment" ? <Spinner /> : "Сохранить реквизиты"}
          </button>
        </>
      )}

      <div className="section">
        <div className="section-header">Магазин</div>
        <div className="list">
          <div className="field">
            <label>Название</label>
            <input value={store.storeName} onChange={(e) => set("storeName", e.target.value)} disabled={!isAdmin} />
          </div>
          <div className="field">
            <label>Поддержка TG</label>
            <input value={store.supportTelegram} onChange={(e) => set("supportTelegram", e.target.value)} placeholder="@username" disabled={!isAdmin} />
          </div>
          <div className="field">
            <label>Почта</label>
            <input value={store.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} placeholder="help@chebustore.ru" disabled={!isAdmin} />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">Доставка</div>
        <div className="list">
          {DELIVERY_ORDER.map((m) => (
            <div className="delivery-row" key={m}>
              <div className="delivery-row-main">
                <div>{DELIVERY_LABEL[m]}</div>
                <div className="footnote">{DELIVERY_HINT[m]}</div>
              </div>
              <div className="price-input">
                <input
                  value={prices[m]}
                  onChange={(e) => setPrices({ ...prices, [m]: e.target.value.replace(/[^\d.,]/g, "") })}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!isAdmin || !store.deliveryEnabled[m]}
                />
                <span>₽</span>
              </div>
              <input
                type="checkbox"
                className="switch"
                aria-label={`${DELIVERY_LABEL[m]} включена`}
                checked={store.deliveryEnabled[m]}
                disabled={!isAdmin}
                onChange={(e) => set("deliveryEnabled", { ...store.deliveryEnabled, [m]: e.target.checked })}
              />
            </div>
          ))}
          <div className="field">
            <textarea
              value={store.pickupAddress}
              onChange={(e) => set("pickupAddress", e.target.value)}
              placeholder="Где и когда передаёте заказ лично (для «Лично в руки»)"
              disabled={!isAdmin}
              style={{ minHeight: 64 }}
            />
          </div>
        </div>
        <div className="section-footer">Цена 0 — доставка бесплатна. Выключенный способ не показывается покупателям.</div>
      </div>

      <div className="section">
        <div className="section-header">Оформление</div>
        <div className="list">
          <div className="theme-presets">
            {THEME_PRESETS.map((t) => {
              const active = t.light.toLowerCase() === store.accentLight.toLowerCase() && t.dark.toLowerCase() === store.accentDark.toLowerCase();
              return (
                <button
                  key={t.name}
                  type="button"
                  className={`theme-swatch${active ? " active" : ""}`}
                  onClick={() => setStore({ ...store, accentLight: t.light, accentDark: t.dark })}
                  disabled={!isAdmin}
                  title={t.name}
                >
                  <span className="theme-swatch-dot" style={{ background: `linear-gradient(135deg, ${t.light} 50%, ${t.dark} 50%)` }} />
                  <span className="caption">{t.name}</span>
                </button>
              );
            })}
          </div>
          <label className="field color-field">
            <span className="label">Светлая тема</span>
            <span className="color-value mono">{store.accentLight.toUpperCase()}</span>
            <input type="color" value={store.accentLight} onChange={(e) => set("accentLight", e.target.value.toUpperCase())} disabled={!isAdmin} />
          </label>
          <label className="field color-field">
            <span className="label">Тёмная тема</span>
            <span className="color-value mono">{store.accentDark.toUpperCase()}</span>
            <input type="color" value={store.accentDark} onChange={(e) => set("accentDark", e.target.value.toUpperCase())} disabled={!isAdmin} />
          </label>
        </div>
        <div className="section-footer">Цвет кнопок, выбранных фильтров и акцентов на сайте, в Telegram и в приложении для сотрудников.</div>
      </div>

      <div className="section">
        <div className="section-header">Фон магазина</div>
        <div className="list">
          <div className="theme-presets">
            {BG_PRESETS.map((t) => {
              const active = same(t.light, store.bgLight) && same(t.dark, store.bgDark);
              return (
                <button
                  key={t.name}
                  type="button"
                  className={`theme-swatch${active ? " active" : ""}`}
                  onClick={() => setStore({ ...store, bgLight: t.light, bgDark: t.dark })}
                  disabled={!isAdmin}
                  title={t.name}
                >
                  <span className="theme-swatch-dot" style={{ background: `linear-gradient(135deg, ${t.light} 50%, ${t.dark} 50%)` }} />
                  <span className="caption">{t.name}</span>
                </button>
              );
            })}
          </div>
          <label className="field color-field">
            <span className="label">Светлая тема</span>
            <span className="color-value mono">{store.bgLight.toUpperCase()}</span>
            <input type="color" value={store.bgLight} onChange={(e) => set("bgLight", e.target.value.toUpperCase())} disabled={!isAdmin} />
          </label>
          <label className="field color-field">
            <span className="label">Тёмная тема</span>
            <span className="color-value mono">{store.bgDark.toUpperCase()}</span>
            <input type="color" value={store.bgDark} onChange={(e) => set("bgDark", e.target.value.toUpperCase())} disabled={!isAdmin} />
          </label>
          <div className="theme-preview">
            <ThemeMock bg={store.bgLight} surface="#FFFFFF" label="#000000" accent={store.accentLight} />
            <ThemeMock bg={store.bgDark} surface="#1C1C1E" label="#FFFFFF" accent={store.accentDark} />
          </div>
        </div>
        {bgLightBad || bgDarkBad ? (
          <div className="section-footer text-red">
            {bgLightBad ? "Фон светлой темы слишком тёмный — выберите цвет светлее. " : ""}
            {bgDarkBad ? "Фон тёмной темы слишком светлый — выберите цвет темнее." : ""}
          </div>
        ) : (
          <div className="section-footer">Цвет фона страниц на сайте и в Telegram. Карточки товаров остаются белыми днём и тёмными ночью.</div>
        )}
      </div>

      <div className="section">
        <div className="section-header">Приветствие бота</div>
        <div className="list">
          <div className="field">
            <textarea
              value={store.botWelcome}
              onChange={(e) => set("botWelcome", e.target.value)}
              maxLength={3000}
              placeholder="Текст, который бот отправляет на /start"
              disabled={!isAdmin}
              style={{ minHeight: 120 }}
            />
          </div>
          <div className="field">
            <label>Кнопка</label>
            <input value={store.botButton} onChange={(e) => set("botButton", e.target.value)} maxLength={32} disabled={!isAdmin} />
          </div>
        </div>
        <div className="tg-preview">
          <div className="tg-bubble">{store.botWelcome || "…"}</div>
          <div className="tg-inline-btn">{store.botButton || "Открыть магазин"}</div>
        </div>
      </div>

      {isAdmin ? (
        <button className="btn block mt-16" onClick={saveStore} disabled={saving !== null}>
          {saving === "store" ? <Spinner /> : "Сохранить настройки магазина"}
        </button>
      ) : (
        <div className="section-footer">Изменять настройки может только администратор.</div>
      )}
    </div>
  );
}

function ThemeMock({ bg, surface, label, accent }: { bg: string; surface: string; label: string; accent: string }) {
  return (
    <div className="theme-mock" style={{ background: bg, color: label }}>
      <div className="theme-mock-title">CHEBU</div>
      <div className="theme-mock-card" style={{ background: surface }}>
        <span className="theme-mock-img" />
        <span className="theme-mock-line" />
        <span className="theme-mock-line short" />
        <span className="btn small" style={{ background: accent, color: onColor(accent) }}>
          В корзину
        </span>
      </div>
    </div>
  );
}
