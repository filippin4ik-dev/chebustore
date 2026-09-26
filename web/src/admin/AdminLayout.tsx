import { Navigate, NavLink, Outlet } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";
import { isStaff, useAuth } from "../lib/auth";

export default function AdminLayout() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (!isStaff(user)) return <Navigate to="/" replace />;

  const links: { to: string; label: string; icon: IconName; admin?: boolean; end?: boolean }[] = [
    { to: "/admin", label: "Сводка", icon: "chart", end: true },
    { to: "/admin/orders", label: "Заказы", icon: "list" },
    { to: "/admin/products", label: "Товары", icon: "tag" },
    { to: "/admin/categories", label: "Категории", icon: "folder" },
    { to: "/admin/settings", label: "Настройки", icon: "gear" },
    { to: "/admin/users", label: "Пользователи", icon: "users" },
    { to: "/admin/audit", label: "Журнал действий", icon: "doc", admin: true },
  ];
  const visible = links.filter((l) => !l.admin || user.role === "ADMIN");

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="brand" style={{ padding: "8px 12px 16px" }}>
          АДМИНКА
        </div>
        {visible.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            <Icon name={l.icon} size={20} />
            {l.label}
          </NavLink>
        ))}
        <div style={{ height: 16 }} />
        <NavLink to="/">
          <Icon name="store" size={20} />
          Магазин
        </NavLink>
      </aside>
      <main className="admin-main">
        <div className="container admin-mobile-nav" style={{ paddingTop: 8 }}>
          <div className="chips">
            <NavLink to="/" className="chip">
              <Icon name="chevronLeft" size={16} stroke={2.2} /> Магазин
            </NavLink>
            {visible.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `chip ${isActive ? "active" : ""}`}>
                {l.label}
              </NavLink>
            ))}
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
