import { Link } from "react-router-dom";
import { ErrorState, PageLoader, StatusBadge, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { rub } from "../lib/format";
import type { OrderStatus } from "../lib/types";
import { useLive } from "../lib/live";

interface Stats {
  byStatus: Partial<Record<OrderStatus, number>>;
  revenue: Record<"day" | "week" | "month", { sum: number; count: number }>;
  customers: number;
  lowStock: number;
}

const ORDER: OrderStatus[] = ["PAYMENT_REVIEW", "AWAITING_PAYMENT", "ASSEMBLING", "SHIPPED", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"];

export default function Dashboard() {
  const { data, error, loading, reload, refresh } = useAsync(() => api.get<Stats>("/admin/stats"), []);
  useLive(["orders", "catalog"], () => void refresh());
  if (loading && !data) return <PageLoader />;
  if (error || !data) return <ErrorState message={error ?? ""} retry={reload} />;
  const review = data.byStatus.PAYMENT_REVIEW ?? 0;

  return (
    <div className="container">
      <h1 className="large-title">Сводка</h1>
      {review > 0 && (
        <Link to="/admin/orders?status=PAYMENT_REVIEW" className="banner warn" style={{ display: "block", marginBottom: 16 }}>
          <b>Чеков на проверке: {review}</b> — сверьте поступления и подтвердите оплату.
        </Link>
      )}
      <div className="stats">
        {(["day", "week", "month"] as const).map((k) => (
          <div className="stat" key={k}>
            <div className="footnote">{k === "day" ? "Сегодня" : k === "week" ? "7 дней" : "30 дней"}</div>
            <div className="stat-value">{rub(data.revenue[k].sum)}</div>
            <div className="caption">{data.revenue[k].count} оплаченных заказов</div>
          </div>
        ))}
        <div className="stat">
          <div className="footnote">Покупатели</div>
          <div className="stat-value">{data.customers}</div>
        </div>
        <Link className="stat" to="/admin/products">
          <div className="footnote">Мало на складе</div>
          <div className="stat-value" style={{ color: data.lowStock ? "var(--orange)" : undefined }}>{data.lowStock}</div>
          <div className="caption">вариантов ≤ 2 шт.</div>
        </Link>
      </div>

      <div className="section">
        <div className="section-header">Заказы по статусам</div>
        <div className="list">
          {ORDER.map((s) => (
            <Link key={s} to={`/admin/orders?status=${s}`} className="cell">
              <div className="cell-main">
                <StatusBadge status={s} />
              </div>
              <div className="cell-value">{data.byStatus[s] ?? 0}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
