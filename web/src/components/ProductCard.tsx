import { useState } from "react";
import { Link } from "react-router-dom";
import { rub } from "../lib/format";
import type { Product } from "../lib/types";
import { Icon } from "./Icon";

export function ProductCard({ p, index = 0 }: { p: Product; index?: number }) {
  const img = p.images[0];
  const second = p.images[1];
  const [loaded, setLoaded] = useState(false);
  return (
    <Link to={`/p/${p.slug}`} className="card" style={{ animationDelay: `${Math.min(index, 11) * 40}ms` }}>
      <div className={`card-img${loaded ? " loaded" : ""}`}>
        {img ? (
          <>
            <img
              src={img.url}
              alt={p.title}
              loading="lazy"
              width={img.width}
              height={img.height}
              onLoad={() => setLoaded(true)}
              ref={(el) => {
                if (el?.complete && el.naturalWidth && !loaded) setLoaded(true);
              }}
            />
            {second && <img className="card-img-alt" src={second.url} alt="" loading="lazy" aria-hidden />}
          </>
        ) : (
          <div className="placeholder-img">
            <Icon name="photo" size={32} />
          </div>
        )}
        {!p.available && <span className="soldout-tag">Нет в наличии</span>}
        {p.available && p.oldPrice && p.oldPrice > p.price && (
          <span className="sale-tag">−{Math.round((1 - p.price / p.oldPrice) * 100)}%</span>
        )}
      </div>
      <div className="card-title">{p.title}</div>
      <div className="subhead" style={{ marginTop: 2 }}>
        <span className="price">{rub(p.price)}</span>
        {p.oldPrice && p.oldPrice > p.price && <span className="old-price">{rub(p.oldPrice)}</span>}
      </div>
    </Link>
  );
}
