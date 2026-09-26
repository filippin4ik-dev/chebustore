import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthImage, ErrorState, NavBar, PageLoader, Sheet, StatusBadge, useAsync } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, DELIVERY_LABEL, rub, STATUS_LABEL, userName } from "../lib/format";
import { useToast } from "../lib/toast";
import type { Order, OrderStatus, User } from "../lib/types";
import { useLive } from "../lib/live";

interface Detail {
  order: Order;
  customer: User;
  nextStatuses: { status: OrderStatus; text: string }[];
}

const REJECT_REASONS = ["Платёж не найден", "Сумма не совпадает с суммой заказа", "Чек не читается", "Оплата не на те реквизиты"];

export default function AdminOrderDetail() {
  const { number = "" } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, error, loading, reload, refresh } = useAsync(() => api.get<Detail>(`/admin/orders/${encodeURIComponent(number)}`), [number]);
  useLive((e) => e.type === "orders" && (!e.number || String(e.number) === String(number)), () => void refresh());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [statusTarget, setStatusTarget] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState("");
  const [pickup, setPickup] = useState("");
  const [comment, setComment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <PageLoader />;
  if (error || !data) return <ErrorState message={error ?? ""} retry={reload} />;
  const { order, customer } = data;

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast(success);
      await reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    if (!confirm(`Подтвердить получение ${rub(order.total)} по заказу №${order.number}?`)) return;
    run(() => api.post(`/admin/orders/${order.number}/approve`), "Оплата подтверждена");
  };

  const reject = () =>
    run(async () => {
      await api.post(`/admin/orders/${order.number}/reject`, { reason });
      setRejectOpen(false);
      setReason("");
    }, "Чек отклонён, покупатель уведомлён");

  const openStatus = (s: OrderStatus) => {
    setStatusTarget(s);
    setNote("");
    setTracking(order.trackingNumber);
    setPickup(order.pickupInfo || "");
  };

  const applyStatus = () =>
    run(async () => {
      await api.post(`/admin/orders/${order.number}/status`, {
        to: statusTarget,
        note,
        ...(statusTarget === "SHIPPED" ? { trackingNumber: tracking } : {}),
        ...(statusTarget === "READY_FOR_PICKUP" ? { pickupInfo: pickup } : {}),
      });
      setStatusTarget(null);
    }, "Статус обновлён");

  const remove = async () => {
    const reserved = ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "ASSEMBLING"].includes(order.status);
    const text = `Удалить заказ №${order.number} навсегда?${reserved ? " Товары вернутся в продажу." : ""} Покупатель больше не увидит его, чеки будут удалены.`;
    if (!confirm(text)) return;
    setBusy(true);
    try {
      await api.del(`/admin/orders/${order.number}`);
      toast(`Заказ №${order.number} удалён`);
      navigate("/admin/orders", { replace: true });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
      setBusy(false);
    }
  };

  const moves = data.nextStatuses.filter((s) => s.status !== "PAYMENT_REVIEW" && s.status !== "AWAITING_PAYMENT");

  return (
    <>
      <NavBar title={`Заказ №${order.number}`} back="/admin/orders" />
      <div className="container narrow">
        <div className="section">
          <div className="list" style={{ padding: "14px 16px" }}>
            <div className="row-flex" style={{ justifyContent: "space-between" }}>
              <StatusBadge status={order.status} />
              <span className="title-3 price">{rub(order.total)}</span>
            </div>
            <div className="footnote mt-8">
              Создан {dateTime(order.createdAt)}
              {order.paidAt && ` · оплачен ${dateTime(order.paidAt)}`}
              {order.status === "AWAITING_PAYMENT" && ` · оплатить до ${dateTime(order.paymentDeadline)}`}
            </div>
          </div>
        </div>

        {order.status === "PAYMENT_REVIEW" && (
          <div className="section">
            <div className="banner warn">Проверьте поступление <b>{rub(order.total)}</b> в банке, затем подтвердите или отклоните чек.</div>
            <div className="row-flex mt-16">
              <button className="btn green" style={{ flex: 1 }} disabled={busy} onClick={approve}>
                Оплата получена
              </button>
              <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => setRejectOpen(true)}>
                Отклонить
              </button>
            </div>
          </div>
        )}

        {order.receipts.length > 0 && (
          <div className="section">
            <div className="section-header">Чеки ({order.receipts.length})</div>
            <div className="list">
              {[...order.receipts].reverse().map((r) => (
                <div key={r.id} className="cell" style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <div className="footnote">
                    {dateTime(r.createdAt)}
                    {r.approved === true && " · принят"}
                    {r.approved === false && ` · отклонён: ${r.note}`}
                    {r.approved === null && " · ожидает проверки"}
                  </div>
                  <AuthImage path={`/admin/receipts/${r.id}`} alt={`receipt-${order.number}`} className="receipt-img" />
                </div>
              ))}
            </div>
          </div>
        )}

        {moves.length > 0 && (
          <div className="section">
            <div className="section-header">Изменить статус</div>
            <div className="list">
              {moves.map((s) => (
                <button key={s.status} className={`cell ${s.status === "CANCELLED" ? "destructive" : "action"}`} onClick={() => openStatus(s.status)}>
                  {s.status === "ASSEMBLING" ? "Отметить оплаченным вручную" : `→ ${STATUS_LABEL[s.status]}`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-header">Покупатель</div>
          <div className="list">
            <div className="cell">
              <div className="cell-main">
                <div>{order.contactName}</div>
                <div className="cell-sub">
                  <a href={`tel:${order.contactPhone}`} className="link-btn">
                    {order.contactPhone}
                  </a>
                </div>
              </div>
            </div>
            <div className="cell">
              <div className="cell-main">
                <div className="footnote">Аккаунт</div>
                <div>{userName(customer)}</div>
                <div className="cell-sub">
                  {customer.telegramUsername && (
                    <a className="link-btn" href={`https://t.me/${customer.telegramUsername}`} target="_blank" rel="noreferrer">
                      @{customer.telegramUsername}
                    </a>
                  )}
                  {customer.telegramUsername && customer.email && " · "}
                  {customer.email}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">Доставка · {DELIVERY_LABEL[order.deliveryMethod]}</div>
          <div className="list">
            <div className="cell">
              <div className="cell-main subhead">{order.deliveryAddress || "—"}</div>
            </div>
            {order.customerComment && (
              <div className="cell">
                <div className="cell-main subhead">
                  <span className="muted">Комментарий: </span>
                  {order.customerComment}
                </div>
              </div>
            )}
            {order.trackingNumber && (
              <div className="cell">
                <div className="cell-main">Трек-номер</div>
                <div className="cell-value mono">{order.trackingNumber}</div>
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <div className="section-header">Состав</div>
          <div className="list">
            {order.items.map((i) => (
              <div key={i.id} className="cell inset-sep">
                {i.image ? <img className="thumb" src={i.image} alt="" /> : <div className="thumb" />}
                <div className="cell-main">
                  <div className="cell-title">{i.productTitle}</div>
                  <div className="cell-sub">
                    {i.size}
                    {i.color ? ` · ${i.color}` : ""} · {i.quantity} × {rub(i.unitPrice)}
                  </div>
                </div>
                <div className="price">{rub(i.unitPrice * i.quantity)}</div>
              </div>
            ))}
            <div className="cell">
              <div className="cell-main">Доставка</div>
              <div className="cell-value">{rub(order.deliveryPrice)}</div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">Заметка для команды</div>
          <div className="list">
            <div className="field">
              <textarea
                placeholder="Видна только сотрудникам"
                value={comment ?? order.adminComment ?? ""}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
              />
            </div>
          </div>
          {comment !== null && comment !== order.adminComment && (
            <button
              className="btn small mt-8"
              onClick={() =>
                run(async () => {
                  await api.patch(`/admin/orders/${order.number}`, { adminComment: comment });
                  setComment(null);
                }, "Сохранено")
              }
            >
              Сохранить заметку
            </button>
          )}
        </div>

        <div className="section">
          <div className="section-header">История</div>
          <div className="list timeline">
            {[...order.history].reverse().map((h, idx) => (
              <div className="tl-item" key={idx}>
                <span className="tl-dot" />
                <div>
                  <div className="subhead">{STATUS_LABEL[h.to]}</div>
                  {h.note && <div className="footnote">{h.note}</div>}
                  <div className="caption">{dateTime(h.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="list">
            <Link className="cell action" to={`/admin/orders?user=${customer.id}`}>
              Все заказы покупателя
            </Link>
            {user?.role === "ADMIN" && (
              <button className="cell destructive" disabled={busy} onClick={remove}>
                Удалить заказ
              </button>
            )}
          </div>
          {user?.role === "ADMIN" && (
            <div className="section-footer">Удаление необратимо и записывается в журнал. Для обычной отмены используйте статус «Отменён».</div>
          )}
        </div>
      </div>

      <Sheet open={rejectOpen} onClose={() => setRejectOpen(false)} title="Отклонить чек">
        <div className="list">
          {REJECT_REASONS.map((r) => (
            <button key={r} className="cell" onClick={() => setReason(r)}>
              <div className="cell-main">{r}</div>
              {reason === r && <span style={{ color: "var(--blue)" }}>✓</span>}
            </button>
          ))}
        </div>
        <div className="list mt-16">
          <div className="field">
            <textarea placeholder="Или своя причина — её увидит покупатель" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} style={{ minHeight: 64 }} />
          </div>
        </div>
        <button className="btn block danger mt-16" disabled={busy || reason.trim().length < 3} onClick={reject}>
          Отклонить и уведомить
        </button>
      </Sheet>

      <Sheet open={statusTarget !== null} onClose={() => setStatusTarget(null)} title={statusTarget ? STATUS_LABEL[statusTarget] : ""}>
        <div className="list">
          {statusTarget === "SHIPPED" && (
            <div className="field">
              <label>Трек-номер</label>
              <input value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={64} placeholder="Необязательно" />
            </div>
          )}
          {statusTarget === "READY_FOR_PICKUP" && (
            <div className="field">
              <textarea value={pickup} onChange={(e) => setPickup(e.target.value)} maxLength={500} placeholder="Где и когда забрать, код получения" />
            </div>
          )}
          <div className="field">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Сообщение покупателю (необязательно)" style={{ minHeight: 64 }} />
          </div>
        </div>
        <div className="section-footer">Покупатель получит уведомление в Telegram и на почту.</div>
        <button className={`btn block mt-16 ${statusTarget === "CANCELLED" ? "danger" : ""}`} disabled={busy} onClick={applyStatus}>
          {statusTarget === "CANCELLED" ? "Отменить заказ" : "Применить"}
        </button>
      </Sheet>
    </>
  );
}
