import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Empty, ErrorState, PageLoader, StatusBadge, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, rub, STATUS_LABEL } from "../lib/format";
import type { Order, OrderStatus } from "../lib/types";

const FILTERS: (OrderStatus | "")[] = ["", "PAYMENT_REVIEW", "AWAITING_PAYMENT", "ASSEMBLING", "SHIPPED", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"];

export default function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as OrderStatus | "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [page, setPage] = useState(1);
  const query = params.get("q") ?? "";

  const { data, error, loading, reload } = useAsync(() => {
    const qs = new URLSearchParams({ page: String(page) });
    if (status) qs.set("status", status);
    if (query) qs.set("q", query);
    return api.get<{ orders: Order[]; total: number; pageSize: number }>(`/admin/orders?${qs}`);
  }, [status, query, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      if (next.toString() !== params.toString()) {
        setPage(1);
        setParams(next, { replace: true });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="container">
      <h1 className="large-title">Заказы</h1>
      <label className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Номер, имя, телефон, почта, @username" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="chips mt-16">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            className={`chip ${status === f ? "active" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (f) next.set("status", f);
              else next.delete("status");
              setPage(1);
              setParams(next, { replace: true });
            }}
          >
            {f ? STATUS_LABEL[f] : "Все"}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : !data?.orders.length ? (
        <Empty icon="list" title="Заказов нет" />
      ) : (
        <>
          <div className="section">
            <div className="list">
              {data.orders.map((o) => (
                <Link key={o.id} to={`/admin/orders/${o.number}`} className="cell">
                  <div className="cell-main">
                    <div className="row-flex" style={{ justifyContent: "space-between" }}>
                      <span className="headline">№{o.number}</span>
                      <span className="price">{rub(o.total)}</span>
                    </div>
                    <div className="cell-sub">
                      {o.contactName} · {o.contactPhone}
                    </div>
                    <div className="row-flex mt-8" style={{ justifyContent: "space-between" }}>
                      <StatusBadge status={o.status} />
                      <span className="caption">{dateTime(o.createdAt)}</span>
                    </div>
                  </div>
                  <span className="cell-chevron">
                    <Icon name="chevronRight" size={18} stroke={2} />
                  </span>
                </Link>
              ))}
            </div>
            <div className="section-footer">Всего: {data.total}</div>
          </div>
          {data.total > data.pageSize && (
            <div className="row-flex mt-16" style={{ justifyContent: "center" }}>
              <button className="btn small gray" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Назад
              </button>
              <span className="footnote">
                {page} / {Math.ceil(data.total / data.pageSize)}
              </span>
              <button className="btn small gray" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>
                Далее
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
