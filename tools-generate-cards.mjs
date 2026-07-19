import { mkdir, readFile, writeFile } from "node:fs/promises";

const traditionalDir = new URL("./assets/decks/traditional/", import.meta.url);
const juDir = new URL("./assets/decks/ju/", import.meta.url);
const traditionalIosDir = new URL("./assets/decks/traditional-ios/", import.meta.url);
const juIosDir = new URL("./assets/decks/ju-ios/", import.meta.url);
const suits = {
  S: { symbol: "♠", color: "#0a0a0a" },
  H: { symbol: "♥", color: "#e11313" },
  D: { symbol: "♦", color: "#e11313" },
  C: { symbol: "♣", color: "#0a0a0a" }
};
const ranks = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const juPhoto = await readFile(new URL("./assets/decks/ju/j1.jpg", import.meta.url));
const juPhotoDataUri = `data:image/jpeg;base64,${juPhoto.toString("base64")}`;

function pipPositions(rank) {
  const c = 120;
  const l = 82;
  const r = 158;
  const rows = { a: 42, b: 100, c: 154, d: 190, e: 236, f: 294 };
  const map = {
    1: [[c, 170, 2.05]],
    2: [[c, rows.a, 1], [c, rows.f, -1]],
    3: [[c, rows.a, 1], [c, 170, 1], [c, rows.f, -1]],
    4: [[l, rows.a, 1], [r, rows.a, 1], [l, rows.f, -1], [r, rows.f, -1]],
    5: [[l, rows.a, 1], [r, rows.a, 1], [c, 170, 1], [l, rows.f, -1], [r, rows.f, -1]],
    6: [[l, rows.a, 1], [r, rows.a, 1], [l, 170, 1], [r, 170, 1], [l, rows.f, -1], [r, rows.f, -1]],
    7: [[l, rows.a, 1], [r, rows.a, 1], [c, rows.b, 1], [l, 170, 1], [r, 170, 1], [l, rows.f, -1], [r, rows.f, -1]],
    8: [[l, rows.a, 1], [r, rows.a, 1], [c, rows.b, 1], [l, 170, 1], [r, 170, 1], [c, rows.e, -1], [l, rows.f, -1], [r, rows.f, -1]],
    9: [[l, rows.a, 1], [r, rows.a, 1], [l, rows.b, 1], [r, rows.b, 1], [c, 170, 1], [l, rows.e, -1], [r, rows.e, -1], [l, rows.f, -1], [r, rows.f, -1]],
    10: [[l, rows.a, 1], [r, rows.a, 1], [c, 104, 1], [l, rows.b, 1], [r, rows.b, 1], [l, rows.e, -1], [r, rows.e, -1], [c, 238, -1], [l, rows.f, -1], [r, rows.f, -1]]
  };
  return map[rank] || [];
}

function suitStroke(width, color) {
  return width > 0 ? ` stroke="${color}" stroke-width="${width}" stroke-linejoin="round" paint-order="stroke fill"` : "";
}

function corner(rank, suit, rotate = false, strokeWidth = 0) {
  const transform = rotate ? "translate(240 336) rotate(180)" : "";
  const rankLabel = ranks[rank];
  return `<g transform="${transform}">
    <text x="10" y="43" font-family="Arial, Helvetica, sans-serif" font-size="${rankLabel === "10" ? 38 : 43}" font-weight="900" fill="${suit.color}">${rankLabel}</text>
    <text x="28" y="72" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" fill="${suit.color}"${suitStroke(strokeWidth, suit.color)}>${suit.symbol}</text>
  </g>`;
}

function face(rank, suit, strokeWidth = 0) {
  const title = rank === 11 ? "J" : rank === 12 ? "Q" : "K";
  return `<g transform="translate(120 170)">
    <text x="0" y="-128" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="900" fill="${suit.color}"${suitStroke(strokeWidth, suit.color)}>${suit.symbol}</text>
    <text x="0" y="14" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="900" fill="${suit.color}">${title}</text>
    <text x="0" y="84" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="900" fill="${suit.color}"${suitStroke(strokeWidth, suit.color)}>${suit.symbol}</text>
  </g>`;
}

