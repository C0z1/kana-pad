// Stroke icons in the same style as the back/home buttons: 24×24 grid, thick round strokes, currentColor.
// Always decorative (aria-hidden): the text next to them carries the meaning.
const SHAPES = {
  today: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  practice: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  read: '<path d="M3 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H3zM21 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H21z"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H4.5a3.5 3.5 0 0 0 3.7 4.2M16 6h3.5a3.5 3.5 0 0 1-3.7 4.2M12 14v4M8 21h8M9.5 18h5"/>',
  chart: '<path d="M3 21h18M6 17v-5M11 17V7M16 17v-8M21 17V4"/>',
  settings: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.5"/><circle cx="10" cy="12" r="2.5"/><circle cx="18" cy="18" r="2.5"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pen: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19zM14 7l3.5 3.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  headphones: '<path d="M4 16v-4a8 8 0 0 1 16 0v4"/><path d="M4 15h3.5v6H4zM16.5 15H20v6h-3.5z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9 2.5h6M19 6l1.5-1.5"/>',
  heart: '<path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.8C20 15.4 12 20 12 20z"/>',
  exam: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12l2 2 4-4M9 17h6"/>',
  flame: '<path d="M12 21a6.5 6.5 0 0 1-6.5-6.5c0-4 3.5-5.5 3.5-9.5 3 1.5 4.5 3.5 4.5 6 1-.7 1.5-2 1.5-3 2 1.5 3.5 4 3.5 6.5A6.5 6.5 0 0 1 12 21z"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  stairs: '<path d="M3 20h6v-5h6v-5h6V4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  calendar: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 20h16"/>',
  undo: '<path d="M9 5L4 10l5 5M4 10h10a6 6 0 0 1 0 12h-3"/>',
  pad: '<path d="M7 8h10a5 5 0 0 1 4.8 6.3l-.6 2.2a2.5 2.5 0 0 1-4.3 1L15 15H9l-1.9 2.5a2.5 2.5 0 0 1-4.3-1l-.6-2.2A5 5 0 0 1 7 8zM8 10.5v3M6.5 12h3M16 11h.01M18 13h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  book: '<path d="M6 2.5h13v15H6.5A2.5 2.5 0 0 0 4 20V4.5a2 2 0 0 1 2-2zM4 20a2 2 0 0 0 2.5 1.5H19v-4M9 7.5h6"/>',
};

export const icon = name => SHAPES[name] ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${SHAPES[name]}</svg>` : "";
export const ICON_NAMES = Object.keys(SHAPES);
