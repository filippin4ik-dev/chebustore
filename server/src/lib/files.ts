import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config.js";
import { randomToken } from "./crypto.js";
import { badRequest } from "./errors.js";

const root = path.resolve(config.DATA_DIR);
export const dirs = {
  products: path.join(root, "media", "products"),
  receipts: path.join(root, "private", "receipts"),
};

export async function ensureDirs() {
  await mkdir(dirs.products, { recursive: true });
  await mkdir(dirs.receipts, { recursive: true, mode: 0o700 });
}

type Sniffed = "jpeg" | "png" | "webp" | "heic" | "pdf" | null;

export function sniff(buf: Buffer): Sniffed {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "mif1", "msf1", "heim", "heis"].includes(brand)) return "heic";
  }
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  return null;
}

const safeName = (name: string) => {
  if (!/^[A-Za-z0-9_-]+\.(webp|jpg|pdf)$/.test(name)) throw badRequest("Некорректное имя файла");
  return name;
};

/** Re-encodes an uploaded image: strips metadata/EXIF, normalises orientation, neutralises polyglot payloads. */
async function reencode(buf: Buffer, maxSide: number, quality: number) {
  const img = sharp(buf, { limitInputPixels: 60_000_000, failOn: "error" }).rotate();
  const out = await img
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return out;
}

export async function saveProductImage(buf: Buffer) {
  const kind = sniff(buf);
  if (!kind || kind === "pdf") throw badRequest("Поддерживаются JPEG, PNG, WEBP и HEIC");
  let out;
  try {
    out = await reencode(buf, 1800, 86);
  } catch {
    throw badRequest("Не удалось обработать изображение");
  }
  const fileName = `${randomToken(18)}.webp`;
  await writeFile(path.join(dirs.products, fileName), out.data, { mode: 0o644 });
  return { fileName, width: out.info.width, height: out.info.height };
}

export async function deleteProductImage(fileName: string) {
  await unlink(path.join(dirs.products, safeName(fileName))).catch(() => undefined);
}

export async function saveReceipt(buf: Buffer) {
  const kind = sniff(buf);
  if (!kind) throw badRequest("Прикрепите фото/скриншот чека (JPEG, PNG, HEIC) или PDF");
  if (kind === "pdf") {
    const fileName = `${randomToken(24)}.pdf`;
    await writeFile(path.join(dirs.receipts, fileName), buf, { mode: 0o600 });
    return { fileName, mimeType: "application/pdf", sizeBytes: buf.length };
  }
  let out;
  try {
    out = await reencode(buf, 2400, 90);
  } catch {
    throw badRequest("Не удалось обработать изображение чека");
  }
  const fileName = `${randomToken(24)}.webp`;
  await writeFile(path.join(dirs.receipts, fileName), out.data, { mode: 0o600 });
  return { fileName, mimeType: "image/webp", sizeBytes: out.data.length };
}

export async function readReceipt(fileName: string) {
  return readFile(path.join(dirs.receipts, safeName(fileName)));
}
