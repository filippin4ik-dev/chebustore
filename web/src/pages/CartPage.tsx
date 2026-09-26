import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { Empty, NavBar, Stepper } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { rub } from "../lib/format";
import { useToast } from "../lib/toast";
import type { Cart } from "../lib/types";

export default function CartPage() {
  const { user, cart, setCart } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!user) {
    return (
      <>
        <NavBar title="Корзина" />
        <Empty
          icon="bag"
          title="Войдите, чтобы собрать корзину"
          text="Корзина синхронизируется между сайтом, Telegram и приложением."
          action={
            <Link className="btn medium" to="/login?next=/cart">
              Войти
            </Link>
          }
        />
      </>
    );
  }

  const setQty = async (variantId: string, quantity: number) => {
    setBusy(variantId);
    try {
      setCart(await api.put<Cart>("/cart/items", { variantId, quantity }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setBusy(null);
    }
  };

  const items = cart?.items ?? [];
  const hasIssues = items.some((i) => i.issue);

  return (
    <>
      <NavBar title="Корзина" />
      <div className="container narrow">
        {items.length === 0 ? (
          <Empty
            icon="bag"
            title="В корзине пусто"
            text="Загляните в каталог — там много интересного."
            action={
              <Link className="btn medium" to="/">
                В каталог
              </Link>
            }
          />
        ) : (
          <>
            <div className="section">
              <div className="list">
                {items.map((i) => (
                  <div key={i.id} className="cell inset-sep" style={{ opacity: busy === i.variantId ? 0.5 : 1 }}>
                    <Link to={`/p/${i.productSlug}`}>
                      {i.image ? <img className="thumb" src={i.image} alt="" /> : <div className="thumb placeholder-img"><Icon name="photo" size={20} /></div>}
                    </Link>
                    <div className="cell-main">
                      <div className="cell-title">{i.productTitle}</div>
                      <div className="cell-sub">
                        {i.size}
                        {i.color ? ` · ${i.color}` : ""}
                      </div>
                      {i.issue && <div className="footnote" style={{ color: "var(--red)" }}>{i.issue}</div>}
                      <div className="row-flex mt-8" style={{ justifyContent: "space-between" }}>
                        <span className="price">{rub(i.unitPrice * i.quantity)}</span>
                        {i.purchasable ? (
                          <Stepper value={i.quantity} max={i.maxQuantity} onChange={(q) => setQty(i.variantId, q)} />
                        ) : (
                          <button className="link-btn subhead" onClick={() => setQty(i.variantId, 0)}>
                            Удалить
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="list">
                <div className="cell">
                  <div className="cell-main">Товары</div>
                  <div className="cell-value">{cart?.count} шт.</div>
                </div>
                <div className="cell">
                  <div className="cell-main headline">Итого</div>
                  <div className="price">{rub(cart?.itemsTotal ?? 0)}</div>
                </div>
              </div>
              <div className="section-footer">Стоимость доставки рассчитается при оформлении.</div>
            </div>
            <div className="sticky-pad" />
            <div className="sticky-bottom">
              <div className="inner">
                <button className="btn block" disabled={hasIssues || !cart?.itemsTotal} onClick={() => navigate("/checkout")}>
                  {hasIssues ? "Уберите недоступные товары" : `Оформить · ${rub(cart?.itemsTotal ?? 0)}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
