import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setBearer, setUnauthorizedHandler } from "./api";
import { isMiniApp, tg } from "./telegram";
import type { Cart, PublicConfig, User } from "./types";

interface AuthState {
  ready: boolean;
  user: User | null;
  config: PublicConfig | null;
  miniApp: boolean;
  authError: string | null;
  setUser(u: User | null): void;
  logout(): Promise<void>;
  cart: Cart | null;
  refreshCart(): Promise<void>;
  setCart(c: Cart): void;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

async function miniAppLogin(): Promise<User | null> {
  const initData = tg()?.initData;
  if (!initData) return null;
  const res = await api.post<{ user: User; token: string }>("/auth/telegram/webapp", { initData });
  setBearer(res.token);
  return res.user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const miniApp = isMiniApp();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = api.get<PublicConfig>("/config").catch(() => null);
      try {
        if (miniApp) {
          setUnauthorizedHandler(async () => {
            try {
              return Boolean(await miniAppLogin());
            } catch {
              return false;
            }
          });
          const u = await miniAppLogin();
          if (!cancelled) setUser(u);
        } else {
          const me = await api.get<{ user: User | null }>("/auth/me");
          if (!cancelled) setUser(me.user);
        }
      } catch (e) {
        if (!cancelled) setAuthError((e as Error).message);
      }
      const c = await cfg;
      if (!cancelled) {
        setConfig(c);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [miniApp]);

  const refreshCart = useCallback(async () => {
    if (!user) {
      setCart(null);
      return;
    }
    setCart(await api.get<Cart>("/cart"));
  }, [user]);

  useEffect(() => {
    refreshCart().catch(() => undefined);
  }, [refreshCart]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setBearer(null);
    setUser(null);
    setCart(null);
  }, []);

  return (
    <Ctx.Provider value={{ ready, user, config, miniApp, authError, setUser, logout, cart, refreshCart, setCart }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
export const isStaff = (u: User | null) => u?.role === "ADMIN" || u?.role === "MANAGER";
