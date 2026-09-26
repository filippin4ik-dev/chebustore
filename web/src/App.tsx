import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { StoreLayout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import CartPage from "./pages/CartPage";
import Catalog from "./pages/Catalog";
import Checkout from "./pages/Checkout";
import Login from "./pages/Login";
import OrderDetail from "./pages/OrderDetail";
import Orders from "./pages/Orders";
import ProductPage from "./pages/ProductPage";
import Profile from "./pages/Profile";

const AdminLayout = lazy(() => import("./admin/AdminLayout"));
const Dashboard = lazy(() => import("./admin/Dashboard"));
const AdminOrders = lazy(() => import("./admin/AdminOrders"));
const AdminOrderDetail = lazy(() => import("./admin/AdminOrderDetail"));
const AdminProducts = lazy(() => import("./admin/AdminProducts"));
const AdminProductEdit = lazy(() => import("./admin/AdminProductEdit"));
const AdminCategories = lazy(() => import("./admin/AdminCategories"));
const AdminSettings = lazy(() => import("./admin/AdminSettings"));
const AdminUsers = lazy(() => import("./admin/AdminUsers"));
const AdminAudit = lazy(() => import("./admin/AdminAudit"));

function Shell() {
  const { ready } = useAuth();
  if (!ready) return <PageLoader />;
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<StoreLayout />}>
          <Route index element={<Catalog />} />
          <Route path="p/:slug" element={<ProductPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:number" element={<OrderDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="login" element={<Login />} />
        </Route>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="orders/:number" element={<AdminOrderDetail />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="products/:id" element={<AdminProductEdit />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
