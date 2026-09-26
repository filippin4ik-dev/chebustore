import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { slug: "tshirts", name: "Футболки", sortOrder: 1 },
  { slug: "hoodies", name: "Худи", sortOrder: 2 },
  { slug: "pants", name: "Брюки", sortOrder: 3 },
  { slug: "outerwear", name: "Верхняя одежда", sortOrder: 4 },
  { slug: "accessories", name: "Аксессуары", sortOrder: 5 },
];

async function main() {
  for (const c of categories) {
    await prisma.category.upsert({ where: { slug: c.slug }, create: c, update: {} });
  }
  await prisma.setting.upsert({
    where: { key: "store" },
    create: {
      key: "store",
      value: {
        storeName: "ЧЕБУ STORE",
        supportTelegram: "",
        supportEmail: "",
        pickupAddress: "",
        deliveryPrices: { PICKUP: 0, COURIER: 50000, POST: 40000 },
        deliveryEnabled: { PICKUP: true, COURIER: true, POST: true },
      },
    },
    update: {},
  });
  console.log("Seed: категории и настройки магазина созданы.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
