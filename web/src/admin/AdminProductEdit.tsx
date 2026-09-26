import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { ErrorState, NavBar, PageLoader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { toKopecks, toRubles } from "../lib/format";
import { useToast } from "../lib/toast";
import type { AdminCategory, AdminProduct } from "../lib/types";

interface VariantDraft {
  key: string;
  id?: string;
  size: string;
  color: string;
  price: string;
  stock: string;
  isActive: boolean;
}

const QUICK_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "ONE SIZE"];
let keySeq = 0;
const newKey = () => `v${++keySeq}`;

export default function AdminProductEdit() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [oldPrice, setOldPrice] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [variants, setVariants] = useState<VariantDraft[]>([]);

  const fill = (p: AdminProduct) => {
    setProduct(p);
    setTitle(p.title);
    setDescription(p.description);
    setCategoryId(p.categoryId ?? "");
    setPrice(toRubles(p.basePrice));
    setOldPrice(toRubles(p.oldPrice));
    setIsActive(p.isActive);
    setVariants(
      p.variants.map((v) => ({
        key: newKey(),
        id: v.id,
        size: v.size,
        color: v.color,
        price: toRubles(v.price),
        stock: String(v.stock),
        isActive: v.isActive,
      })),
    );
  };

  useEffect(() => {
    api.get<{ categories: AdminCategory[] }>("/admin/categories").then((r) => setCategories(r.categories), () => undefined);
    if (isNew) return;
    api
      .get<{ product: AdminProduct }>(`/admin/products/${id}`)
      .then((r) => fill(r.product))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} />;

  const updateVariant = (key: string, patch: Partial<VariantDraft>) =>
    setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const addSize = (size = "") =>
    setVariants((vs) => [...vs, { key: newKey(), size, color: vs[vs.length - 1]?.color ?? "", price: "", stock: "0", isActive: true }]);

  const save = async () => {
    if (!title.trim()) return toast("Укажите название", true);
    if (!price || toKopecks(price) <= 0) return toast("Укажите цену", true);
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        description,
        categoryId: categoryId || null,
        basePrice: toKopecks(price),
        oldPrice: oldPrice ? toKopecks(oldPrice) : null,
        isActive,
      };
      const saved = isNew
        ? (await api.post<{ product: AdminProduct }>("/admin/products", body)).product
        : (await api.patch<{ product: AdminProduct }>(`/admin/products/${id}`, body)).product;
      const withVariants = await api.put<{ product: AdminProduct }>(`/admin/products/${saved.id}/variants`, {
        variants: variants
          .filter((v) => v.size.trim())
          .map((v) => ({
            id: v.id,
            size: v.size.trim(),
            color: v.color.trim(),
            price: v.price ? toKopecks(v.price) : null,
            stock: Math.max(0, parseInt(v.stock || "0", 10) || 0),
            isActive: v.isActive,
          })),
      });
      toast("Сохранено");
      if (isNew) navigate(`/admin/products/${saved.id}`, { replace: true });
      else fill(withVariants.product);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось сохранить", true);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: FileList) => {
    if (!product) return;
    setUploading(true);
    try {
      let current = product;
      for (const file of Array.from(files)) {
        current = (await api.upload<{ product: AdminProduct }>(`/admin/products/${product.id}/images`, file)).product;
      }
      setProduct(current);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Не удалось загрузить фото", true);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = async (imageId: string) => {
    if (!product || !confirm("Удалить фото?")) return;
    const r = await api.del<{ product: AdminProduct }>(`/admin/products/${product.id}/images/${imageId}`);
    setProduct(r.product);
  };

  const moveImage = async (index: number, dir: -1 | 1) => {
    if (!product) return;
    const ids = product.images.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    const r = await api.put<{ product: AdminProduct }>(`/admin/products/${product.id}/images/order`, { ids });
    setProduct(r.product);
  };

  const remove = async () => {
    if (!product || !confirm(`Удалить «${product.title}» навсегда? Лучше скрыть товар, если он есть в заказах.`)) return;
    try {
      await api.del(`/admin/products/${product.id}`);
      navigate("/admin/products", { replace: true });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  return (
    <>
      <NavBar
        title={isNew ? "Новый товар" : "Товар"}
        back="/admin/products"
        right={
          <button className="nav-btn" style={{ fontWeight: 600 }} onClick={save} disabled={saving}>
            {saving ? <Spinner /> : "Сохранить"}
          </button>
        }
      />
      <div className="container narrow">
        <div className="section">
          <div className="section-header">Основное</div>
          <div className="list">
            <div className="field">
              <label>Название</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Худи оверсайз" />
            </div>
            <div className="field">
              <label>Категория</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Без категории</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Цена, ₽</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="4990" />
            </div>
            <div className="field">
              <label>Старая цена</label>
              <input value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} inputMode="decimal" placeholder="Для скидки, необязательно" />
            </div>
            <div className="field">
              <label style={{ flex: 1 }}>Показывать в каталоге</label>
              <input type="checkbox" className="switch" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">Описание</div>
          <div className="list">
            <div className="field">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder="Состав, посадка, уход, параметры модели" style={{ minHeight: 120 }} />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-header">Фото</div>
          <div className="list">
            {product ? (
              <div className="image-grid">
                {product.images.map((img, i) => (
                  <div className="image-tile" key={img.id}>
                    <img src={img.url} alt="" />
                    <div className="tile-actions">
                      <button className="tile-btn" onClick={() => moveImage(i, -1)} aria-label="Левее">
                        <Icon name="chevronLeft" size={14} stroke={2.4} />
                      </button>
                      <button className="tile-btn" onClick={() => removeImage(img.id)} aria-label="Удалить">
                        <Icon name="trash" size={14} stroke={2} />
                      </button>
                      <button className="tile-btn" onClick={() => moveImage(i, 1)} aria-label="Правее">
                        <Icon name="chevronRight" size={14} stroke={2.4} />
                      </button>
                    </div>
                  </div>
                ))}
                <button className="upload-tile" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Spinner /> : <Icon name="plus" size={24} />}
                  {uploading ? "" : "Добавить"}
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
              </div>
            ) : (
              <div className="cell footnote">Сохраните товар, чтобы добавить фото.</div>
            )}
          </div>
          <div className="section-footer">Первое фото — обложка. Фото автоматически сжимаются, метаданные (EXIF, геолокация) удаляются.</div>
        </div>

        <div className="section">
          <div className="section-header">Размеры и остатки</div>
          <div className="list">
            {variants.length > 0 && (
              <div className="variant-row variant-head">
                <span>Размер</span>
                <span className="v-color">Цвет</span>
                <span>Цена ₽</span>
                <span>Остаток</span>
                <span>Вкл.</span>
                <span />
              </div>
            )}
            {variants.map((v) => (
              <div className="variant-row" key={v.key}>
                <input className="table-input" value={v.size} onChange={(e) => updateVariant(v.key, { size: e.target.value })} placeholder="M" maxLength={24} />
                <input className="table-input v-color" value={v.color} onChange={(e) => updateVariant(v.key, { color: e.target.value })} placeholder="—" maxLength={32} />
                <input className="table-input" value={v.price} onChange={(e) => updateVariant(v.key, { price: e.target.value })} placeholder="базовая" inputMode="decimal" />
                <input className="table-input" value={v.stock} onChange={(e) => updateVariant(v.key, { stock: e.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                <input type="checkbox" className="switch" style={{ transform: "scale(0.8)" }} checked={v.isActive} onChange={(e) => updateVariant(v.key, { isActive: e.target.checked })} />
                <button className="link-btn" style={{ color: "var(--red)" }} onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))} aria-label="Удалить">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
            <div className="cell" style={{ flexWrap: "wrap", gap: 8 }}>
              {QUICK_SIZES.filter((s) => !variants.some((v) => v.size === s)).map((s) => (
                <button key={s} className="chip" onClick={() => addSize(s)}>
                  + {s}
                </button>
              ))}
              <button className="chip" onClick={() => addSize()}>
                + Свой
              </button>
            </div>
          </div>
          <div className="section-footer">Пустая цена — используется базовая. Цвет нужен, только если у товара несколько расцветок.</div>
        </div>

        <button className="btn block mt-24" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : "Сохранить"}
        </button>

        {product && (
          <div className="section">
            <div className="list">
              <button className="cell destructive" style={{ justifyContent: "center" }} onClick={remove}>
                Удалить товар
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