function cardBackground(deck) {
  if (deck !== "ju") {
    return '<rect x="8" y="8" width="224" height="320" rx="9" fill="#fff"/>';
  }

  return `<defs>
    <clipPath id="cardClip"><rect x="8" y="8" width="224" height="320" rx="9"/></clipPath>
  </defs>
  <rect x="8" y="8" width="224" height="320" rx="9" fill="#fff"/>
  <image href="${juPhotoDataUri}" x="8" y="8" width="224" height="320" preserveAspectRatio="xMidYMid slice" clip-path="url(#cardClip)" opacity="0.42"/>
  <rect x="8" y="8" width="224" height="320" rx="9" fill="#fff" opacity="0.28"/>`;
}

function cardSvg(rank, suitCode, deck = "traditional", strokeWidth = 0) {
  const suit = suits[suitCode];
  const pips = rank <= 10
    ? pipPositions(rank).map(([x, y, dir]) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${rank === 1 ? 106 : 52}" font-weight="900" fill="${suit.color}"${suitStroke(strokeWidth, suit.color)} transform="rotate(${dir < 0 ? 180 : 0} ${x} ${y})">${suit.symbol}</text>`).join("\n")
    : face(rank, suit, strokeWidth);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336" role="img" aria-label="${ranks[rank]} ${suit.symbol}">
  <rect x="3" y="3" width="234" height="330" rx="13" fill="#fff" stroke="#080808" stroke-width="6"/>
  ${cardBackground(deck)}
  ${corner(rank, suit, false, strokeWidth)}
  ${corner(rank, suit, true, strokeWidth)}
  ${pips}
</svg>
`;
}

function backSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336" role="img" aria-label="Verso da carta">
  <rect x="3" y="3" width="234" height="330" rx="13" fill="#fbfbfb" stroke="#080808" stroke-width="6"/>
  <rect x="18" y="18" width="204" height="300" rx="8" fill="#134d9d"/>
  <path d="M34 34h172v268H34z" fill="none" stroke="#f7f7f7" stroke-width="8"/>
  <g fill="#f7f7f7" opacity="0.9">
    <circle cx="72" cy="84" r="18"/><circle cx="120" cy="84" r="18"/><circle cx="168" cy="84" r="18"/>
    <circle cx="72" cy="140" r="18"/><circle cx="120" cy="140" r="18"/><circle cx="168" cy="140" r="18"/>
    <circle cx="72" cy="196" r="18"/><circle cx="120" cy="196" r="18"/><circle cx="168" cy="196" r="18"/>
    <circle cx="72" cy="252" r="18"/><circle cx="120" cy="252" r="18"/><circle cx="168" cy="252" r="18"/>
  </g>
</svg>
`;
}

async function writeDeck(outDir, name, deck, strokeWidth = 0) {
  await mkdir(outDir, { recursive: true });
  for (const suit of Object.keys(suits)) {
    for (let rank = 1; rank <= 13; rank += 1) {
      await writeFile(new URL(`${rank}${suit}.svg`, outDir), cardSvg(rank, suit, deck, strokeWidth));
    }
  }
  await writeFile(new URL("back.svg", outDir), backSvg());
  await writeFile(new URL("deck.json", outDir), JSON.stringify({ name, cards: 52, format: "{rank}{suit}.svg" }, null, 2) + "\n");
}

await writeDeck(traditionalDir, "Tradicional", "traditional");
await writeDeck(juDir, "Ju", "ju");
await writeDeck(traditionalIosDir, "Tradicional iOS", "traditional", 1.35);
await writeDeck(juIosDir, "Ju iOS", "ju", 1.35);
