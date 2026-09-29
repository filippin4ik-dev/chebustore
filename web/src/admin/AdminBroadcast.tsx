import { useEffect, useState } from "react";
import { ErrorState, PageLoader, Spinner } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/toast";
import type { AdminCategory } from "../lib/types";

type Segment = "all" | "buyers" | "never" | "quiet" | "category";
type ButtonKind = "none" | "shop" | "category" | "product" | "url";

interface BroadcastRow {
  id: string;
  text: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
}

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "all", label: "Все, кто открывал бота" },
  { id: "buyers", label: "Кто уже заказывал" },
  { id: "never", label: "Кто ещё не заказывал" },
  { id: "quiet", label: "Давно не заказывали" },
  { id: "category", label: "Покупали категорию" },
];

export default function AdminBroadcast() {
  const toast = useToast();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [history, setHistory] = useState<BroadcastRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "test" | "send" | "photo" | null>(null);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [text, setText] = useState("Привет, {имя}!\n\nВ магазине новое. Загляните, пока размеры не разобрали.");
  const [segment, setSegment] = useState<Segment>("all");
  const [categoryId, setCategoryId] = useState("");
  const [quietDays, setQuietDays] = useState("30");
  const [includeStaff, setIncludeStaff] = useState(false);
  const [buttonKind, setButtonKind] = useState<ButtonKind>("shop");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonTarget, setButtonTarget] = useState("");
  const [photo, setPhoto] = useState("");

  const load = () => {
    api
      .get<{ broadcasts: BroadcastRow[] }>("/admin/broadcasts")
      .then((r) => setHistory(r.broadcasts))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    api.get<{ categories: AdminCategory[] }>("/admin/categories").then((r) => setCategories(r.categories), () => undefined);
    load();
  }, []);

  useEffect(() => {
    if (!history?.some((row) => row.status === "sending")) return;
    const timer = setTimeout(load, 2000);
    return () => clearTimeout(timer);
  }, [history]);

  const audience = {
    segment,
    categoryId,
    quietDays: Math.max(1, Number(quietDays) || 30),
    includeStaff,
  };

  const payload = () => ({
    text: text.trim(),
    photo,
    buttonKind,
    buttonLabel: buttonLabel.trim(),
    buttonTarget: buttonTarget.trim(),
    audience,
  });

  const run = async (kind: "preview" | "test" | "send") => {
    setBusy(kind);
    try {
      if (kind === "preview") {
        const r = await api.post<{ recipients: number }>("/admin/broadcasts/preview", { audience });
        setRecipients(r.recipients);
        return;
      }
      if (kind === "test") {
        await api.post("/admin/broadcasts/test", payload());
        toast("Проверка ушла вам в Telegram");
        return;
      }
      const r = await api.post<{ broadcast: BroadcastRow }>("/admin/broadcasts", payload());
      setHistory((prev) => [r.broadcast, ...(prev ?? [])]);
      toast(`Рассылка пошла: ${r.broadcast.total}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File) => {
    setBusy("photo");
    try {
      const r = await api.upload<{ fileName: string }>("/admin/broadcasts/photo", file);
      setPhoto(r.fileName);
      toast("Фото прикреплено");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Ошибка", true);
    } finally {
      setBusy(null);
    }
  };

  if (error && !history) return <ErrorState message={error} retry={load} />;
  if (!history) return <PageLoader />;

  return (
    <div className="container">
      <h1 className="large-title">Рассылка</h1>
      <div className="section">
        <div className="section-header">Кому</div>
        <div className="list">
          <div className="field">
            <label>Аудитория</label>
            <select value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
              {SEGMENTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {segment === "quiet" && (
            <div className="field">
              <label>Не заказывали дней</label>
              <input value={quietDays} inputMode="numeric" onChange={(e) => setQuietDays(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </div>
          )}
          {segment === "category" && (
            <div className="field">
              <label>Категория покупок</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Выберите</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="cell">
            <div className="cell-main">
              <div className="cell-title">Включая сотрудников</div>
              <div className="cell-sub">Иначе менеджеры и администраторы письмо не получат</div>
            </div>
            <input type="checkbox" className="switch" checked={includeStaff} onChange={(e) => setIncludeStaff(e.target.checked)} />
          </label>
        </div>
        <div className="section-footer">
          {recipients === null ? "Сначала посчитайте, сколько человек попадёт в рассылку." : `Получателей: ${recipients}. Заблокировавшие бота и нажавшие «Не присылать» не входят.`}
        </div>
      </div>
      <button className="btn block gray" onClick={() => run("preview")} disabled={busy !== null}>
        {busy === "preview" ? <Spinner /> : "Посчитать получателей"}
      </button>

      <div className="section">
        <div className="section-header">Сообщение</div>
        <div className="list">
          <div className="field">
            <label>Текст</label>
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="field">
            <label>Фото</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </div>
          {photo && (
            <button className="link-btn subhead" onClick={() => setPhoto("")}>
              Убрать фото
            </button>
          )}
          <div className="field">
            <label>Кнопка</label>
            <select value={buttonKind} onChange={(e) => setButtonKind(e.target.value as ButtonKind)}>
              <option value="shop">Открыть магазин</option>
              <option value="category">Открыть категорию</option>
              <option value="product">Открыть товар</option>
              <option value="url">Своя ссылка</option>
              <option value="none">Без кнопки</option>
            </select>
          </div>
          {buttonKind !== "none" && (
            <div className="field">
              <label>Надпись кнопки</label>
              <input value={buttonLabel} maxLength={32} placeholder="Открыть" onChange={(e) => setButtonLabel(e.target.value)} />
            </div>
          )}
          {buttonKind === "category" && (
            <div className="field">
              <label>Категория</label>
              <select value={buttonTarget} onChange={(e) => setButtonTarget(e.target.value)}>
                <option value="">Выберите</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {buttonKind === "product" && (
            <div className="field">
              <label>Ссылка или id товара</label>
              <input value={buttonTarget} placeholder="slug из адреса /p/…" onChange={(e) => setButtonTarget(e.target.value)} />
            </div>
          )}
          {buttonKind === "url" && (
            <div className="field">
              <label>Ссылка</label>
              <input value={buttonTarget} placeholder="https://" onChange={(e) => setButtonTarget(e.target.value)} />
            </div>
          )}
        </div>
        <div className="section-footer">
          {"{имя}"} подставится из Telegram, {"{ник}"} — из @username. Внизу сообщения будет «Не присылать». Команда /stop делает то же самое, /start снова включает рассылку.
        </div>
      </div>
      <button className="btn block gray" onClick={() => run("test")} disabled={busy !== null || !text.trim()}>
        {busy === "test" ? <Spinner /> : "Проверить на себе"}
      </button>
      <button className="btn block mt-8" onClick={() => run("send")} disabled={busy !== null || !text.trim()}>
        {busy === "send" ? <Spinner /> : "Отправить"}
      </button>

      {history.length > 0 && (
        <div className="section">
          <div className="section-header">Прошлые</div>
          <div className="list">
            {history.map((row) => (
              <div className="cell" key={row.id}>
                <div className="cell-main">
                  <div className="cell-title">{row.text.split("\n")[0]}</div>
                  <div className="cell-sub">
                    {row.status === "sending" ? "Идёт" : row.status === "done" ? "Готово" : "Ошибка"} · {row.sent} из {row.total}
                    {row.failed ? `, не дошло ${row.failed}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
