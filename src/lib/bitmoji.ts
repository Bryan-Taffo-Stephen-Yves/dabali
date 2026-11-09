// Bitmojis Dabali : personnages africains originaux, dessinés en SVG (aucune image externe).
// Chaque client choisit le sien (Profil) ; il apparaît à l'accueil, au scanner de l'agent et dans les moments clés.

export type Mood = "happy" | "laugh" | "yum" | "wow" | "wink" | "sad" | "sleep";
type Hair = "wrap" | "fade" | "braids" | "kufi" | "knots" | "afro" | "locs" | "bald" | "puff" | "twists";
type Pattern = "dots" | "zigzag" | "kente" | "stripes";

export type BitmojiDef = {
  id: string; name: string;
  skin: string; hair: Hair; hairColor: string;
  outfit: string; outfit2: string; pattern: Pattern;
  wrap?: string; wrap2?: string; bg: string;
  glasses?: boolean; earrings?: boolean; beard?: boolean;
};

const H = "#1b1110";
export const BITMOJIS: BitmojiDef[] = [
  { id: "aya", name: "Aya", skin: "#8d5524", hair: "wrap", hairColor: H, outfit: "#f97316", outfit2: "#fde68a", pattern: "dots", wrap: "#16a34a", wrap2: "#facc15", bg: "#fef3c7", earrings: true },
  { id: "koffi", name: "Koffi", skin: "#5a3420", hair: "fade", hairColor: H, outfit: "#1d4ed8", outfit2: "#93c5fd", pattern: "zigzag", bg: "#dbeafe", beard: true },
  { id: "awa", name: "Awa", skin: "#a0662f", hair: "braids", hairColor: "#2b1a12", outfit: "#65a30d", outfit2: "#d9f99d", pattern: "dots", bg: "#ecfccb", earrings: true },
  { id: "yao", name: "Yao", skin: "#6b3e26", hair: "kufi", hairColor: H, outfit: "#0f766e", outfit2: "#99f6e4", pattern: "stripes", wrap: "#b91c1c", wrap2: "#facc15", bg: "#ccfbf1" },
  { id: "fatou", name: "Fatou", skin: "#4a2a1a", hair: "knots", hairColor: H, outfit: "#db2777", outfit2: "#fbcfe8", pattern: "dots", bg: "#fce7f3", earrings: true },
  { id: "ibrahim", name: "Ibrahim", skin: "#8d5524", hair: "fade", hairColor: "#2b1a12", outfit: "#16181d", outfit2: "#c8f135", pattern: "stripes", bg: "#eefbc4", glasses: true },
  { id: "adjoua", name: "Adjoua", skin: "#6b3e26", hair: "afro", hairColor: "#2b1a12", outfit: "#eab308", outfit2: "#7c2d12", pattern: "zigzag", bg: "#fef9c3", earrings: true },
  { id: "moussa", name: "Moussa", skin: "#5a3420", hair: "locs", hairColor: "#3b2416", outfit: "#ea580c", outfit2: "#15803d", pattern: "kente", bg: "#ffedd5", beard: true },
  { id: "mariam", name: "Mariam", skin: "#c68642", hair: "wrap", hairColor: H, outfit: "#7c3aed", outfit2: "#ddd6fe", pattern: "zigzag", wrap: "#7c3aed", wrap2: "#fbbf24", bg: "#ede9fe" },
  { id: "kouame", name: "Kouamé", skin: "#4a2a1a", hair: "bald", hairColor: H, outfit: "#15803d", outfit2: "#facc15", pattern: "kente", bg: "#dcfce7", beard: true, glasses: true },
  { id: "aminata", name: "Aminata", skin: "#a0662f", hair: "puff", hairColor: H, outfit: "#0891b2", outfit2: "#cffafe", pattern: "dots", bg: "#cffafe", earrings: true },
  { id: "sekou", name: "Sékou", skin: "#8d5524", hair: "twists", hairColor: H, outfit: "#dc2626", outfit2: "#fecaca", pattern: "zigzag", bg: "#fee2e2" },
];

