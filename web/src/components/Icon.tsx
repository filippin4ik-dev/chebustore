const paths: Record<string, string> = {
  bag: "M6 8h12l-1 12H7L6 8Zm3 0V6.5a3 3 0 0 1 6 0V8",
  grid: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8.5c.8-3.4 3.6-5.5 7-5.5s6.2 2.1 7 5.5",
  chevronRight: "m9.5 5.5 6.5 6.5-6.5 6.5",
  chevronLeft: "M15 5.5 8.5 12l6.5 6.5",
  chevronUp: "m5.5 15 6.5-6.5 6.5 6.5",
  chevronDown: "m5.5 9 6.5 6.5L18.5 9",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "m5 12.5 4.5 4.5L19 7.5",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.7-1.8L20 20",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13",
  photo: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11ZM4 16l4.5-4.5 4 4L15 13l5 5M15.5 9.5h.01",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-1.6.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.4-1.4L14.2 2.5h-4.4l-.4 2.7a7 7 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.4 1.4l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6Z",
  chart: "M5 20V10M12 20V4M19 20v-7",
  tag: "M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8Zm4.5-4.5h.01",
  folder: "M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8.5c.7-3 3-4.8 6-4.8s5.3 1.8 6 4.8M16 4.5a3.5 3.5 0 0 1 0 6.5m2.5 3.9c1.4.7 2.3 2.1 2.7 3.6",
  shield: "M12 3.5 5 6v5.5c0 4.2 2.9 7.8 7 9 4.1-1.2 7-4.8 7-9V6l-7-2.5Z",
  doc: "M7 3.5h7l4 4v13H7v-17Zm7 0v4h4M9.5 12.5h6M9.5 16h6",
  upload: "M12 16V4.5M7.5 9 12 4.5 16.5 9M5 15v4.5h14V15",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  send: "M4 12 20 4l-4 16-4.5-6.5L4 12Zm7.5 1.5L20 4",
  store: "M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5c0 1.4 1.1 2.5 2.5 2.5S9 10.9 9 9.5m-5 0V20h16V9.5M9 9.5c0 1.4 1.1 2.5 2.5 2.5h1c1.4 0 2.5-1.1 2.5-2.5m0 0c0 1.4 1.1 2.5 2.5 2.5S20 10.9 20 9.5",
  logout: "M14 4.5H6.5v15H14M10 12h10m-3.5-3.5L20 12l-3.5 3.5",
  mail: "M4 6h16v12H4V6Zm0 .5 8 6 8-6",
  telegram: "M20.5 4.5 3.5 11l5.5 2m11.5-8.5L17 19l-8-6m11.5-8.5L9 13v5l3-3",
  box: "M4 8 12 4l8 4v8l-8 4-8-4V8Zm0 0 8 4m0 0 8-4m-8 4v8",
  truck: "M3.5 6.5h10v9h-10zM13.5 10h4l3 3v2.5h-7M7 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  clock: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4.5l3 2",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, stroke = 1.7 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
