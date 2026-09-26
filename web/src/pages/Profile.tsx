import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmailCodeForm } from "../components/EmailCodeForm";
import { Icon } from "../components/Icon";
import { TelegramLogin, type TelegramAuthData } from "../components/TelegramLogin";
import { Empty, NavBar, Sheet, useAsync } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { isStaff, useAuth } from "../lib/auth";
import { clientLabel, dateTime, userName } from "../lib/format";
import { useToast } from "../lib/toast";
import type { SessionInfo, User } from "../lib/types";

export default function Profile() {
  const { user, setUser, logout, miniApp, config } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [tgOpen, setTgOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);

  if (!user) {
    return (
      <>
        <NavBar title="Профиль" />
        <Empty
          icon="person"
          title="Вы не вошли"
          text="Войдите через Telegram или почту, чтобы оформлять заказы и следить за ними."
          action={
            <Link className="btn medium" to="/login?next=/profile">
              Войти
            </Link>
          }
        />
      </>
    );
  }

  const linkTelegram = async (data: TelegramAuthData) => {
    try {
      const r = await api.post<{ user: User }>("/account/link/telegram", { data });
      setUser(r.user);
      setTgOpen(false);
      toast("Telegram привязан");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  const unlinkTelegram = async () => {
    if (!confirm("Отвязать Telegram? Входить можно будет только по почте.")) return;
    try {
      const r = await api.del<{ user: User }>("/account/link/telegram");
      setUser(r.user);
      toast("Telegram отвязан");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };

  return (
    <>
      <NavBar title="Профиль" />
      <div className="container narrow">
        <div className="section">
          <div className="list">
            <button className="cell" onClick={() => setEditOpen(true)}>
              {user.photoUrl ? (
                <img src={user.photoUrl} alt="" className="thumb" style={{ width: 56, height: 56, borderRadius: "50%" }} referrerPolicy="no-referrer" />
              ) : (
                <div className="thumb placeholder-img" style={{ width: 56, height: 56, borderRadius: "50%" }}>
                  <Icon name="person" size={26} />
                </div>
              )}
              <div className="cell-main">
                <div className="title-3">{userName(user)}</div>
                <div className="cell-sub">{user.phone || "Добавьте телефон"}</div>
              </div>
              <span className="cell-chevron">
                <Icon name="chevronRight" size={18} stroke={2} />
              </span>
            </button>
          </div>
        </div>

        {isStaff(user) && (
          <div className="section">
            <div className="list">
              <Link className="cell" to="/admin">
                <Icon name="shield" size={22} />
                <div className="cell-main">Админ-панель</div>
                <span className="cell-chevron">
                  <Icon name="chevronRight" size={18} stroke={2} />
                </span>
              </Link>
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-header">Способы входа</div>
          <div className="list">
            <div className="cell">
              <Icon name="telegram" size={22} />
              <div className="cell-main">
                <div>Telegram</div>
                <div className="cell-sub">{user.telegramId ? (user.telegramUsername ? `@${user.telegramUsername}` : "Привязан") : "Не привязан"}</div>
              </div>
              {!miniApp &&
                (user.telegramId ? (
                  user.email && (
                    <button className="link-btn subhead" onClick={unlinkTelegram}>
                      Отвязать
                    </button>
                  )
                ) : (
                  <button className="link-btn subhead" onClick={() => setTgOpen(true)}>
                    Привязать
                  </button>
                ))}
            </div>
            <div className="cell">
              <Icon name="mail" size={22} />
              <div className="cell-main">
                <div>Почта</div>
                <div className="cell-sub">{user.email ?? "Не привязана"}</div>
              </div>
              <button className="link-btn subhead" onClick={() => setEmailOpen(true)}>
                {user.email ? "Изменить" : "Привязать"}
              </button>
            </div>
          </div>
          <div className="section-footer">
            Привяжите оба способа — так вы не потеряете доступ к заказам. Уведомления о статусах приходят в Telegram и на почту.
          </div>
        </div>

        <div className="section">
          <div className="section-header">Безопасность</div>
          <div className="list">
            <button className="cell" onClick={() => setDevicesOpen(true)}>
              <Icon name="shield" size={22} />
              <div className="cell-main">Устройства и сеансы</div>
              <span className="cell-chevron">
                <Icon name="chevronRight" size={18} stroke={2} />
              </span>
            </button>
          </div>
        </div>

        {(config?.supportTelegram || config?.supportEmail) && (
          <div className="section">
            <div className="section-header">Поддержка</div>
            <div className="list">
              {config.supportTelegram && (
                <a className="cell" href={`https://t.me/${config.supportTelegram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">
                  <Icon name="send" size={22} />
                  <div className="cell-main">Написать в Telegram</div>
                </a>
              )}
              {config.supportEmail && (
                <a className="cell" href={`mailto:${config.supportEmail}`}>
                  <Icon name="mail" size={22} />
                  <div className="cell-main">{config.supportEmail}</div>
                </a>
              )}
            </div>
          </div>
        )}

        {!miniApp && (
          <div className="section">
            <div className="list">
              <button
                className="cell destructive"
                style={{ justifyContent: "center" }}
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
              >
                Выйти
              </button>
            </div>
          </div>
        )}
      </div>

      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />

      <Sheet open={emailOpen} onClose={() => setEmailOpen(false)} title="Почта">
        <EmailCodeForm
          mode="link"
          onDone={(u) => {
            setUser(u);
            setEmailOpen(false);
            toast("Почта привязана");
          }}
        />
      </Sheet>

      <Sheet open={tgOpen} onClose={() => setTgOpen(false)} title="Привязать Telegram">
        {config?.botUsername && <TelegramLogin botUsername={config.botUsername} onAuth={linkTelegram} />}
      </Sheet>

      <DevicesSheet open={devicesOpen} onClose={() => setDevicesOpen(false)} />
    </>
  );
}

function EditProfileSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const save = async () => {
    try {
      const r = await api.patch<{ user: User }>("/account/profile", { firstName, lastName, phone });
      setUser(r.user);
      onClose();
      toast("Сохранено");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Профиль">
      <div className="list">
        <div className="field">
          <label>Имя</label>
          <input value={firstName} maxLength={64} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
        </div>
        <div className="field">
          <label>Фамилия</label>
          <input value={lastName} maxLength={64} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
        </div>
        <div className="field">
          <label>Телефон</label>
          <input value={phone} type="tel" onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+7" />
        </div>
      </div>
      <button className="btn block mt-16" onClick={save}>
        Сохранить
      </button>
    </Sheet>
  );
}

function DevicesSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const toast = useToast();
  const { data, reload } = useAsync(
    () => (open ? api.get<{ sessions: SessionInfo[] }>("/account/sessions").then((r) => r.sessions) : Promise.resolve([])),
    [open],
  );
  const revoke = async (id: string) => {
    await api.del(`/account/sessions/${id}`);
    reload();
  };
  const revokeOthers = async () => {
    await api.post("/account/sessions/revoke-others");
    toast("Остальные сеансы завершены");
    reload();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Устройства">
      <div className="list">
        {(data ?? []).map((s) => (
          <div className="cell" key={s.id}>
            <div className="cell-main">
              <div>
                {clientLabel(s.client, s.userAgent)}
                {s.current && <span className="footnote"> · это устройство</span>}
              </div>
              <div className="cell-sub">
                Активность {dateTime(s.lastSeenAt)}
                {s.ip ? ` · ${s.ip}` : ""}
              </div>
            </div>
            {!s.current && (
              <button className="link-btn subhead" style={{ color: "var(--red)" }} onClick={() => revoke(s.id)}>
                Завершить
              </button>
            )}
          </div>
        ))}
      </div>
      {(data?.length ?? 0) > 1 && (
        <button className="btn block danger mt-16" onClick={revokeOthers}>
          Завершить все другие сеансы
        </button>
      )}
    </Sheet>
  );
}
