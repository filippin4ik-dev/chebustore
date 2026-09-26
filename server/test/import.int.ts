import assert from "node:assert/strict";
import { prisma } from "../src/db.js";
import { collect, updateFromEdit } from "../src/services/channelImport.js";

const text = `Джинсы diesel distressed
•Цена 3490
•Размер XS-S
•Состояние 9/10
В отличном состоянии, без дефектов, классные дистрессд джинсы

Оформить👉@chebust`;

const chat = `-100${Date.now()}`;
const created = await collect({ sourceChat: chat, messageId: 10, text }, false);
assert.equal(created.status, "created");
if (created.status === "skipped") throw new Error();
const product = await prisma.product.findUniqueOrThrow({ where: { id: created.product.id }, include: { variants: true } });
assert.equal(product.basePrice, 349000);
assert.equal(product.isActive, false);
assert.deepEqual(product.variants.map((v) => [v.size, v.stock]), [["XS-S", 1]]);
assert.doesNotMatch(product.description, /chebust|Оформить/);

const updated = await updateFromEdit({ sourceChat: chat, messageId: 10, text: text.replace("3490", "2990") });
assert.equal(updated?.status, "updated");
assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).basePrice, 299000);

const sold = await updateFromEdit({ sourceChat: chat, messageId: 10, text: `${text}\nПРОДАНО` });
assert.equal(sold?.status, "sold");
const variants = await prisma.productVariant.findMany({ where: { productId: product.id } });
assert.deepEqual(variants.map((v) => v.stock), [0]);

assert.equal(await updateFromEdit({ sourceChat: chat, messageId: 999, text }), null);
const count = await prisma.product.count({ where: { sourceKey: `${chat}:10` } });
assert.equal(count, 1);

const album = await Promise.all([
  collect({ sourceChat: chat, messageId: 20, text: "", groupId: "g1" }, false),
  collect({ sourceChat: chat, messageId: 21, text: "Худи Nike\nЦена 5000\nРазмер M, L", groupId: "g1" }, false),
]);
assert.equal(album[0], album[1]);
assert.equal(album[0].status, "created");
if (album[0].status !== "skipped") assert.equal(album[0].product.sourceKey, `${chat}:21`);

await prisma.product.deleteMany({ where: { sourceKey: { startsWith: chat } } });
await prisma.$disconnect();
console.log("✔ channel import: create, edit price, mark sold, album grouping, no duplicates");
process.exit(0);
