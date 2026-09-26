import { useEffect, useState } from "react";
import { ErrorState, PageLoader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DELIVERY_LABEL, toKopecks, toRubles } from "../lib/format";
import { useToast } from "../lib/toast";
import type { DeliveryMethod, PaymentSettings, StoreSettings } from "../lib/types";

const METHODS: DeliveryMethod[] = ["PICKUP", "COURIER", "POST"];

export default function AdminSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "ADMIN";
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [payment, setPayment] = useState<PaymentSettings | null>(null);
  const [prices, setPrices] = useState<Record<DeliveryMethod, string>>({ PICKUP: "", COURIER: "", POST: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"store" | "payment" | null>(null);

  useEffect(() => {
    api
      .get<{ store: StoreSettings; payment: PaymentSettings | null }>("/admin/settings")
      .then((r) => {
        setStore(r.store);
        setPayment(r.payment);
        setPrices({
          PICKUP: toRubles(r.store.deliveryPrices.PICKUP),
          COURIER: toRubles(r.store.deliveryPrices.COURIER),
          POST: toRubles(r.store.deliveryPrices.POST),
        });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!store) return <PageLoader />;

  const saveStore = async () => {
    setSaving("store");
    try {
      await api.put("/admin/settings/store", {
        ...store,
        deliveryPrices: { PICKUP: toKopecks(prices.PICKUP), COURIER: toKopecks(prices.COURIER), POST: toKopecks(prices.POST) },
      });
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
      await api.put("/admin/settings/payment", payment);
      toast("Реквизиты сохранены. Новые заказы получат их автоматически.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setSaving(null);
    }
  };

  const p = (k: keyof PaymentSettings, v: string | number) => payment && setPayment({ ...payment, [k]: v });

  return (
    <div className="container narrow">
      <h1 className="large-title">Настройки</h1>

      {isAdmin && payment && (
        <>
          <div className="section">
            <div className="section-header">Реквизиты для оплаты</div>
            <div className="list">
              <div className="field">
                <label>СБП телефон</label>
                <input value={payment.sbpPhone} onChange={(e) => p("sbpPhone", e.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" />
              </div>
              <div className="field">
                <label>Банк СБП</label>
                <input value={payment.sbpBank} onChange={(e) => p("sbpBank", e.target.value)} placeholder="Т-Банк" />
              </div>
              <div className="field">
                <label>Номер карты</label>
                <input value={payment.cardNumber} onChange={(e) => p("cardNumber", e.target.value.replace(/[^\d ]/g, ""))} placeholder="2200 0000 0000 0000" inputMode="numeric" />
              </div>
              <div className="field">
                <label>Банк карты</label>
                <input value={payment.cardBank} onChange={(e) => p("cardBank", e.target.value)} placeholder="Сбербанк" />
              </div>
              <div className="field">
                <label>Получатель</label>
                <input value={payment.recipientName} onChange={(e) => p("recipientName", e.target.value)} placeholder="Иван И." />
              </div>
              <div className="field">
                <label>Срок оплаты, ч</label>
                <input value={payment.paymentWindowHours} inputMode="numeric" onChange={(e) => p("paymentWindowHours", Number(e.target.value.replace(/\D/g, "")) || 1)} />
              </div>
              <div className="field">
                <textarea value={payment.instructions} onChange={(e) => p("instructions", e.target.value)} maxLength={1000} placeholder="Инструкция покупателю (необязательно)" style={{ minHeight: 64 }} />
              </div>
            </div>
            <div className="section-footer">
              Реквизиты хранятся только на сервере и показываются покупателю лишь внутри его неоплаченного заказа. Изменение фиксируется в журнале. Неоплаченные заказы автоматически отменяются после срока оплаты.
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
            <input value={store.storeName} onChange={(e) => setStore({ ...store, storeName: e.target.value })} disabled={!isAdmin} />
          </div>
          <div className="field">
            <label>Поддержка TG</label>
            <input value={store.supportTelegram} onChange={(e) => setStore({ ...store, supportTelegram: e.target.value })} placeholder="@username" disabled={!isAdmin} />
          </div>
          <div className="field">
            <label>Почта</label>
            <input value={store.supportEmail} onChange={(e) => setStore({ ...store, supportEmail: e.target.value })} placeholder="help@chebustore.ru" disabled={!isAdmin} />
          </div>
          <div className="field">
            <textarea value={store.pickupAddress} onChange={(e) => setStore({ ...store, pickupAddress: e.target.value })} placeholder="Адрес самовывоза и часы работы" disabled={!isAdmin} style={{ minHeight: 64 }} />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">Доставка</div>
        <div className="list">
          {METHODS.map((m) => (
            <div className="field" key={m}>
              <label>{DELIVERY_LABEL[m]}</label>
              <input value={prices[m]} onChange={(e) => setPrices({ ...prices, [m]: e.target.value })} inputMode="decimal" placeholder="0 ₽" disabled={!isAdmin} />
              <input
                type="checkbox"
                className="switch"
                checked={store.deliveryEnabled[m]}
                disabled={!isAdmin}
                onChange={(e) => setStore({ ...store, deliveryEnabled: { ...store.deliveryEnabled, [m]: e.target.checked } })}
              />
            </div>
          ))}
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
