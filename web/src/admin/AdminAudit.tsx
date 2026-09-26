import { useState } from "react";
import { ErrorState, PageLoader, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { useLive } from "../lib/live";

interface Log {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; email: string | null; telegramUsername: string | null; firstName: string | null } | null;
}

const ACTIONS: Record<string, string> = {
  "payment.approve": "Подтвердил оплату",
  "payment.reject": "Отклонил чек",
  "order.status": "Сменил статус заказа",
  "order.update": "Изменил заказ",
  "product.create": "Создал товар",
  "product.update": "Изменил товар",
  "product.delete": "Удалил товар",
  "product.variants": "Изменил размеры/остатки",
  "product.image.add": "Добавил фото",
  "product.image.delete": "Удалил фото",
  "category.create": "Создал категорию",
  "category.update": "Изменил категорию",
  "category.delete": "Удалил категорию",
  "settings.payment": "Изменил реквизиты оплаты",
  "settings.store": "Изменил настройки магазина",
  "user.update": "Изменил пользователя",
};

export default function AdminAudit() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload, refresh } = useAsync(() => api.get<{ logs: Log[]; pageSize: number }>(`/admin/audit?page=${page}`), [page]);
  useLive(["orders", "catalog", "config", "users"], () => void refresh());
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState message={error} retry={reload} />;

  return (
    <div className="container narrow">
      <h1 className="large-title">Журнал действий</h1>
      <div className="section">
        <div className="list">
          {data?.logs.map((l) => {
            const meta = (l.meta ?? {}) as Record<string, unknown>;
            const who = l.actor ? l.actor.firstName || (l.actor.telegramUsername ? `@${l.actor.telegramUsername}` : l.actor.email) : "система";
            return (
              <div key={l.id} className="cell">
                <div className="cell-main">
                  <div className="subhead">
                    <b>{who}</b> — {ACTIONS[l.action] ?? l.action}
                    {typeof meta.number === "number" && ` №${meta.number}`}
                    {typeof meta.title === "string" && ` «${meta.title}»`}
                  </div>
                  <div className="caption">
                    {dateTime(l.createdAt)}
                    {typeof meta.via === "string" && ` · через ${meta.via === "telegram" ? "Telegram" : "админку"}`}
                    {l.ip && ` · ${l.ip}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="row-flex mt-16" style={{ justifyContent: "center" }}>
        <button className="btn small gray" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Новее
        </button>
        <button className="btn small gray" disabled={(data?.logs.length ?? 0) < (data?.pageSize ?? 50)} onClick={() => setPage(page + 1)}>
          Старее
        </button>
      </div>
    </div>
  );
}
