export interface Bank {
  id: string;
  name: string;
  short: string;
  bg: string;
  fg: string;
}

export const BANKS: Bank[] = [
  { id: "sber", name: "Сбербанк", short: "СБ", bg: "#21A038", fg: "#FFFFFF" },
  { id: "tbank", name: "Т-Банк", short: "Т", bg: "#FFDD2D", fg: "#333333" },
  { id: "alfa", name: "Альфа-Банк", short: "А", bg: "#EF3124", fg: "#FFFFFF" },
  { id: "vtb", name: "ВТБ", short: "ВТБ", bg: "#0A2896", fg: "#FFFFFF" },
  { id: "gazprombank", name: "Газпромбанк", short: "ГПБ", bg: "#002F6C", fg: "#FFFFFF" },
  { id: "ozon", name: "Озон Банк", short: "O", bg: "#005BFF", fg: "#FFFFFF" },
  { id: "yandex", name: "Яндекс Банк", short: "Я", bg: "#FC3F1D", fg: "#FFFFFF" },
  { id: "wb", name: "Вайлдберриз Банк", short: "WB", bg: "#CB11AB", fg: "#FFFFFF" },
  { id: "raiffeisen", name: "Райффайзенбанк", short: "R", bg: "#FFF200", fg: "#1A1A1A" },
  { id: "sovcombank", name: "Совкомбанк", short: "СКБ", bg: "#1C3E94", fg: "#FFFFFF" },
  { id: "pochtabank", name: "Почта Банк", short: "ПБ", bg: "#1A1F5E", fg: "#FFFFFF" },
  { id: "rshb", name: "Россельхозбанк", short: "РСХБ", bg: "#007A3D", fg: "#FFFFFF" },
  { id: "psb", name: "ПСБ", short: "ПСБ", bg: "#F26B21", fg: "#FFFFFF" },
  { id: "mts", name: "МТС Банк", short: "МТС", bg: "#E30611", fg: "#FFFFFF" },
  { id: "mkb", name: "МКБ", short: "МКБ", bg: "#C8102E", fg: "#FFFFFF" },
  { id: "rosbank", name: "Росбанк", short: "РБ", bg: "#E4002B", fg: "#FFFFFF" },
  { id: "domrf", name: "Банк ДОМ.РФ", short: "ДОМ", bg: "#1D3B8C", fg: "#FFFFFF" },
  { id: "uralsib", name: "Уралсиб", short: "УС", bg: "#3B2D83", fg: "#FFFFFF" },
  { id: "homebank", name: "Хоум Банк", short: "ХБ", bg: "#E3001B", fg: "#FFFFFF" },
  { id: "renaissance", name: "Ренессанс Банк", short: "РБ", bg: "#4B2E83", fg: "#FFFFFF" },
  { id: "akbars", name: "Ак Барс Банк", short: "АБ", bg: "#00843D", fg: "#FFFFFF" },
  { id: "otp", name: "ОТП Банк", short: "OTP", bg: "#52AE30", fg: "#FFFFFF" },
  { id: "spb", name: "Банк «Санкт-Петербург»", short: "БСП", bg: "#D71920", fg: "#FFFFFF" },
  { id: "unicredit", name: "ЮниКредит Банк", short: "UC", bg: "#E2001A", fg: "#FFFFFF" },
  { id: "zenit", name: "Банк Зенит", short: "З", bg: "#00A0AF", fg: "#FFFFFF" },
  { id: "rnkb", name: "РНКБ", short: "РНКБ", bg: "#E0232E", fg: "#FFFFFF" },
  { id: "avangard", name: "Банк Авангард", short: "АВ", bg: "#006241", fg: "#FFFFFF" },
  { id: "tochka", name: "Точка", short: "•", bg: "#7B4BFF", fg: "#FFFFFF" },
  { id: "modulbank", name: "Модульбанк", short: "М", bg: "#2E2E2E", fg: "#FFFFFF" },
  { id: "other", name: "Другой банк", short: "₽", bg: "#8E8E93", fg: "#FFFFFF" },
];

export const bankIds = BANKS.map((b) => b.id);
