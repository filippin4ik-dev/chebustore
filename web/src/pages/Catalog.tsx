import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ProductCard } from "../components/ProductCard";
import { Empty, ErrorState, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Category, Product } from "../lib/types";

interface ProductsPage {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export default function Catalog() {
  const { config } = useAuth();
  const [params, setParams] = useSearchParams();
  const category = params.get("c") ?? "";
  const sort = params.get("sort") ?? "new";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ categories: Category[] }>("/categories").then((r) => setCategories(r.categories), () => undefined);
  }, []);

  const q = params.get("q") ?? "";
  const load = async (p: number) => {
    const qs = new URLSearchParams({ page: String(p), sort });
    if (category) qs.set("category", category);
    if (q) qs.set("q", q);
    return api.get<ProductsPage>(`/products?${qs}`);
  };

  useEffect(() => {
    let cancelled = false;
    setProducts(null);
    setError(null);
    load(1)
      .then((r) => {
        if (cancelled) return;
        setProducts(r.products);
        setTotal(r.total);
        setPage(1);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [category, sort, q]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (query.trim()) next.set("q", query.trim());
      else next.delete("q");
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await load(page + 1);
      setProducts((prev) => [...(prev ?? []), ...r.products]);
      setPage(page + 1);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="container">
      <div className="brand-title">
        <h1 className="large-title">{config?.storeName ?? "CHEBU"}</h1>
        <img className="logo" src="/logo-192.jpg" alt="" width={40} height={40} />
      </div>
      <label className="search">
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder="Поиск"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
      </label>

      {categories.length > 0 && (
        <div className="chips mt-16">
          <button className={`chip ${!category ? "active" : ""}`} onClick={() => setParam("c", "")}>
            Все
          </button>
          {categories.map((c) => (
            <button key={c.id} className={`chip ${category === c.slug ? "active" : ""}`} onClick={() => setParam("c", c.slug)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="row-flex mt-16" style={{ justifyContent: "space-between" }}>
        <span className="footnote">{products ? `${total} ${plural(total)}` : " "}</span>
        <select
          className="footnote"
          value={sort}
          onChange={(e) => setParam("sort", e.target.value === "new" ? "" : e.target.value)}
          style={{ border: 0, background: "transparent", color: "var(--blue)", fontSize: 13 }}
          aria-label="Сортировка"
        >
          <option value="new">Сначала новые</option>
          <option value="price_asc">Сначала дешевле</option>
          <option value="price_desc">Сначала дороже</option>
        </select>
      </div>

      <div className="mt-8">
        {error ? (
          <ErrorState message={error} retry={() => setParams(new URLSearchParams(params))} />
        ) : !products ? (
          <div className="grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <div className="card-img skeleton" />
                <div className="skeleton skeleton-line" style={{ width: "80%" }} />
                <div className="skeleton skeleton-line" style={{ width: "40%" }} />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <Empty icon="search" title="Ничего не найдено" text="Попробуйте изменить запрос или выбрать другую категорию." />
        ) : (
          <>
            <div className="grid">
              {products.map((p, i) => (
                <ProductCard key={p.id} p={p} index={i} />
              ))}
            </div>
            {products.length < total && (
              <div className="center mt-24">
                <button className="btn gray medium" onClick={more} disabled={loadingMore}>
                  {loadingMore ? <Spinner /> : "Показать ещё"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "товар";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "товара";
  return "товаров";
}
