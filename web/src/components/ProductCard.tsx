import { Link } from "react-router-dom";
import { rub } from "../lib/format";
import type { Product } from "../lib/types";
import { Icon } from "./Icon";

export function ProductCard({ p }: { p: Product }) {
  const img = p.images[0];
  return (
    <Link to={`/p/${p.slug}`}>
      <div className="card-img">
        {img ? (
          <img src={img.url} alt={p.title} loading="lazy" width={img.width} height={img.height} />
        ) : (
          <div className="placeholder-img">
            <Icon name="photo" size={32} />
          </div>
        )}
        {!p.available && <span className="soldout-tag">Нет в наличии</span>}
      </div>
      <div className="card-title">{p.title}</div>
      <div className="subhead" style={{ marginTop: 2 }}>
        <span className="price">{rub(p.price)}</span>
        {p.oldPrice && p.oldPrice > p.price && <span className="old-price">{rub(p.oldPrice)}</span>}
      </div>
    </Link>
  );
}
