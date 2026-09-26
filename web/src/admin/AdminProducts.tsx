import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Empty, ErrorState, PageLoader, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { rub } from "../lib/format";
import type { AdminProduct } from "../lib/types";

export default function AdminProducts() {
  const [q, setQ] = useState("");
  const { data, error, loading, reload } = useAsync(() => api.get<{ products: AdminProduct[] }>("/admin/products").then((r) => r.products), []);
  const list = (data ?? []).filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="container">
      <div className="row-flex" style={{ justifyContent: "space-between" }}>
        <h1 className="large-title">Товары</h1>
        <Link to="/admin/products/new" className="btn small">
          <Icon name="plus" size={18} stroke={2.2} /> Новый
        </Link>
      </div>
      <label className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : !list.length ? (
        <Empty icon="tag" title="Товаров нет" text="Добавьте первый товар — с фото, размерами и остатками." />
      ) : (
        <div className="section">
          <div className="list">
            {list.map((p) => {
              const stock = p.variants.reduce((s, v) => s + (v.isActive ? v.stock : 0), 0);
              const low = p.variants.some((v) => v.isActive && v.stock <= 2);
              return (
                <Link key={p.id} to={`/admin/products/${p.id}`} className="cell inset-sep">
                  {p.images[0] ? <img className="thumb" src={p.images[0].url} alt="" /> : <div className="thumb placeholder-img"><Icon name="photo" size={20} /></div>}
                  <div className="cell-main">
                    <div className="cell-title">{p.title}</div>
                    <div className="cell-sub">
                      {rub(p.basePrice)} · <span style={{ color: low ? "var(--orange)" : undefined }}>{stock} шт.</span> · {p.variants.length} вар.
                    </div>
                    {!p.isActive && <div className="caption">Скрыт из каталога</div>}
                  </div>
                  <span className="cell-chevron">
                    <Icon name="chevronRight" size={18} stroke={2} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
