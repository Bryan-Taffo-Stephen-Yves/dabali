// Sons et voix du scanner : générés par le navigateur (aucun fichier à télécharger, marche hors ligne).
const PREF = "dabali:scan-audio"; // "on" (sons + voix) · "sound" (sons seuls) · "off"
export type AudioPref = "on" | "sound" | "off";

export function audioPref(): AudioPref {
  try { return (localStorage.getItem(PREF) as AudioPref) || "on"; } catch { return "on"; }
}
export function setAudioPref(p: AudioPref) { try { localStorage.setItem(PREF, p); } catch {} }

let ctx: AudioContext | null = null;
function audio() {
  const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx ??= new C();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tones(notes: { f: number; at: number; dur: number; type?: OscillatorType; vol?: number }[]) {
  const c = audio();
  for (const n of notes) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = n.type ?? "sine";
    o.frequency.value = n.f;
    const t = c.currentTime + n.at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(n.vol ?? 0.28, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + n.dur + 0.02);
  }
}

/** Ticket valide : petit carillon montant (do-mi-sol). */
export function soundOk() {
  if (audioPref() === "off") return;
  try { tones([{ f: 1046, at: 0, dur: 0.14 }, { f: 1318, at: 0.09, dur: 0.14 }, { f: 1568, at: 0.18, dur: 0.32 }]); } catch {}
  navigator.vibrate?.(70);
}

/** Refus : double bourdonnement grave, bien distinct du succès. */
export function soundError() {
  if (audioPref() === "off") return;
  try { tones([{ f: 196, at: 0, dur: 0.2, type: "square", vol: 0.18 }, { f: 165, at: 0.24, dur: 0.32, type: "square", vol: 0.18 }]); } catch {}
  navigator.vibrate?.([140, 70, 140]);
}

/** Plat enregistré : « clic » discret. */
export function soundServed() {
  if (audioPref() === "off") return;
  try { tones([{ f: 1760, at: 0, dur: 0.06, type: "triangle", vol: 0.2 }]); } catch {}
  navigator.vibrate?.(30);
}

/** Annonce vocale en français (si la voix est activée). */
export function say(text: string) {
  if (audioPref() !== "on" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    u.rate = 1.08;
    const fr = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("fr"));
    if (fr) u.voice = fr;
    window.speechSynthesis.speak(u);
  } catch {}
}
