import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BankName } from "../components/Bank";
import { Icon } from "../components/Icon";
import { AuthImage, CopyValue, ErrorState, NavBar, PageLoader, Spinner, StatusBadge, useAsync } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, DELIVERY_LABEL, progressStep, rub, STATUS_LABEL, timeLeft } from "../lib/format";
import { useToast } from "../lib/toast";
import type { Order } from "../lib/types";

function PayLabel({ title, bank }: { title: string; bank: string }) {
  return (
    <span className="pay-label">
      {title}
      {bank && (
        <>
          <span className="muted"> · </span>
          <BankName id={bank} />
        </>
      )}
    </span>
  );
}

export default function OrderDetail() {
  const { number = "" } = useParams();
  const { user, config } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const { data: order, setData, error, loading, reload } = useAsync(
    () => api.get<{ order: Order }>(`/orders/${encodeURIComponent(number)}`).then((r) => r.order),
    [number, user?.id],
  );

  if (!user) return <ErrorState message="Войдите, чтобы открыть заказ" />;
  if (loading && !order) return <PageLoader />;
  if (error || !order) return <ErrorState message={error ?? "Заказ не найден"} retry={reload} />;

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast("Файл больше 10 МБ", true);
      return;
    }
    setUploading(true);
    try {
      const r = await api.upload<{ order: Order }>(`/orders/${order.number}/receipt`, file);
      setData(r.order);
      toast("Чек отправлен на проверку");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось загрузить чек", true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const cancel = async () => {
    if (!confirm("Отменить заказ? Товары вернутся в продажу.")) return;
    try {
      const r = await api.post<{ order: Order }>(`/orders/${order.number}/cancel`);
      setData(r.order);
      toast("Заказ отменён");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  const step = progressStep(order.status);
  const p = order.payment;
  const awaiting = order.status === "AWAITING_PAYMENT";
  const review = order.status === "PAYMENT_REVIEW";

  return (
    <>
      <NavBar title={`Заказ №${order.number}`} back="/orders" />
      <div className="container narrow">
        <div className="section">
          <div className="list" style={{ padding: "14px 16px" }}>
            <div className="row-flex" style={{ justifyContent: "space-between" }}>
              <StatusBadge status={order.status} />
              <span className="footnote">{dateTime(order.createdAt)}</span>
            </div>
            {order.status !== "CANCELLED" && (
              <div className="progress" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={i <= step ? "done" : ""} />
                ))}
              </div>
            )}
            <div className="subhead muted mt-8">
              {awaiting && `Оплатите заказ в течение ${timeLeft(order.paymentDeadline)} и прикрепите чек.`}
              {review && "Мы получили чек и сверяем поступление. Обычно это занимает до пары часов."}
              {order.status === "ASSEMBLING" && "Оплата получена. Собираем и упаковываем заказ."}
              {order.status === "SHIPPED" && "Заказ передан в доставку."}
              {order.status === "READY_FOR_PICKUP" && "Заказ прибыл — можно забирать."}
              {order.status === "COMPLETED" && "Заказ получен. Спасибо за покупку!"}
              {order.status === "CANCELLED" && "Заказ отменён."}
            </div>
          </div>
        </div>

        {awaiting && order.rejectReason && (
          <div className="banner error mt-16">
            <b>Чек отклонён:</b> {order.rejectReason}. Проверьте перевод и прикрепите правильный чек.
          </div>
        )}

        {(awaiting || review) && p && (
          <div className="section">
            <div className="section-header">Реквизиты для оплаты</div>
            <div className="list">
              <CopyValue label="Сумма к оплате" value={String(order.total / 100)} display={rub(order.total)} />
              {p.sbpPhone && (
                <CopyValue
                  label={<PayLabel title="Перевод по СБП" bank={p.sbpBank} />}
                  value={p.sbpPhone.replace(/[^\d+]/g, "")}
                  display={p.sbpPhone}
                />
              )}
              {p.cardNumber && (
                <CopyValue
                  label={<PayLabel title="Перевод на карту" bank={p.cardBank} />}
                  value={p.cardNumber.replace(/\s/g, "")}
                  display={p.cardNumber.replace(/\s/g, "").replace(/(\d{4})(?=\d)/g, "$1 ")}
                />
              )}
              {p.recipientName && (
                <div className="cell">
                  <div className="cell-main">
                    <div className="footnote">Получатель</div>
                    <div style={{ marginTop: 2 }}>{p.recipientName}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="section-footer">
              {p.instructions || "Переведите точную сумму. В комментарии к переводу ничего писать не нужно."}
            </div>
          </div>
        )}

        {(awaiting || review) && (
          <div className="section">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <button className={`btn block ${review ? "gray" : ""}`} disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Spinner /> : (
                <>
                  <Icon name="upload" size={20} /> {review ? "Добавить ещё чек" : "Я оплатил — прикрепить чек"}
                </>
              )}
            </button>
            <div className="section-footer">Скриншот из банковского приложения или PDF-квитанция, до 10 МБ.</div>
          </div>
        )}

        {order.status === "SHIPPED" && order.trackingNumber && (
          <div className="section">
            <div className="list">
              <CopyValue label="Трек-номер" value={order.trackingNumber} />
            </div>
          </div>
        )}
        {order.status === "READY_FOR_PICKUP" && order.pickupInfo && (
          <div className="banner info mt-16">{order.pickupInfo}</div>
        )}

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
                    {i.color ? ` · ${i.color}` : ""} · {i.quantity} шт.
                  </div>
                </div>
                <div className="price">{rub(i.unitPrice * i.quantity)}</div>
              </div>
            ))}
            <div className="cell">
              <div className="cell-main">Доставка · {DELIVERY_LABEL[order.deliveryMethod]}</div>
              <div className="cell-value">{rub(order.deliveryPrice)}</div>
            </div>
            <div className="cell">
              <div className="cell-main headline">Итого</div>
              <div className="price">{rub(order.total)}</div>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">Получение</div>
          <div className="list">
            <div className="cell">
              <div className="cell-main">
                <div>{order.contactName}</div>
                <div className="cell-sub">{order.contactPhone}</div>
              </div>
            </div>
            {order.deliveryAddress && (
              <div className="cell">
                <div className="cell-main subhead">{order.deliveryAddress}</div>
              </div>
            )}
            {order.customerComment && (
              <div className="cell">
                <div className="cell-main subhead muted">{order.customerComment}</div>
              </div>
            )}
          </div>
        </div>

        {order.receipts.length > 0 && (
          <div className="section">
            <div className="section-header">Чеки</div>
            <div className="list">
              <button className="cell" onClick={() => setShowReceipts(!showReceipts)}>
                <div className="cell-main">Загружено: {order.receipts.length}</div>
                <span className="cell-chevron">
                  <Icon name={showReceipts ? "chevronUp" : "chevronDown"} size={18} stroke={2} />
                </span>
              </button>
              {showReceipts &&
                order.receipts.map((r) => (
                  <div key={r.id} className="cell" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="footnote">
                      {dateTime(r.createdAt)}
                      {r.approved === true && " · принят"}
                      {r.approved === false && ` · отклонён${r.note ? `: ${r.note}` : ""}`}
                    </div>
                    <AuthImage path={`/orders/${order.number}/receipts/${r.id}`} alt={`receipt-${r.id}`} className="receipt-img" />
                  </div>
                ))}
            </div>
          </div>
        )}

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

        {awaiting && (
          <div className="section">
            <div className="list">
              <button className="cell destructive" onClick={cancel} style={{ justifyContent: "center" }}>
                Отменить заказ
              </button>
            </div>
          </div>
        )}

        {(config?.supportTelegram || config?.supportEmail) && (
          <div className="section-footer center mt-16">
            Вопросы по заказу:{" "}
            {config.supportTelegram ? (
              <a className="link-btn" href={`https://t.me/${config.supportTelegram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">
                {config.supportTelegram.startsWith("@") ? config.supportTelegram : `@${config.supportTelegram}`}
              </a>
            ) : (
              <a className="link-btn" href={`mailto:${config.supportEmail}`}>
                {config.supportEmail}
              </a>
            )}
          </div>
        )}
        <div className="center mt-16">
          <Link to="/orders" className="link-btn subhead">
            Все заказы
          </Link>
        </div>
      </div>
    </>
  );
}
