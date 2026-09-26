import { useState } from "react";
import { ErrorState, PageLoader, Sheet, useAsync } from "../components/ui";
import { Icon } from "../components/Icon";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/toast";
import type { AdminCategory } from "../lib/types";
import { useLive } from "../lib/live";

export default function AdminCategories() {
  const toast = useToast();
  const { data, error, loading, reload, refresh } = useAsync(() => api.get<{ categories: AdminCategory[] }>("/admin/categories").then((r) => r.categories), []);
  useLive(["catalog"], () => void refresh());
  const [editing, setEditing] = useState<Partial<AdminCategory> | null>(null);

  const save = async () => {
    if (!editing?.name?.trim()) return;
    try {
      const body = { name: editing.name.trim(), sortOrder: Number(editing.sortOrder ?? 0), isActive: editing.isActive ?? true };
      if (editing.id) await api.patch(`/admin/categories/${editing.id}`, body);
      else await api.post("/admin/categories", body);
      setEditing(null);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  const remove = async () => {
    if (!editing?.id || !confirm("Удалить категорию? Товары останутся, но без категории.")) return;
    try {
      await api.del(`/admin/categories/${editing.id}`);
      setEditing(null);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState message={error} retry={reload} />;

  return (
    <div className="container narrow">
      <div className="row-flex" style={{ justifyContent: "space-between" }}>
        <h1 className="large-title">Категории</h1>
        <button className="btn small" onClick={() => setEditing({ name: "", sortOrder: (data?.length ?? 0) + 1, isActive: true })}>
          <Icon name="plus" size={18} stroke={2.2} /> Новая
        </button>
      </div>
      <div className="section">
        <div className="list">
          {(data ?? []).map((c) => (
            <button key={c.id} className="cell" onClick={() => setEditing(c)}>
              <div className="cell-main">
                <div>{c.name}</div>
                <div className="cell-sub">
                  {c.productCount} товаров{!c.isActive && " · скрыта"}
                </div>
              </div>
              <span className="cell-chevron">
                <Icon name="chevronRight" size={18} stroke={2} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? "Категория" : "Новая категория"}>
        <div className="list">
          <div className="field">
            <label>Название</label>
            <input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={64} autoFocus />
          </div>
          <div className="field">
            <label>Порядок</label>
            <input value={editing?.sortOrder ?? 0} inputMode="numeric" onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value.replace(/[^\d-]/g, "")) })} />
          </div>
          <div className="field">
            <label style={{ flex: 1 }}>Показывать</label>
            <input type="checkbox" className="switch" checked={editing?.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
          </div>
        </div>
        <button className="btn block mt-16" onClick={save}>
          Сохранить
        </button>
        {editing?.id && (
          <button className="btn block danger mt-8" onClick={remove}>
            Удалить
          </button>
        )}
      </Sheet>
    </div>
  );
}
