import { syncTelegramChrome } from "./telegram";

export interface ThemeColors {
  accentLight: string;
  accentDark: string;
  bgLight: string;
  bgDark: string;
}

export const DEFAULT_BG_LIGHT = "#F2F2F7";
export const DEFAULT_BG_DARK = "#000000";

export const THEME_PRESETS: { name: string; light: string; dark: string }[] = [
  { name: "Классика", light: "#000000", dark: "#FFFFFF" },
  { name: "Синий", light: "#007AFF", dark: "#0A84FF" },
  { name: "Индиго", light: "#5856D6", dark: "#7D7AFF" },
  { name: "Зелёный", light: "#248A3D", dark: "#30D158" },
  { name: "Бирюза", light: "#0A7E8C", dark: "#40C8E0" },
  { name: "Оранжевый", light: "#E0600B", dark: "#FF9F0A" },
  { name: "Красный", light: "#D70015", dark: "#FF453A" },
  { name: "Розовый", light: "#D30F57", dark: "#FF375F" },
  { name: "Графит", light: "#3A3A3C", dark: "#D1D1D6" },
];

export const BG_PRESETS: { name: string; light: string; dark: string }[] = [
  { name: "Системный", light: DEFAULT_BG_LIGHT, dark: DEFAULT_BG_DARK },
  { name: "Белый", light: "#FFFFFF", dark: "#000000" },
  { name: "Молочный", light: "#F5EFE6", dark: "#14110D" },
  { name: "Мятный", light: "#EEF3EA", dark: "#0D1410" },
  { name: "Небо", light: "#EAF1F8", dark: "#0B1220" },
  { name: "Пудра", light: "#F7ECEF", dark: "#160D12" },
  { name: "Лаванда", light: "#EFEDF6", dark: "#121016" },
  { name: "Серый", light: "#E5E5EA", dark: "#101418" },
];

export const BG_LIGHT_MIN = 0.6;
export const BG_DARK_MAX = 0.05;

export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export const onColor = (hex: string) => (luminance(hex) > 0.45 ? "#000000" : "#FFFFFF");

const valid = (hex: string | undefined) => (hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null);

function barColor(hex: string, dark: boolean) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    dark ? Math.min(255, c + 22) : Math.round(c + (255 - c) * 0.4),
  );
  return `rgba(${ch.join(", ")}, 0.82)`;
}

function setMetaThemeColor(light: string, dark: string) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = m.media.includes("dark") ? dark : light;
  });
}

export function applyTheme(t: Partial<ThemeColors> | null | undefined) {
  const s = document.documentElement.style;
  const light = valid(t?.accentLight) ?? "#000000";
  const dark = valid(t?.accentDark) ?? "#FFFFFF";
  const bgLight = valid(t?.bgLight) && luminance(t!.bgLight!) >= BG_LIGHT_MIN ? t!.bgLight! : DEFAULT_BG_LIGHT;
  const bgDark = valid(t?.bgDark) && luminance(t!.bgDark!) <= BG_DARK_MAX ? t!.bgDark! : DEFAULT_BG_DARK;
  s.setProperty("--accent-light", light);
  s.setProperty("--on-accent-light", onColor(light));
  s.setProperty("--accent-dark", dark);
  s.setProperty("--on-accent-dark", onColor(dark));
  s.setProperty("--bg-light", bgLight);
  s.setProperty("--bg-dark", bgDark);
  s.setProperty("--bar-light", barColor(bgLight, false));
  s.setProperty("--bar-dark", barColor(bgDark, true));
  setMetaThemeColor(bgLight, bgDark);
  syncTelegramChrome();
}