export const bitmojiById = (id?: string | null) => BITMOJIS.find((b) => b.id === id);

/** Bitmoji par défaut : toujours le même pour une personne (calculé depuis son identifiant) */
export function defaultBitmoji(seed: string): BitmojiDef {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return BITMOJIS[h % BITMOJIS.length];
}

function patternDef(id: string, d: BitmojiDef) {
  const a = d.outfit2, b = d.outfit;
  switch (d.pattern) {
    case "dots":
      return `<pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="2.6" fill="${a}"/><circle cx="0" cy="0" r="1.4" fill="${a}"/><circle cx="12" cy="12" r="1.4" fill="${a}"/></pattern>`;
    case "zigzag":
      return `<pattern id="${id}" width="12" height="9" patternUnits="userSpaceOnUse"><polyline points="0,6 3,2 6,6 9,2 12,6" fill="none" stroke="${a}" stroke-width="1.8" stroke-linejoin="round"/></pattern>`;
    case "kente":
      return `<pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${a}"/><rect x="8" y="8" width="8" height="8" fill="${a}"/><rect x="2" y="10" width="4" height="4" fill="#facc15"/><rect x="10" y="2" width="4" height="4" fill="#facc15"/><rect x="8" width="8" height="8" fill="${b}"/></pattern>`;
    default:
      return `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="4" height="10" fill="${a}"/></pattern>`;
  }
}

function hairBack(d: BitmojiDef, pat: string) {
  const c = d.hairColor;
  switch (d.hair) {
    case "afro": {
      const bumps = Array.from({ length: 14 }, (_, i) => {
        const t = (i / 14) * Math.PI * 2;
        return `<circle cx="${(60 + Math.cos(t) * 31).toFixed(1)}" cy="${(44 + Math.sin(t) * 29).toFixed(1)}" r="9" fill="${c}"/>`;
      }).join("");
      return `<circle cx="60" cy="44" r="32" fill="${c}"/>${bumps}`;
    }
    case "puff": return `<circle cx="60" cy="17" r="16" fill="${c}"/><circle cx="50" cy="12" r="7" fill="${c}"/><circle cx="70" cy="12" r="7" fill="${c}"/>`;
    case "braids": return [28, 33, 38, 82, 87, 92].map((x) => `<rect x="${x - 3}" y="38" width="6" height="${x < 60 ? 62 - (38 - x) : 62 - (x - 82)}" rx="3" fill="${c}"/>`).join("")
      + [30, 90].map((x) => `<circle cx="${x}" cy="${x < 60 ? 100 : 100}" r="3.2" fill="${d.outfit2}"/>`).join("");
    case "locs": return [27, 34, 41, 79, 86, 93].map((x, i) => `<path d="M${x} 36 q${i % 2 ? 4 : -4} 18 0 34 q${i % 2 ? -3 : 3} 10 0 18" stroke="${c}" stroke-width="7" stroke-linecap="round" fill="none"/>`).join("");
    case "wrap": return `<path d="M27 52 C 20 10, 100 10, 93 52 Z" fill="${d.wrap}"/><path d="M27 52 C 20 10, 100 10, 93 52 Z" fill="url(#${pat}-w)"/>`;
    default: return "";
  }
}

