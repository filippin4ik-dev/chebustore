import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { ErrorState, PageLoader, Sheet, useAsync } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, userName } from "../lib/format";
import { useToast } from "../lib/toast";
import type { AdminUser, Role } from "../lib/types";
import { useLive } from "../lib/live";

const ROLE_LABEL: Record<Role, string> = { CUSTOMER: "Покупатель", MANAGER: "Менеджер", ADMIN: "Администратор" };

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const isAdmin = me?.role === "ADMIN";

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, loading, reload, refresh } = useAsync(() => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (role) qs.set("role", role);
    return api.get<{ users: AdminUser[]; total: number }>(`/admin/users?${qs}`);
  }, [query, role]);
  useLive(["users"], () => void refresh());

  const update = async (patch: { role?: Role; isBlocked?: boolean }) => {
    if (!selected) return;
    const warn = patch.isBlocked
      ? "Заблокировать пользователя? Все его сеансы будут завершены."
      : patch.role
        ? `Назначить роль «${ROLE_LABEL[patch.role]}»? Пользователю нужно будет войти заново.`
        : null;
    if (warn && !confirm(warn)) return;
    try {
      const r = await api.patch<{ user: AdminUser }>(`/admin/users/${selected.id}`, patch);
      setSelected({ ...selected, ...r.user });
      reload();
      toast("Сохранено");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  return (
    <div className="container narrow">
      <h1 className="large-title">Пользователи</h1>
      <label className="search">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Почта, @username, имя, телефон" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="chips mt-16">
        {(["", "CUSTOMER", "MANAGER", "ADMIN"] as const).map((r) => (
          <button key={r || "all"} className={`chip ${role === r ? "active" : ""}`} onClick={() => setRole(r)}>
            {r ? ROLE_LABEL[r] : "Все"}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <PageLoader />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : (
        <div className="section">
          <div className="list">
            {data?.users.map((u) => (
              <button key={u.id} className="cell" onClick={() => setSelected(u)}>
                <div className="cell-main">
                  <div className="cell-title">
                    {userName(u)}
                    {u.isBlocked && <span className="badge s-CANCELLED" style={{ marginLeft: 8 }}>заблокирован</span>}
                  </div>
                  <div className="cell-sub">
                    {ROLE_LABEL[u.role]} · заказов: {u.orderCount}
                  </div>
                </div>
                <span className="cell-chevron">
                  <Icon name="chevronRight" size={18} stroke={2} />
                </span>
              </button>
            ))}
          </div>
          <div className="section-footer">Всего: {data?.total ?? 0}</div>
        </div>
      )}

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected ? userName(selected) : ""}>
        {selected && (
          <>
            <div className="list">
              <div className="cell">
                <div className="cell-main">Telegram</div>
                <div className="cell-value">{selected.telegramUsername ? `@${selected.telegramUsername}` : selected.telegramId ? "привязан" : "—"}</div>
              </div>
              <div className="cell">
                <div className="cell-main">Почта</div>
                <div className="cell-value">{selected.email ?? "—"}</div>
              </div>
              <div className="cell">
                <div className="cell-main">Телефон</div>
                <div className="cell-value">{selected.phone ?? "—"}</div>
              </div>
              <div className="cell">
                <div className="cell-main">Регистрация</div>
                <div className="cell-value">{dateTime(selected.createdAt)}</div>
              </div>
              <div className="cell">
                <div className="cell-main">Последний вход</div>
                <div className="cell-value">{selected.lastLoginAt ? dateTime(selected.lastLoginAt) : "—"}</div>
              </div>
            </div>
            {isAdmin && selected.id !== me?.id && (
              <>
                <div className="section">
                  <div className="section-header">Роль</div>
                  <div className="segmented">
                    {(["CUSTOMER", "MANAGER", "ADMIN"] as Role[]).map((r) => (
                      <button key={r} className={selected.role === r ? "active" : ""} onClick={() => selected.role !== r && update({ role: r })}>
                        {ROLE_LABEL[r]}
                      </button>
                    ))}
                  </div>
                  <div className="section-footer">Менеджер: заказы и товары. Администратор: плюс реквизиты, роли и журнал.</div>
                </div>
                <button className={`btn block mt-16 ${selected.isBlocked ? "gray" : "danger"}`} onClick={() => update({ isBlocked: !selected.isBlocked })}>
                  {selected.isBlocked ? "Разблокировать" : "Заблокировать"}
                </button>
              </>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}
