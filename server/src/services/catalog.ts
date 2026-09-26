import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const productInclude = {
  images: { orderBy: { sortOrder: "asc" } },
  variants: { orderBy: [{ sortOrder: "asc" }, { size: "asc" }] },
  category: true,
} satisfies Prisma.ProductInclude;

type FullProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export const imageUrl = (fileName: string) => `/media/products/${fileName}`;

export function serializeProduct(p: FullProduct) {
  const variants = p.variants.filter((v) => v.isActive);
  const prices = variants.map((v) => v.price ?? p.basePrice);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    category: p.category ? { id: p.category.id, slug: p.category.slug, name: p.category.name } : null,
    price: prices.length ? Math.min(...prices) : p.basePrice,
    oldPrice: p.oldPrice,
    images: p.images.map((i) => ({ id: i.id, url: imageUrl(i.fileName), width: i.width, height: i.height })),
    variants: variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      price: v.price ?? p.basePrice,
      available: v.stock > 0,
      lowStock: v.stock > 0 && v.stock <= 2,
    })),
    available: variants.some((v) => v.stock > 0),
  };
}

export function serializeProductAdmin(p: FullProduct) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    categoryId: p.categoryId,
    basePrice: p.basePrice,
    oldPrice: p.oldPrice,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    images: p.images.map((i) => ({ id: i.id, url: imageUrl(i.fileName), width: i.width, height: i.height })),
    variants: p.variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      sku: v.sku,
      price: v.price,
      stock: v.stock,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
    })),
  };
}

export async function uniqueSlug(base: string, excludeId?: string) {
  let slug = base || "item";
  for (let i = 2; ; i++) {
    const found = await prisma.product.findUnique({ where: { slug } });
    if (!found || found.id === excludeId) return slug;
    slug = `${base || "item"}-${i}`;
  }
}

export function slugify(input: string) {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
    л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return (
    input
      .toLowerCase()
      .split("")
      .map((c) => map[c] ?? c)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}
