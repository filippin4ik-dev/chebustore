import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePost } from "../src/lib/postParser.ts";

test("channel post: example from the shop", () => {
  const p = parsePost(`Джинсы diesel distressed 
•Цена 3490
•Размер XS-S
\uFEFF•Состояние 9/10
В отличном состоянии, без дефектов, классные дистрессд джинсы
 
Оформить👉@chebust`);
  assert.ok(p);
  assert.equal(p.title, "Джинсы diesel distressed");
  assert.equal(p.price, 3490);
  assert.deepEqual(p.sizes, ["XS-S"]);
  assert.equal(p.description, "Состояние: 9/10\n\nВ отличном состоянии, без дефектов, классные дистрессд джинсы");
  assert.equal(p.sold, false);
});

test("channel post: variations", () => {
  const p = parsePost(`🔥 Худи Stone Island
Цена: 12 990 ₽
Размеры: S, M, L
Бренд: Stone Island
Замеры: ПОГ 60, длина 70
#худи #stoneisland
Пишите в лс`);
  assert.ok(p);
  assert.equal(p.title, "Худи Stone Island");
  assert.equal(p.price, 12990);
  assert.deepEqual(p.sizes, ["S", "M", "L"]);
  assert.match(p.description, /Бренд: Stone Island/);
  assert.doesNotMatch(p.description, /лс/);
  assert.deepEqual(p.tags, ["худи", "stoneisland"]);
});

test("channel post: sold, no size, bare price", () => {
  const p = parsePost("Кепка Carhartt\n1990₽\nПРОДАНО");
  assert.ok(p);
  assert.equal(p.price, 1990);
  assert.deepEqual(p.sizes, ["ONE SIZE"]);
  assert.equal(p.sold, true);
});

test("channel post: announcements without price are ignored", () => {
  assert.equal(parsePost("Всем привет! Завтра новый дроп в 19:00"), null);
  assert.equal(parsePost(""), null);
});
