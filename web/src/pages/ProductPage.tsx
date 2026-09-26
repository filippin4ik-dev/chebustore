import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ErrorState, NavBar, PageLoader, useAsync } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { rub } from "../lib/format";
import { haptic } from "../lib/telegram";
import { useToast } from "../lib/toast";
import type { Cart, Product } from "../lib/types";
import { useLive } from "../lib/live";

export default function ProductPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, cart, setCart } = useAuth();
  const { data, error, loading, reload, refresh } = useAsync(
    () => api.get<{ product: Product }>(`/products/${encodeURIComponent(slug)}`).then((r) => r.product),
    [slug],
  );
  useLive(["catalog"], () => void refresh());
  const [color, setColor] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [adding, setAdding] = useState(false);

  const colors = useMemo(() => [...new Set((data?.variants ?? []).map((v) => v.color).filter(Boolean))], [data]);
  const activeColor = color ?? colors[0] ?? "";
  const sizes = (data?.variants ?? []).filter((v) => !colors.length || v.color === activeColor);
  const selected = sizes.find((v) => v.id === variantId) ?? null;
  const inCart = cart?.items.find((i) => i.variantId === selected?.id);

  if (loading && !data) return <PageLoader />;
  if (error || !data) return <ErrorState message={error ?? "Товар не найден"} retry={reload} />;
  const p = data;
  const price = selected?.price ?? p.price;

  const add = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/p/${slug}`)}`);
      return;
    }
    if (!selected) {
      haptic("error");
      toast("Выберите размер", true);
      return;
    }
    setAdding(true);
    try {
      const next = await api.put<Cart>("/cart/items", { variantId: selected.id, quantity: (inCart?.quantity ?? 0) + 1 });
      setCart(next);
      toast("Добавлено в корзину");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось добавить", true);
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <NavBar title={p.title} back="/" />
      <div className="container">
        <div className="product-layout">
          <div className="gallery-col">
            <div
              className="gallery"
              onScroll={(e) => {
                const el = e.currentTarget;
                setSlide(Math.round(el.scrollLeft / el.clientWidth));
              }}
            >
              {p.images.length ? (
                p.images.map((img, i) => (
                  <img key={img.id} src={img.url} alt={`${p.title} — фото ${i + 1}`} width={img.width} height={img.height} />
                ))
              ) : (
                <div className="placeholder-img">
                  <Icon name="photo" size={40} />
                </div>
              )}
            </div>
            {p.images.length > 1 && (
              <div className="dots">
                {p.images.map((img, i) => (
                  <span key={img.id} className={`dot ${i === slide ? "active" : ""}`} />
                ))}
              </div>
            )}
          </div>

          <div>
            {p.category && <div className="footnote">{p.category.name}</div>}
            <h1 className="title-2" style={{ marginTop: 4 }}>{p.title}</h1>
            <div className="title-3 mt-8">
              <span className="price">{rub(price)}</span>
              {p.oldPrice && p.oldPrice > price && <span className="old-price">{rub(p.oldPrice)}</span>}
            </div>

            {colors.length > 1 && (
              <div className="mt-24">
                <div className="footnote" style={{ marginBottom: 8 }}>Цвет: {activeColor}</div>
                <div className="sizes">
                  {colors.map((c) => (
                    <button
                      key={c}
                      className={`size ${c === activeColor ? "active" : ""}`}
                      onClick={() => {
                        setColor(c);
                        setVariantId(null);
                        haptic("select");
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sizes.length > 0 && (
              <div className="mt-24">
                <div className="footnote" style={{ marginBottom: 8 }}>
                  Размер{selected?.lowStock ? " · осталось мало" : ""}
                </div>
                <div className="sizes">
                  {sizes.map((v) => (
                    <button
                      key={v.id}
                      className={`size ${v.id === variantId ? "active" : ""}`}
                      disabled={!v.available}
                      onClick={() => {
                        setVariantId(v.id);
                        haptic("select");
                      }}
                    >
                      {v.size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-24 hide-mobile">
              <button className="btn block" onClick={add} disabled={adding || !p.available}>
                {!p.available ? "Нет в наличии" : inCart ? `В корзине · ${inCart.quantity} — добавить ещё` : "Добавить в корзину"}
              </button>
            </div>

            {p.description && (
              <div className="section">
                <div className="section-header">Описание</div>
                <div className="list" style={{ padding: "12px 16px" }}>
                  <div className="description">{p.description}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="sticky-pad" />
      </div>
      <div className="sticky-bottom mobile-only">
        <div className="inner">
          <button className="btn block" onClick={add} disabled={adding || !p.available}>
            {!p.available ? "Нет в наличии" : inCart ? `В корзине · ${inCart.quantity} — добавить ещё` : `В корзину · ${rub(price)}`}
          </button>
        </div>
      </div>
    </>
  );
}
