import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Empty, ErrorState, NavBar, PageLoader, StatusBadge, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { date, rub } from "../lib/format";
import type { Order } from "../lib/types";
import { useLive } from "../lib/live";

export default function Orders() {
  const { user } = useAuth();
  const { data, error, loading, reload, refresh } = useAsync(
    () => (user ? api.get<{ orders: Order[] }>("/orders").then((r) => r.orders) : Promise.resolve([])),
    [user?.id],
  );
  useLive(["order"], () => void refresh());

  if (!user) {
    return (
      <>
        <NavBar title="Заказы" />
        <Empty
          icon="list"
          title="Войдите, чтобы видеть заказы"
          action={
            <Link className="btn medium" to="/login?next=/orders">
              Войти
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <NavBar title="Заказы" />
      <div className="container narrow">
        {loading && !data ? (
          <PageLoader />
        ) : error ? (
          <ErrorState message={error} retry={reload} />
        ) : !data?.length ? (
          <Empty icon="box" title="Заказов пока нет" text="Здесь появятся ваши заказы и их статусы." />
        ) : (
          <div className="section">
            <div className="list">
              {data.map((o) => (
                <Link key={o.id} to={`/orders/${o.number}`} className="cell inset-sep">
                  {o.items[0]?.image ? (
                    <img className="thumb" src={o.items[0].image} alt="" />
                  ) : (
                    <div className="thumb placeholder-img">
                      <Icon name="box" size={20} />
                    </div>
                  )}
                  <div className="cell-main">
                    <div className="row-flex" style={{ justifyContent: "space-between" }}>
                      <span className="headline">№{o.number}</span>
                      <span className="price">{rub(o.total)}</span>
                    </div>
                    <div className="cell-sub">
                      {date(o.createdAt)} · {o.items.reduce((s, i) => s + i.quantity, 0)} шт.
                    </div>
                    <div className="mt-8">
                      <StatusBadge status={o.status} />
                    </div>
                  </div>
                  <span className="cell-chevron">
                    <Icon name="chevronRight" size={18} stroke={2} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
