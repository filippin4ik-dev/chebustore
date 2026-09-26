export interface ThemeColors {
  accentLight: string;
  accentDark: string;
}

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

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export const onColor = (hex: string) => (luminance(hex) > 0.45 ? "#000000" : "#FFFFFF");

const valid = (hex: string | undefined) => (hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null);

export function applyTheme(t: Partial<ThemeColors> | null | undefined) {
  const s = document.documentElement.style;
  const light = valid(t?.accentLight) ?? "#000000";
  const dark = valid(t?.accentDark) ?? "#FFFFFF";
  s.setProperty("--accent-light", light);
  s.setProperty("--on-accent-light", onColor(light));
  s.setProperty("--accent-dark", dark);
  s.setProperty("--on-accent-dark", onColor(dark));
}
