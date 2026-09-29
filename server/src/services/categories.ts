import { prisma } from "../db.js";
import { publish } from "../lib/live.js";

export interface CategoryHit {
  slug: string;
  name: string;
  sortOrder: number;
}

const RULES: { slug: string; name: string; sortOrder: number; re: RegExp }[] = [
  { slug: "jeans", name: "Джинсы", sortOrder: 10, re: /джинс|jeans|denim/i },
  { slug: "shorts", name: "Шорты", sortOrder: 20, re: /шорт/i },
  { slug: "skirts", name: "Юбки", sortOrder: 30, re: /юбк/i },
  { slug: "dresses", name: "Платья", sortOrder: 40, re: /плать|сарафан/i },
  { slug: "hoodies", name: "Худи", sortOrder: 50, re: /худи|hoodie|толстов|свитшот/i },
  { slug: "tshirts", name: "Футболки", sortOrder: 60, re: /футбол|лонгслив|майк|(?:^|[^\p{L}])поло(?:[^\p{L}]|$)|t-?shirt|\btee\b/iu },
  { slug: "shirts", name: "Рубашки", sortOrder: 70, re: /рубаш|(?:^|[^\p{L}])shirt(?:[^\p{L}]|$)/iu },
  { slug: "sweaters", name: "Свитеры", sortOrder: 80, re: /свитер|джемпер|кардиган|кофт|водолаз/i },
  { slug: "pants", name: "Брюки", sortOrder: 90, re: /брюк|штаны|чинос|карго|слакс|джоггер|треник/i },
  { slug: "outerwear", name: "Верхняя одежда", sortOrder: 100, re: /куртк|пальто|пуховик|бомбер|ветров|парк[аи]|плащ|пиджак|жакет|блейзер|жилет|анорак/i },
  { slug: "shoes", name: "Обувь", sortOrder: 110, re: /кроссов|кед[ыа]|ботин|туфл|лофер|сандал|обув|слипон|угги/i },
  { slug: "bags", name: "Сумки", sortOrder: 120, re: /сумк|рюкзак|бананк|клатч|шопер/i },
  { slug: "accessories", name: "Аксессуары", sortOrder: 130, re: /ремень|кепк|шапк|шарф|очк|перчат|аксессуар|носк|панам|бейсболк|кошел/i },
  { slug: "suits", name: "Костюмы", sortOrder: 140, re: /костюм/i },
];

export function detectCategory(text: string): CategoryHit | null {
  const title = text.split("\n")[0] ?? "";
  const fromTitle = RULES.find((rule) => rule.re.test(title));
  const hit = fromTitle ?? RULES.find((rule) => rule.re.test(text));
  return hit ? { slug: hit.slug, name: hit.name, sortOrder: hit.sortOrder } : null;
}

export async function ensureCategory(hit: CategoryHit) {
  const existing = await prisma.category.findUnique({ where: { slug: hit.slug } });
  if (existing) return { id: existing.id, created: false, name: existing.name };
  try {
    const created = await prisma.category.create({
      data: { slug: hit.slug, name: hit.name, sortOrder: hit.sortOrder },
    });
    return { id: created.id, created: true, name: created.name };
  } catch {
    const again = await prisma.category.findUnique({ where: { slug: hit.slug } });
    if (!again) throw new Error("Не удалось создать категорию");
    return { id: again.id, created: false, name: again.name };
  }
}

export async function scatterCategories() {
  const products = await prisma.product.findMany({
    select: { id: true, title: true, description: true, categoryId: true },
  });
  const created: string[] = [];
  let moved = 0;
  let skipped = 0;
  let unchanged = 0;
  for (const product of products) {
    const hit = detectCategory(`${product.title}\n${product.description}`);
    if (!hit) {
      skipped++;
      continue;
    }
    const category = await ensureCategory(hit);
    if (category.created) created.push(category.name);
    if (product.categoryId === category.id) {
      unchanged++;
      continue;
    }
    await prisma.product.update({ where: { id: product.id }, data: { categoryId: category.id } });
    moved++;
  }
  if (moved || created.length) publish("all", { type: "catalog" });
  return { created, moved, skipped, unchanged };
}
