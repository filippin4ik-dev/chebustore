import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { requireUser } from "../plugins/auth.js";
import { imageUrl } from "../services/catalog.js";

export const MAX_QTY = 10;
const MAX_LINES = 30;

export async function loadCart(userId: string) {
  const items = await prisma.cartItem.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } } },
      },
    },
  });
  const lines = items.map((i) => {
    const v = i.variant;
    const p = v.product;
    const price = v.price ?? p.basePrice;
    const purchasable = p.isActive && v.isActive && v.stock > 0;
    return {
      id: i.id,
      variantId: v.id,
      productSlug: p.slug,
      productTitle: p.title,
      size: v.size,
      color: v.color,
      image: p.images[0] ? imageUrl(p.images[0].fileName) : null,
      unitPrice: price,
      quantity: i.quantity,
      maxQuantity: Math.min(MAX_QTY, Math.max(v.stock, 0)),
      purchasable,
      issue: !purchasable ? "Нет в наличии" : i.quantity > v.stock ? `Доступно только ${v.stock} шт.` : null,
    };
  });
  const total = lines.filter((l) => l.purchasable).reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  return { items: lines, itemsTotal: total, count: lines.reduce((s, l) => s + l.quantity, 0) };
}

export default async function cartRoutes(app: FastifyInstance) {
  app.get("/api/cart", async (req) => {
    const user = requireUser(req);
    return loadCart(user.id);
  });

  app.put("/api/cart/items", async (req) => {
    const user = requireUser(req);
    const body = parse(
      z.object({ variantId: z.string().min(1).max(40), quantity: z.number().int().min(0).max(MAX_QTY) }),
      req.body,
    );
    if (body.quantity === 0) {
      await prisma.cartItem.deleteMany({ where: { userId: user.id, variantId: body.variantId } });
      return loadCart(user.id);
    }
    const variant = await prisma.productVariant.findUnique({
      where: { id: body.variantId },
      include: { product: { select: { isActive: true } } },
    });
    if (!variant || !variant.isActive || !variant.product.isActive) throw badRequest("Товар недоступен");
    if (variant.stock < body.quantity) {
      throw badRequest(variant.stock > 0 ? `В наличии только ${variant.stock} шт.` : "Размер закончился");
    }
    const lines = await prisma.cartItem.count({ where: { userId: user.id } });
    const exists = await prisma.cartItem.findUnique({
      where: { userId_variantId: { userId: user.id, variantId: body.variantId } },
    });
    if (!exists && lines >= MAX_LINES) throw badRequest("В корзине слишком много позиций");
    await prisma.cartItem.upsert({
      where: { userId_variantId: { userId: user.id, variantId: body.variantId } },
      create: { userId: user.id, variantId: body.variantId, quantity: body.quantity },
      update: { quantity: body.quantity },
    });
    return loadCart(user.id);
  });

  app.delete("/api/cart", async (req) => {
    const user = requireUser(req);
    await prisma.cartItem.deleteMany({ where: { userId: user.id } });
    return loadCart(user.id);
  });
}
