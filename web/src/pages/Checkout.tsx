import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { NavBar, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DELIVERY_LABEL, rub } from "../lib/format";
import { useToast } from "../lib/toast";
import type { DeliveryMethod, Order } from "../lib/types";

export default function Checkout() {
  const { user, cart, config, refreshCart } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const delivery = config?.delivery ?? [];
  const [method, setMethod] = useState<DeliveryMethod>(delivery[0]?.method ?? "PICKUP");
  const [name, setName] = useState([user?.firstName, user?.lastName].filter(Boolean).join(" "));
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!user) return <Navigate to="/login?next=/checkout" replace />;
  if (cart && cart.items.length === 0) return <Navigate to="/cart" replace />;

  const deliveryPrice = delivery.find((d) => d.method === method)?.price ?? 0;
  const total = (cart?.itemsTotal ?? 0) + deliveryPrice;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { order } = await api.post<{ order: Order }>("/orders", {
        contactName: name,
        contactPhone: phone,
        deliveryMethod: method,
        deliveryAddress: method === "PICKUP" ? "" : address,
        comment,
      });
      await refreshCart();
      navigate(`/orders/${order.number}`, { replace: true });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Не удалось оформить заказ", true);
    } finally {
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
          <div className="section-header">Доставка</div>
          {delivery.length > 1 && (
            <div className="segmented" style={{ marginBottom: 12 }}>
              {delivery.map((d) => (
                <button type="button" key={d.method} className={method === d.method ? "active" : ""} onClick={() => setMethod(d.method)}>
                  {DELIVERY_LABEL[d.method]}
                </button>
              ))}
            </div>
          )}
          <div className="list">
            <div className="cell">
              <div className="cell-main">{DELIVERY_LABEL[method]}</div>
              <div className="cell-value">{deliveryPrice ? rub(deliveryPrice) : "Бесплатно"}</div>
            </div>
            {method === "PICKUP" ? (
              config?.pickupAddress && (
                <div className="cell">
                  <div className="cell-main subhead muted">{config.pickupAddress}</div>
                </div>
              )
            ) : (
              <div className="field">
                <textarea
                  required
                  minLength={5}
                  maxLength={400}
                  autoComplete="street-address"
                  placeholder={method === "POST" ? "Город, адрес пункта выдачи или индекс и адрес" : "Город, улица, дом, квартира, подъезд"}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            )}
          </div>
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
            После оформления вы увидите реквизиты для перевода по СБП или на карту. Оплатите и прикрепите чек — мы проверим поступление и начнём собирать заказ.
          </div>
        </div>

        <div className="sticky-pad" />
        <div className="sticky-bottom">
          <div className="inner">
            <button className="btn block" type="submit" disabled={submitting || !cart}>
              {submitting ? <Spinner /> : `Оформить заказ · ${rub(total)}`}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
