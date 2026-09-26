import { useEffect, useRef, useState } from "react";
import { BankPicker } from "../components/Bank";
import { ErrorState, PageLoader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DELIVERY_HINT, DELIVERY_LABEL, DELIVERY_ORDER, STATUS_LABEL, toKopecks, toRubles } from "../lib/format";
import { applyTheme, BG_DARK_MAX, BG_LIGHT_MIN, BG_PRESETS, luminance, onColor, THEME_PRESETS } from "../lib/theme";
import { useToast } from "../lib/toast";
import type { AdminCategory, ApnsPublic, DeliveryMethod, ImportSettings, OrderStatus, PaymentSettings, StoreSettings } from "../lib/types";

const STATUS_ORDER: OrderStatus[] = [
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "ASSEMBLING",
  "SHIPPED",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
];

export default function AdminSettings() {
  const { user, config } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "ADMIN";
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [payment, setPayment] = useState<PaymentSettings | null>(null);
  const [prices, setPrices] = useState<Record<DeliveryMethod, string>>({ CDEK: "", RUSSIAN_POST: "", HAND: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"store" | "payment" | "import" | "photo" | "apns" | null>(null);
  const [imp, setImp] = useState<ImportSettings | null>(null);
  const [channel, setChannel] = useState("");
  const [history, setHistory] = useState({ apiId: "", apiHash: "", phone: "", code: "", password: "" });
  const [loginId, setLoginId] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [historyText, setHistoryText] = useState("");
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [apns, setApns] = useState<ApnsPublic | null>(null);
  const [apnsForm, setApnsForm] = useState({ keyId: "", teamId: "", bundleId: "ru.chebustore.app", key: "" });
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ categories: AdminCategory[] }>("/admin/categories")
      .then((r) => setCategories(r.categories))
      .catch(() => undefined);
    api
      .get<{ store: StoreSettings; payment: PaymentSettings | null; import: ImportSettings; apns: ApnsPublic }>("/admin/settings")
      .then((r) => {
        setStore(r.store);
        setPayment(r.payment);
        setImp(r.import);
        setChannel(r.import.channelId);
        setApns(r.apns);
        setApnsForm({ keyId: r.apns.keyId, teamId: r.apns.teamId, bundleId: r.apns.bundleId, key: "" });
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

  const saveImport = async () => {
    if (!imp) return;
    setSaving("import");
    try {
      const r = await api.put<{ import: ImportSettings }>("/admin/settings/import", { ...imp, channel });
      setImp(r.import);
      setChannel(r.import.channelId);
      toast(r.import.enabled ? `Импорт включён: ${r.import.channelTitle}` : "Импорт выключен");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const watchHistory = () => {
    const tick = async () => {
      const s = await api.get<{
        progress: { running: boolean; scanned: number; created: number; updated: number; skipped: number; error: string } | null;
      }>("/admin/settings/import/history");
      const p = s.progress;
      if (!p) return;
      setHistoryText(
        p.error
          ? p.error
          : p.running
            ? `Идёт загрузка: просмотрено ${p.scanned}, новых ${p.created}`
            : `Готово: новых ${p.created}, обновлено ${p.updated}, пропущено ${p.skipped}`,
      );
      if (p.running) setTimeout(() => void tick(), 2500);
    };
    setTimeout(() => void tick(), 2000);
  };

  const requestHistoryCode = async () => {
    setSaving("import");
    try {
      const r = await api.post<{ loginId: string; viaApp: boolean }>("/admin/settings/import/login/start", {
        apiId: Number(history.apiId),
        apiHash: history.apiHash.trim(),
        phone: history.phone.trim(),
      });
      setLoginId(r.loginId);
      setHistoryText(r.viaApp ? "Код пришёл в Telegram" : "Код пришёл по SMS");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const confirmHistoryCode = async () => {
    setSaving("import");
    try {
      const r = await api.post<{ needsPassword: boolean; already?: boolean }>("/admin/settings/import/login/code", {
        loginId,
        code: history.code.trim(),
        password: history.password || undefined,
      });
      if (r.needsPassword) {
        setNeedsPassword(true);
        setHistoryText("На аккаунте включена двухэтапная защита. Введите её пароль.");
        return;
      }
      setLoginId("");
      setNeedsPassword(false);
      setHistory({ apiId: "", apiHash: "", phone: "", code: "", password: "" });
      setImp(imp ? { ...imp, hasHistorySession: true } : imp);
      setHistoryText(r.already ? "Загрузка уже идёт" : "Вход выполнен, старые посты загружаются");
      watchHistory();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const uploadExport = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast("Нужен zip-архив папки выгрузки", true);
      return;
    }
    setSaving("import");
    try {
      const r = await api.upload<{ already: boolean }>("/admin/settings/import/export", file);
      setHistoryText(r.already ? "Загрузка уже идёт" : "Выгрузка принята, посты добавляются");
      watchHistory();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const loadHistoryAgain = async () => {
    setSaving("import");
    try {
      const r = await api.post<{ already: boolean }>("/admin/settings/import/history/again");
      setHistoryText(r.already ? "Загрузка уже идёт" : "Загрузка старых постов началась");
      watchHistory();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const uploadPhoto = async (file: File) => {
    setSaving("photo");
    try {
      const r = await api.upload<{ store: StoreSettings }>("/admin/settings/welcome-photo", file);
      setStore({ ...store, botWelcomePhoto: r.store.botWelcomePhoto });
      toast("Фото приветствия сохранено");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const removePhoto = async () => {
    setSaving("photo");
    try {
      await api.del("/admin/settings/welcome-photo");
      setStore({ ...store, botWelcomePhoto: "" });
      toast("Фото убрано");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const saveApns = async () => {
    setSaving("apns");
    try {
      const r = await api.put<{ apns: ApnsPublic }>("/admin/settings/apns", apnsForm);
      setApns(r.apns);
      setApnsForm({ keyId: r.apns.keyId, teamId: r.apns.teamId, bundleId: r.apns.bundleId, key: "" });
      toast("Ключи Apple сохранены на сервере. На iPhone откройте приложение и отправьте тестовое уведомление.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const clearApns = async () => {
    if (!confirm("Удалить ключи Apple с сервера? Уведомления на iPhone перестанут приходить, пока не вставите ключи снова.")) return;
    setSaving("apns");
    try {
      const r = await api.del<{ apns: ApnsPublic }>("/admin/settings/apns");
      setApns(r.apns);
      setApnsForm({ keyId: "", teamId: "", bundleId: r.apns.bundleId || "ru.chebustore.app", key: "" });
      toast("Ключи удалены");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const setStatusText = (s: OrderStatus, v: string) => set("botStatusTexts", { ...store.botStatusTexts, [s]: v });
  const i = <K extends keyof ImportSettings>(k: K, v: ImportSettings[K]) => imp && setImp({ ...imp, [k]: v });
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
          <div className="cell">
            <div className="cell-main">
              <div className="cell-title">Фото к приветствию</div>
              <div className="cell-sub">{store.botWelcomePhoto ? "Отправляется вместе с текстом на /start" : "Необязательно. JPEG, PNG или WEBP"}</div>
            </div>
            {isAdmin && (
              <div className="row-flex">
                {store.botWelcomePhoto && (
                  <button className="btn small danger" onClick={removePhoto} disabled={saving !== null}>
                    Убрать
                  </button>
                )}
                <button className="btn small gray" onClick={() => photoInput.current?.click()} disabled={saving !== null}>
                  {saving === "photo" ? <Spinner /> : store.botWelcomePhoto ? "Заменить" : "Выбрать"}
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadPhoto(f);
                  }}
                />
              </div>
            )}
          </div>
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
          <div className={`tg-bubble${store.botWelcomePhoto ? " with-photo" : ""}`}>
            {store.botWelcomePhoto && <img className="tg-photo" src={`/media/bot/${store.botWelcomePhoto}`} alt="" />}
            <div className="tg-text">{store.botWelcome || "…"}</div>
          </div>
          <div className="tg-inline-btn">{store.botButton || "Открыть магазин"}</div>
        </div>
        {store.botWelcomePhoto && store.botWelcome.length > 1024 && (
          <div className="section-footer">Текст длиннее 1024 символов — бот отправит фото и текст отдельными сообщениями.</div>
        )}
      </div>

      <div className="section">
        <div className="section-header">Сообщения о заказе</div>
        <div className="list">
          {STATUS_ORDER.map((s) => (
            <div className="field stacked" key={s}>
              <label>{STATUS_LABEL[s]}</label>
              <textarea
                value={store.botStatusTexts[s]}
                onChange={(e) => setStatusText(s, e.target.value)}
                maxLength={500}
                disabled={!isAdmin}
                style={{ minHeight: 48 }}
              />
            </div>
          ))}
        </div>
        <div className="section-footer">
          Бот и почта отправляют покупателю этот текст при смене статуса. Можно вставить {"{номер}"} и {"{сумма}"}. Трек-номер, место
          выдачи и причина отклонения чека добавляются автоматически.
        </div>
      </div>

      <div className="section">
        <div className="section-header">Команда /help</div>
        <div className="list">
          <div className="field">
            <textarea value={store.botHelp} onChange={(e) => set("botHelp", e.target.value)} maxLength={2000} disabled={!isAdmin} style={{ minHeight: 96 }} />
          </div>
        </div>
      </div>

      {isAdmin ? (
        <button className="btn block mt-16" onClick={saveStore} disabled={saving !== null}>
          {saving === "store" ? <Spinner /> : "Сохранить настройки магазина"}
        </button>
      ) : (
        <div className="section-footer">Изменять настройки может только администратор.</div>
      )}

      {isAdmin && apns && (
        <>
          <div className="section">
            <div className="section-header">Уведомления на iPhone</div>
            <div className="list">
              <div className="cell">
                <div className="cell-main">
                  <div className="cell-title">{apns.configured ? "Ключи Apple заданы" : "Ключи Apple не заданы"}</div>
                  <div className="cell-sub">
                    {apns.source === "env"
                      ? "Сейчас используются значения из .env на сервере"
                      : apns.configured
                        ? `Key ID ${apns.keyId} · Team ${apns.teamId}`
                        : "Без ключа тестовое уведомление не отправится. Ключ остаётся только на сервере."}
                  </div>
                </div>
              </div>
              {apns.source !== "env" && (
                <>
                  <div className="field">
                    <label>Key ID</label>
                    <input
                      value={apnsForm.keyId}
                      onChange={(e) => setApnsForm({ ...apnsForm, keyId: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) })}
                      placeholder="ABC123DEFG"
                      autoCapitalize="characters"
                      autoCorrect="off"
                    />
                  </div>
                  <div className="field">
                    <label>Team ID</label>
                    <input
                      value={apnsForm.teamId}
                      onChange={(e) => setApnsForm({ ...apnsForm, teamId: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) })}
                      placeholder="JVH92WZ78Z"
                      autoCapitalize="characters"
                      autoCorrect="off"
                    />
                  </div>
                  <div className="field">
                    <label>Bundle ID</label>
                    <input
                      value={apnsForm.bundleId}
                      onChange={(e) => setApnsForm({ ...apnsForm, bundleId: e.target.value.trim() })}
                      placeholder="ru.chebustore.app"
                      autoCapitalize="off"
                    />
                  </div>
                  <div className="field">
                    <textarea
                      value={apnsForm.key}
                      onChange={(e) => setApnsForm({ ...apnsForm, key: e.target.value })}
                      placeholder={apns.configured ? "Чтобы заменить ключ, вставьте новый .p8" : "Вставьте содержимое файла AuthKey_….p8 целиком"}
                      style={{ minHeight: 120, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="section-footer">
              developer.apple.com → Keys → ключ с галочкой Apple Push Notifications. Key ID на странице ключа, Team ID — в правом верхнем углу аккаунта. Файл .p8 скачивается один раз.
            </div>
          </div>
          {apns.source !== "env" && (
            <>
              <button className="btn block" onClick={saveApns} disabled={saving !== null || !apnsForm.key.trim()}>
                {saving === "apns" ? <Spinner /> : "Сохранить ключи Apple"}
              </button>
              {apns.configured && apns.source === "admin" && (
                <button className="btn block gray mt-8" onClick={clearApns} disabled={saving !== null}>
                  Удалить ключи
                </button>
              )}
            </>
          )}
        </>
      )}

      {isAdmin && imp && (
        <>
          <div className="section">
            <div className="section-header">Импорт из канала</div>
            <div className="list">
              <label className="cell">
                <div className="cell-main">
                  <div className="cell-title">Добавлять товары из канала</div>
                  <div className="cell-sub">{imp.enabled && imp.channelTitle ? imp.channelTitle : "Выключено"}</div>
                </div>
                <input type="checkbox" className="switch" checked={imp.enabled} onChange={(e) => i("enabled", e.target.checked)} />
              </label>
              <div className="field">
                <label>Канал</label>
                <input value={channel} onChange={(e) => setChannel(e.target.value.trim())} placeholder="@channel или -100…" autoCapitalize="off" />
              </div>
              <label className="cell">
                <div className="cell-main">
                  <div className="cell-title">Сразу публиковать</div>
                  <div className="cell-sub">Иначе товар появится скрытым, и его нужно будет включить вручную</div>
                </div>
                <input type="checkbox" className="switch" checked={imp.publish} onChange={(e) => i("publish", e.target.checked)} />
              </label>
              <div className="field">
                <label>Остаток</label>
                <input
                  value={imp.stock}
                  inputMode="numeric"
                  onChange={(e) => i("stock", Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
                />
              </div>
              <div className="field">
                <label>Категория</label>
                <select value={imp.categoryId} onChange={(e) => i("categoryId", e.target.value)}>
                  <option value="">Угадывать по названию</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="section-footer">
              Добавьте бота в администраторы канала. Из поста берутся название (первая строка), цена, размеры, состояние, описание и
              все фото; строки вроде «Оформить 👉 @…» и хэштеги пропускаются. Правка поста обновляет товар, слово «продано» обнуляет
              остаток. Новые посты подхватываются сами. Для закрытого канала перешлите боту любой пост: он пришлёт ID канала.
            </div>
          </div>
          <button className="btn block" onClick={saveImport} disabled={saving !== null}>
            {saving === "import" ? <Spinner /> : "Сохранить импорт"}
          </button>

          <div className="section">
            <div className="section-header">Старые посты</div>
            <div className="list">
              <div className="field">
                <label>Архив выгрузки</label>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  disabled={saving !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void uploadExport(file);
                  }}
                />
              </div>
              {!loginId && (
                <>
                  <div className="field">
                    <label>api_id</label>
                    <input
                      value={history.apiId}
                      onChange={(e) => setHistory({ ...history, apiId: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                      inputMode="numeric"
                      placeholder="12345678"
                    />
                  </div>
                  <div className="field">
                    <label>api_hash</label>
                    <input
                      value={history.apiHash}
                      onChange={(e) => setHistory({ ...history, apiHash: e.target.value.trim().toLowerCase() })}
                      placeholder="32 символа с my.telegram.org"
                      autoCapitalize="off"
                      autoCorrect="off"
                    />
                  </div>
                  <div className="field">
                    <label>Телефон аккаунта</label>
                    <input
                      value={history.phone}
                      onChange={(e) => setHistory({ ...history, phone: e.target.value.replace(/[^\d+]/g, "").slice(0, 16) })}
                      placeholder="+79001234567"
                      inputMode="tel"
                    />
                  </div>
                </>
              )}
              {loginId && (
                <>
                  <div className="field">
                    <label>Код из Telegram</label>
                    <input
                      value={history.code}
                      onChange={(e) => setHistory({ ...history, code: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                      inputMode="numeric"
                      placeholder="12345"
                    />
                  </div>
                  {needsPassword && (
                    <div className="field">
                      <label>Пароль двухэтапной защиты</label>
                      <input type="password" value={history.password} onChange={(e) => setHistory({ ...history, password: e.target.value })} />
                    </div>
                  )}
                </>
              )}
            </div>
            {historyText && <div className="section-footer">{historyText}</div>}
            <div className="section-footer">
              Бот видит только новые посты. Старые заберите без my.telegram.org: Telegram Desktop → канал → три точки → Export chat history → формат JSON, без видео и голосовых. Папку выгрузки сожмите в zip и выберите её выше. Поля api_id ниже нужны, только если сайт Telegram всё-таки выдал ключи.
            </div>
          </div>
          {!loginId ? (
            <>
              <button
                className="btn block"
                onClick={requestHistoryCode}
                disabled={saving !== null || !channel || !history.apiId || history.apiHash.length < 32 || !history.phone.startsWith("+")}
              >
                Получить код
              </button>
              {imp.hasHistorySession && (
                <button className="btn block gray mt-8" onClick={loadHistoryAgain} disabled={saving !== null}>
                  Загрузить старые посты ещё раз
                </button>
              )}
            </>
          ) : (
            <button className="btn block" onClick={confirmHistoryCode} disabled={saving !== null || history.code.length < 4}>
              Войти и загрузить посты
            </button>
          )}
        </>
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
