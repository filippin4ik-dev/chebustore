import assert from "node:assert/strict";
import { test } from "node:test";
import { detectCategory } from "../src/services/categories.ts";

test("category: jeans title beats a hoodie mention in the description", () => {
  const hit = detectCategory("Джинсы diesel distressed\nХуди не носили, состояние 9/10");
  assert.equal(hit?.slug, "jeans");
});

test("category: clothing words", () => {
  assert.equal(detectCategory("Худи zip black").slug, "hoodies");
  assert.equal(detectCategory("Бомбер кожаный").slug, "outerwear");
  assert.equal(detectCategory("New balance"), null);
  assert.equal(detectCategory("Кроссовки New Balance").slug, "shoes");
  assert.equal(detectCategory("Без названия\nвнутри футболка").slug, "tshirts");
});
