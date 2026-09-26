import { useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AddressInput } from "../components/AddressInput";
import { Icon, type IconName } from "../components/Icon";
import { NavBar, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DELIVERY_HINT, DELIVERY_LABEL, DELIVERY_ORDER, rub } from "../lib/format";
import { useToast } from "../lib/toast";
import type { DeliveryMethod, Order } from "../lib/types";

const DELIVERY_ICON: Record<DeliveryMethod, IconName> = { CDEK: "box", RUSSIAN_POST: "mailbox", HAND: "hand" };

const ADDRESS_PLACEHOLDER: Record<DeliveryMethod, string> = {
  CDEK: "Город и адрес пункта выдачи СДЭК",
  RUSSIAN_POST: "Индекс, город, улица, дом, квартира",
  HAND: "Где удобно встретиться (необязательно)",
};

export default function Checkout() {
  const { user, cart, config, refreshCart } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const delivery = [...(config?.delivery ?? [])].sort((a, b) => DELIVERY_ORDER.indexOf(a.method) - DELIVERY_ORDER.indexOf(b.method));
  const [method, setMethod] = useState<DeliveryMethod | null>(delivery[0]?.method ?? null);
  const [name, setName] = useState([user?.firstName, user?.lastName].filter(Boolean).join(" "));
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const placed = useRef(false);

  if (!user) return <Navigate to="/login?next=/checkout" replace />;
  if (cart && cart.items.length === 0 && !placed.current) return <Navigate to="/cart" replace />;

  const deliveryPrice = delivery.find((d) => d.method === method)?.price ?? 0;
  const total = (cart?.itemsTotal ?? 0) + deliveryPrice;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!method) {
      toast("Выберите способ доставки", true);
      return;
    }
    setSubmitting(true);
    try {
      const { order } = await api.post<{ order: Order }>("/orders", {
        contactName: name,
        contactPhone: phone,
        deliveryMethod: method,
        deliveryAddress: address.trim(),
        comment,
      });
      placed.current = true;
      navigate(`/orders/${order.number}`, { replace: true });
      void refreshCart().catch(() => undefined);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Не удалось оформить заказ", true);
      setSubmitting(false);
    }
  };

  return (
    <>
      <NavBar title="Оформление" back="/cart" />
      <form className="container narrow" onSubmit={submit}>
        <div className="section">
          <div className="section-header">Получатель</div>
          <div className="list">
            <div className="field">
              <label htmlFor="name">Имя</label>
              <input id="name" required minLength={2} maxLength={96} autoComplete="name" placeholder="Имя и фамилия" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="phone">Телефон</label>
              <input id="phone" required type="tel" autoComplete="tel" inputMode="tel" placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">Способ получения</div>
          {delivery.length === 0 ? (
            <div className="banner warn">Доставка временно недоступна. Напишите в поддержку.</div>
          ) : (
            <div className="delivery-cards">
              {delivery.map((d) => (
                <button
                  type="button"
                  key={d.method}
                  className={`delivery-card${method === d.method ? " active" : ""}`}
                  onClick={() => setMethod(d.method)}
                  aria-pressed={method === d.method}
                >
                  <span className="delivery-card-icon">
                    <Icon name={DELIVERY_ICON[d.method]} size={22} />
                  </span>
                  <span className="delivery-card-title">{DELIVERY_LABEL[d.method]}</span>
                  <span className="delivery-card-hint">{DELIVERY_HINT[d.method]}</span>
                  <span className="delivery-card-price">{d.price ? rub(d.price) : "Бесплатно"}</span>
                </button>
              ))}
            </div>
          )}
          {method && (
            <div className="list mt-12" key={method}>
              {method === "HAND" ? (
                <>
                  {config?.pickupAddress && (
                    <div className="cell">
                      <Icon name="pin" size={20} />
                      <div className="cell-main subhead">{config.pickupAddress}</div>
                    </div>
                  )}
                  <div className="field">
                    <textarea
                      maxLength={400}
                      placeholder={ADDRESS_PLACEHOLDER.HAND}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      style={{ minHeight: 64 }}
                    />
                  </div>
                </>
              ) : (
                <AddressInput
                  value={address}
                  onChange={setAddress}
                  placeholder={ADDRESS_PLACEHOLDER[method]}
                  withPostalCode={method === "RUSSIAN_POST"}
                />
              )}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-header">Комментарий</div>
          <div className="list">
            <div className="field">
              <textarea maxLength={500} placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 64 }} />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="list">
            <div className="cell">
              <div className="cell-main">Товары</div>
              <div className="cell-value">{rub(cart?.itemsTotal ?? 0)}</div>
            </div>
            <div className="cell">
              <div className="cell-main">Доставка</div>
              <div className="cell-value">{deliveryPrice ? rub(deliveryPrice) : "0 ₽"}</div>
            </div>
            <div className="cell">
              <div className="cell-main headline">К оплате</div>
              <div className="price">{rub(total)}</div>
            </div>
          </div>
          <div className="section-footer">
            После оформления вы увидите реквизиты для перевода по СБП или на карту. Оплатите и прикрепите чек — мы проверим
            поступление и начнём собирать заказ.
          </div>
        </div>

        <div className="sticky-pad" />
        <div className="sticky-bottom">
          <div className="inner">
            <button className="btn block" type="submit" disabled={submitting || !cart || !method}>
              {submitting ? <Spinner /> : `Оформить заказ · ${rub(total)}`}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
