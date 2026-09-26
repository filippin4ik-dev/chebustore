import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { exportPlainText, groupExportMessages, openTelegramExport } from "../src/services/telegramExport.ts";

test("export text keeps caption parts", () => {
  assert.equal(exportPlainText([{ type: "plain", text: "Джинсы\n" }, "Цена: 3490"]), "Джинсы\nЦена: 3490");
});

test("export groups an album and keeps the next post separate", () => {
  const groups = groupExportMessages([
    { id: 1, text: "Джинсы", photo: "photos/a.jpg", stamp: "100" },
    { id: 2, text: "", photo: "photos/b.jpg", stamp: "100" },
    { id: 3, text: "Куртка", photo: "photos/c.jpg", stamp: "200" },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]?.map((m) => m.id), [1, 2]);
  assert.deepEqual(groups[1]?.map((m) => m.id), [3]);
});

function storedZip(files: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, file.data);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + file.data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

test("export zip reads the channel, album and photo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "chebu-export-"));
  const zipPath = path.join(dir, "chat.zip");
  const photo = Buffer.from("jpeg-bytes");
  const json = Buffer.from(
    JSON.stringify({
      id: 12345,
      messages: [
        { id: 7, type: "message", date_unixtime: "100", text: [{ text: "Джинсы\nЦена: 3490" }], photo: "photos/a.jpg" },
        { id: 8, type: "message", date_unixtime: "100", text: "", photo: "photos/b.jpg" },
        { id: 9, type: "service", text: "joined" },
      ],
    }),
  );
  await writeFile(
    zipPath,
    storedZip([
      { name: "ChatExport/result.json", data: json },
      { name: "ChatExport/photos/a.jpg", data: photo },
      { name: "ChatExport/photos/b.jpg", data: Buffer.from("second") },
    ]),
  );
  const exp = await openTelegramExport(zipPath);
  try {
    assert.equal(exp.channelId, "-10012345");
    assert.equal(exp.groups.length, 1);
    assert.equal(exp.groups[0]?.[0]?.text, "Джинсы\nЦена: 3490");
    assert.equal((await exp.photo("photos/a.jpg"))?.toString(), "jpeg-bytes");
    assert.equal(await exp.photo("../secrets.txt"), null);
  } finally {
    exp.close();
    await rm(dir, { recursive: true, force: true });
  }
});