function hairFront(d: BitmojiDef, pat: string) {
  const c = d.hairColor;
  const cap = `<path d="M34 52 C 32 24, 88 24, 86 52 C 82 38, 72 34, 60 34 C 48 34, 38 38, 34 52 Z" fill="${c}"/>`;
  switch (d.hair) {
    case "afro": return `<path d="M34 50 C 33 26, 87 26, 86 50 C 80 37, 40 37, 34 50 Z" fill="${c}"/>`;
    case "fade": return `<path d="M35 47 C 36 27, 84 27, 85 47 C 79 39, 70 36, 60 36 C 50 36, 41 39, 35 47 Z" fill="${c}"/>`;
    case "puff": case "braids": case "locs": return cap;
    case "knots": return cap + [[40, 30], [52, 23], [68, 23], [80, 30], [60, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${c}"/><path d="M${x - 3} ${y - 2} q3 -3 6 0" stroke="#3b2416" stroke-width="1.2" fill="none"/>`).join("");
    case "twists": return cap + Array.from({ length: 9 }, (_, i) => { const x = 37 + i * 5.8; const y = 30 - Math.sin((i / 8) * Math.PI) * 6; return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.4" ry="5.5" fill="${c}"/>`; }).join("");
    case "kufi": return `<path d="M35 42 C 36 20, 84 20, 85 42 Z" fill="${d.wrap}"/><path d="M35 42 C 36 20, 84 20, 85 42 Z" fill="url(#${pat}-w)"/><rect x="34" y="38" width="52" height="6" rx="3" fill="${d.wrap2}"/>`;
    case "wrap": return `<path d="M32 50 C 40 38, 80 38, 88 50 C 80 44, 40 44, 32 50 Z" fill="${d.wrap2}"/>`
      + `<ellipse cx="50" cy="17" rx="12" ry="7" transform="rotate(-25 50 17)" fill="${d.wrap}"/><ellipse cx="70" cy="17" rx="12" ry="7" transform="rotate(25 70 17)" fill="${d.wrap}"/><circle cx="60" cy="20" r="5.5" fill="${d.wrap2}"/>`;
    case "bald": return `<ellipse cx="50" cy="34" rx="7" ry="3.5" fill="#fff" opacity="0.18" transform="rotate(-20 50 34)"/>`;
  }
}

function eyes(m: Mood) {
  const open = (x: number, r = 5) => `<ellipse cx="${x}" cy="54" rx="${r}" ry="${r + 0.6}" fill="#fff"/><circle cx="${x + 0.6}" cy="54.6" r="${r * 0.62}" fill="${H}"/><circle cx="${x + 1.8}" cy="53" r="1.1" fill="#fff"/>`;
  const closed = (x: number) => `<path d="M${x - 5} 55 Q${x} 49 ${x + 5} 55" stroke="${H}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
  const sleepy = (x: number) => `<path d="M${x - 5} 54 Q${x} 58 ${x + 5} 54" stroke="${H}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
  switch (m) {
    case "laugh": case "yum": return closed(50) + closed(70);
    case "wink": return open(50) + closed(70);
    case "wow": return open(50, 6.2) + open(70, 6.2);
    case "sleep": return sleepy(50) + sleepy(70);
    default: return open(50) + open(70);
  }
}

function brows(m: Mood, c: string) {
  if (m === "sad") return `<path d="M44 46 L55 43 M65 43 L76 46" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
  if (m === "wow") return `<path d="M44 42 Q50 38 56 42 M64 42 Q70 38 76 42" stroke="${c}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
  return `<path d="M44 45 Q50 42 56 45 M64 45 Q70 42 76 45" stroke="${c}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`;
}

function mouth(m: Mood) {
  const dark = "#4a1414";
  switch (m) {
    case "laugh": return `<path d="M48 66 Q60 86 72 66 Z" fill="${dark}"/><path d="M50 67 L70 67 L69 70 L51 70 Z" fill="#fff"/><ellipse cx="60" cy="77" rx="6" ry="3.6" fill="#f87171"/>`;
    case "yum": return `<path d="M48 66 Q60 77 72 66" stroke="${dark}" stroke-width="3" stroke-linecap="round" fill="none"/><ellipse cx="67" cy="72" rx="4.2" ry="5.2" transform="rotate(-20 67 72)" fill="#f87171"/>`;
    case "wow": return `<ellipse cx="60" cy="71" rx="5" ry="6.2" fill="${dark}"/>`;
    case "sad": return `<path d="M52 73 Q60 66 68 73" stroke="${dark}" stroke-width="2.8" stroke-linecap="round" fill="none"/>`;
    case "sleep": return `<path d="M56 70 Q60 72.5 64 70" stroke="${dark}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
    default: return `<path d="M47 65 Q60 82 73 65 Q60 70 47 65 Z" fill="${dark}"/><path d="M50 66.2 Q60 70 70 66.2 L69 68.5 Q60 72 51 68.5 Z" fill="#fff"/>`;
  }
}

/** SVG complet (chaîne) : utilisable dans React (BitmojiAvatar) comme dans un script */
export function bitmojiSvg(d: BitmojiDef, mood: Mood = "happy", uid = "b") {
  const pat = `${uid}-${d.id}`;
  const shade = "rgba(0,0,0,0.12)";
  const extra = mood === "sleep" ? `<g font-family="sans-serif" font-weight="900" fill="#fff" stroke="#16181d" stroke-width="1.6" paint-order="stroke"><text x="86" y="30" font-size="15">z</text><text x="98" y="20" font-size="11">z</text></g>`
    : mood === "wow" ? `<path d="M90 24 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="#facc15"/>`
    : mood === "sad" ? `<path d="M80 60 q3 6 0 8 q-3 -2 0 -8 z" fill="#60a5fa"/>` : "";
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${d.name}">
<defs>${patternDef(pat, d)}${d.wrap ? patternDef(`${pat}-w`, { ...d, outfit2: d.wrap2 ?? "#fff", outfit: d.wrap, pattern: d.hair === "kufi" ? "kente" : "dots" }) : ""}
<clipPath id="${pat}-c"><circle cx="60" cy="60" r="60"/></clipPath></defs>
<g clip-path="url(#${pat}-c)">
<rect width="120" height="120" fill="${d.bg}"/>
<g transform="translate(60 69) scale(1.13) translate(-60 -60)">
${hairBack(d, pat)}
<rect x="51" y="74" width="18" height="18" rx="7" fill="${d.skin}"/><ellipse cx="60" cy="80" rx="9" ry="4" fill="${shade}"/>
<path d="M12 122 C 16 96, 38 86, 60 86 C 82 86, 104 96, 108 122 Z" fill="${d.outfit}"/>
<path d="M12 122 C 16 96, 38 86, 60 86 C 82 86, 104 96, 108 122 Z" fill="url(#${pat})" opacity="0.9"/>
<path d="M48 87 Q60 100 72 87 Q60 92 48 87 Z" fill="${d.skin}"/>
<ellipse cx="34" cy="57" rx="5" ry="7" fill="${d.skin}"/><ellipse cx="86" cy="57" rx="5" ry="7" fill="${d.skin}"/>
<ellipse cx="60" cy="55" rx="26" ry="29" fill="${d.skin}"/>
${d.beard ? `<path d="M35 56 C 35 96, 85 96, 85 56 C 82 68, 74 76, 60 76 C 46 76, 38 68, 35 56 Z" fill="${d.hairColor}"/><path d="M48 64 Q60 59 72 64 Q60 63.5 48 64 Z" fill="${d.hairColor}"/>` : ""}
${hairFront(d, pat)}
${d.earrings ? `<circle cx="34" cy="67" r="3.6" fill="none" stroke="#f2b632" stroke-width="2"/><circle cx="86" cy="67" r="3.6" fill="none" stroke="#f2b632" stroke-width="2"/>` : ""}
<ellipse cx="43" cy="65" rx="4.5" ry="2.8" fill="#ff7a7a" opacity="0.28"/><ellipse cx="77" cy="65" rx="4.5" ry="2.8" fill="#ff7a7a" opacity="0.28"/>
${brows(mood, d.hair === "bald" ? "#2b1a12" : d.hairColor)}
${eyes(mood)}
<path d="M58 60 Q60 64 62 60" stroke="rgba(0,0,0,0.35)" stroke-width="2" stroke-linecap="round" fill="none"/>
${mouth(mood)}
${d.glasses ? `<g fill="none" stroke="#16181d" stroke-width="2.4"><rect x="42" y="47" width="16" height="13" rx="5"/><rect x="62" y="47" width="16" height="13" rx="5"/><path d="M58 53 L62 53 M42 52 L36 50 M78 52 L84 50"/></g>` : ""}
</g>
${extra}
</g></svg>`;
}
