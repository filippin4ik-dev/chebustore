import { NavLink, Outlet, useLocation } from "react-router-dom";
import { isStaff, useAuth } from "../lib/auth";
import { Icon } from "./Icon";

export function StoreLayout() {
  const { cart, user, config } = useAuth();
  const { pathname } = useLocation();
  const count = cart?.count ?? 0;
  const tabs = [
    { to: "/", label: "Каталог", icon: "grid" as const, end: true },
    { to: "/cart", label: "Корзина", icon: "bag" as const, badge: count },
    { to: "/orders", label: "Заказы", icon: "list" as const },
    { to: "/profile", label: "Профиль", icon: "person" as const },
  ];
  const hideTabbar = pathname === "/checkout";

  return (
    <div className={`app ${hideTabbar ? "no-tabbar" : ""}`}>
      <div className="desktop-header">
        <div className="container desktop-header-inner">
          <NavLink to="/" className="brand">
            <img className="logo" src="/logo-192.jpg" alt="" width={28} height={28} />
            {config?.storeName ?? "chebu store"}
          </NavLink>
          <nav className="desktop-nav">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}>
                {t.label}
                {t.badge ? ` · ${t.badge}` : ""}
              </NavLink>
            ))}
            {isStaff(user) && <NavLink to="/admin">Админка</NavLink>}
          </nav>
        </div>
      </div>
      <Outlet />
      {!hideTabbar && (
        <nav className="tabbar">
          <div className="tabbar-inner">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
                <Icon name={t.icon} size={26} stroke={1.6} />
                {t.label}
                {t.badge ? <span className="tab-badge">{t.badge > 99 ? "99+" : t.badge}</span> : null}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
