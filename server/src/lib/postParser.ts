export interface ParsedPost {
  title: string;
  price: number;
  sizes: string[];
  description: string;
  sold: boolean;
  tags: string[];
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const LEAD = /^[^\p{L}\p{N}]+/u;
const SOLD = /(^|[^\p{L}])(продано|продан|продана|sold|нет в наличии|забронировано|забронирован|бронь)(?![\p{L}])/iu;
const CONTACT = /(^|\s)@[A-Za-z0-9_]{4,}|t\.me\/|https?:\/\//i;
const CALL_TO_ACTION = /^(оформ|заказ|купить|покупка|пиши|писать|напиши|по вопросам|для заказа|бронь через|в лс|в личку)/i;

const PRICE = /^(цена|стоимость|price|прайс)\s*[:\-–—=]?\s*(.+)$/i;
const SIZE = /^(размеры|размер|разм\.?|р-р|size|sizes)\s*[:\-–—=]?\s*(.+)$/i;
const CONDITION = /^(состояние|condition|кондиция)\s*[:\-–—=]?\s*(.+)$/i;
const FACT =
  /^(бренд|brand|замеры|замер|материал|состав|цвет|страна|модель|длина|ширина|пот|пог|талия|бедра|рост|посадка|плечи|рукав|сезон|стиль)\s*[:\-–—=]?\s*(.+)$/i;

function parsePrice(value: string) {
  const groups = value.match(/\d[\d\s.,]*/g);
  if (!groups?.length) return 0;
  const last = groups[groups.length - 1]!.replace(/[.,]\d{1,2}$/, "").replace(/\D/g, "");
  const n = Number(last);
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : 0;
}

function parseSizes(value: string) {
  return value
    .split(/[,;]|\s+и\s+/)
    .map((s) => s.replace(LEAD, "").trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 24))
    .slice(0, 20);
}

export function parsePost(input: string): ParsedPost | null {
  const text = input.replace(INVISIBLE, "");
  const sold = SOLD.test(text);
  let title = "";
  let price = 0;
  let sizes: string[] = [];
  const facts: string[] = [];
  const body: string[] = [];
  const tags: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (body.length && body[body.length - 1] !== "") body.push("");
      continue;
    }
    const line = trimmed.replace(LEAD, "").trim();
    const hashtags = trimmed.match(/#[\p{L}\p{N}_]+/gu);
    if (hashtags && trimmed.replace(/#[\p{L}\p{N}_]+/gu, "").trim() === "") {
      tags.push(...hashtags.map((t) => t.slice(1).toLowerCase()));
      continue;
    }
    if (!line) continue;
    if (CONTACT.test(trimmed) || CALL_TO_ACTION.test(line)) continue;

    let m;
    if ((m = line.match(PRICE))) {
      price = parsePrice(m[2]!) || price;
      continue;
    }
    if ((m = line.match(SIZE))) {
      sizes = parseSizes(m[2]!);
      continue;
    }
    if ((m = line.match(CONDITION))) {
      facts.push(`Состояние: ${m[2]!.trim()}`);
      continue;
    }
    if ((m = line.match(FACT))) {
      facts.push(line);
      continue;
    }
    if (!title) {
      title = line.slice(0, 120);
      continue;
    }
    if (!price && /^\d[\d\s.,]*\s*(₽|руб\.?|р\.?|rub)$/i.test(line)) {
      price = parsePrice(line);
      continue;
    }
    body.push(line);
  }

  if (!title || !price) return null;
  while (body.length && body[body.length - 1] === "") body.pop();
  while (body.length && body[0] === "") body.shift();
  const description = [...facts, ...(facts.length && body.length ? [""] : []), ...body].join("\n").slice(0, 5000);
  return { title, price, sizes: sizes.length ? sizes : ["ONE SIZE"], description, sold, tags };
}
