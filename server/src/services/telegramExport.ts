import yauzl, { type Entry, type ZipFile } from "yauzl";
import { badRequest } from "../lib/errors.js";

const MAX_ENTRIES = 20000;
const MAX_JSON = 30 * 1024 * 1024;
const MAX_PHOTO = 20 * 1024 * 1024;

export interface ExportMessage {
  id: number;
  text: string;
  photo: string;
  stamp: string;
}

export function exportPlainText(text: unknown) {
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return text
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

export function groupExportMessages(messages: ExportMessage[]) {
  const groups: ExportMessage[][] = [];
  let current: ExportMessage[] | null = null;
  let stamp = "";
  for (const message of messages) {
    if (current && stamp === message.stamp && (!message.text || message.photo)) {
      current.push(message);
      continue;
    }
    current = [message];
    stamp = message.stamp;
    groups.push(current);
  }
  return groups;
}

function safeName(name: string) {
  const norm = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.split("/").includes("..")) return "";
  return norm;
}

function openZip(path: string) {
  return new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error("Архив не открывается"));
      else resolve(zip);
    });
  });
}

function indexZip(zip: ZipFile) {
  const entries = new Map<string, Entry>();
  return new Promise<Map<string, Entry>>((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(entries);
    };
    zip.on("error", fail);
    zip.on("entry", (entry: Entry) => {
      if (settled) return;
      const name = safeName(entry.fileName);
      if (name && !name.endsWith("/")) {
        if (entries.size >= MAX_ENTRIES) {
          fail(badRequest("В архиве слишком много файлов"));
          return;
        }
        entries.set(name, entry);
      }
      zip.readEntry();
    });
    zip.on("end", done);
    zip.readEntry();
  });
}

function readEntry(zip: ZipFile, entry: Entry, max: number) {
  return new Promise<Buffer>((resolve, reject) => {
    if (entry.uncompressedSize > max) {
      reject(badRequest("Файл в архиве слишком большой"));
      return;
    }
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("Не удалось прочитать файл из архива"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(e);
      };
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) {
          fail(badRequest("Файл в архиве слишком большой"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      stream.on("error", fail);
    });
  });
}

function findEntry(entries: Map<string, Entry>, rel: string) {
  const name = safeName(rel);
  if (!name) return undefined;
  const direct = entries.get(name);
  if (direct) return direct;
  const tail = `/${name}`;
  for (const [key, entry] of entries) {
    if (key.endsWith(tail)) return entry;
  }
  return undefined;
}

export async function openTelegramExport(path: string) {
  const zip = await openZip(path).catch(() => {
    throw badRequest("Архив повреждён или это не zip");
  });
  let entries: Map<string, Entry>;
  try {
    entries = await indexZip(zip);
  } catch (e) {
    zip.close();
    throw e instanceof Error && "status" in e ? e : badRequest("Архив не читается");
  }
  const jsonName = [...entries.keys()].find((name) => name === "result.json" || name.endsWith("/result.json"));
  const jsonFile = jsonName ? entries.get(jsonName) : undefined;
  if (!jsonFile) {
    zip.close();
    throw badRequest("В архиве нет result.json. Сожмите папку выгрузки целиком, не только фото");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readEntry(zip, jsonFile, MAX_JSON)).toString("utf8"));
  } catch (e) {
    zip.close();
    throw e instanceof Error && "status" in e ? e : badRequest("result.json не читается");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { messages?: unknown }).messages)) {
    zip.close();
    throw badRequest("Это не выгрузка истории Telegram");
  }
  const rawId = (parsed as { id?: unknown }).id;
  const channelId = typeof rawId === "number" && Number.isSafeInteger(rawId) ? `-100${Math.abs(rawId)}` : "";
  const messages: ExportMessage[] = [];
  for (const item of (parsed as { messages: unknown[] }).messages) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; type?: unknown; text?: unknown; photo?: unknown; date_unixtime?: unknown };
    if (row.type !== "message" || typeof row.id !== "number") continue;
    const text = exportPlainText(row.text).trim();
    const photo = typeof row.photo === "string" ? row.photo : "";
    if (!text && !photo) continue;
    messages.push({
      id: row.id,
      text,
      photo,
      stamp: typeof row.date_unixtime === "string" || typeof row.date_unixtime === "number" ? String(row.date_unixtime) : String(row.id),
    });
    if (messages.length >= 4000) break;
  }
  if (!messages.length) {
    zip.close();
    throw badRequest("В выгрузке нет постов");
  }
  return {
    channelId,
    groups: groupExportMessages(messages),
    async photo(rel: string) {
      if (!/\.(jpe?g|png|webp)$/i.test(rel)) return null;
      const entry = findEntry(entries, rel);
      if (!entry) return null;
      try {
        return await readEntry(zip, entry, MAX_PHOTO);
      } catch {
        return null;
      }
    },
    close() {
      zip.close();
    },
  };
}
