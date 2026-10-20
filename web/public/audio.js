// Extraits musicaux du blind test : Sarah importe ses propres fichiers (MP3, M4A, WAV…) dans
// l'administration. Le navigateur découpe l'extrait choisi, ajoute un fondu et le réencode en MP3 mono
// léger, rangé dans la bibliothèque (library/sounds/<empreinte>) comme les photos. La TV le copie dans son
// cache avant la partie et le joue sans Internet : aucune plateforme de streaming qui pourrait bloquer,
// couper ou réclamer un abonnement le jour J. Les informations de droits sont facultatives, jamais bloquantes.
import { imageId } from "./illustration.js";

/** Taille maximale d'un extrait enregistré (caractères de son adresse data:), sous la limite des règles. */
export const SOUND_BUDGET = 880_000;
/** Durées d'extrait proposées (secondes) ; les règles acceptent de 10 à 45 s. */
export const EXTRACT_SECONDS = [15, 20, 25, 30, 40];
export const DEFAULT_EXTRACT = 25;
const RATE = 44_100;
const FADE_IN = 0.3;
const FADE_OUT = 1.5;

/** Identifiant d'un extrait : le début de l'empreinte SHA-256 de son contenu (même calcul que les photos). */
export const soundId = imageId;

/** « Artiste - Titre.mp3 » → { artist, title } ; sinon le nom du fichier comme titre. */
export function guessTrack(fileName) {
  const base = (fileName ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_/g, " ").replace(/^\d{1,3}[\s.-]+/, "").trim();
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim().slice(0, 80), title: parts.slice(1).join(" - ").trim().slice(0, 80) };
  return { artist: "", title: base.slice(0, 80) };
}

/** Début d'extrait proposé : le refrain arrive souvent vers le premier tiers du morceau. */
export function defaultStart(durationSec, extractSec = DEFAULT_EXTRACT) {
  const start = Math.min(45, Math.max(0, durationSec / 3));
  return Math.max(0, Math.min(Math.floor(start), Math.floor(durationSec - extractSec)));
}

/** Lit un fichier audio choisi sur le PC (tout format que le navigateur sait lire). */
export async function decodeFile(file) {
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, RATE, RATE);
  return ctx.decodeAudioData(data);
}

/** Extrait mono de [seconds] secondes à partir de [start], avec un fondu d'entrée et de sortie. */
export async function cutExtract(buffer, start, seconds) {
  const from = Math.max(0, Math.min(start, Math.max(0, buffer.duration - 1)));
  const length = Math.max(1, Math.min(seconds, buffer.duration - from));
  const ctx = new OfflineAudioContext(1, Math.ceil(length * RATE), RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, Math.min(FADE_IN, length / 4));
  gain.gain.setValueAtTime(1, Math.max(0, length - FADE_OUT));
  gain.gain.linearRampToValueAtTime(0, length);
  src.connect(gain).connect(ctx.destination);
  src.start(0, from, length);
  const out = await ctx.startRendering();
  normalizeLevel(out.getChannelData(0));
  return out;
}

/** Niveau visé pour tous les extraits (RMS en pleine échelle, environ -14 dB) : ni plus bas que les bruitages, ni plus fort d'une chanson à l'autre. */
const TARGET_RMS = 0.2;
const KNEE = 0.8;

/**
 * Met un extrait au niveau commun, sur place : gain vers [TARGET_RMS] (entre ÷2 et ×4), crêtes adoucies au-dessus de
 * [KNEE] pour ne jamais dépasser la pleine échelle. Un extrait silencieux reste tel quel.
 */
export function normalizeLevel(samples) {
  let sum = 0, peak = 0;
  for (const x of samples) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms < 1e-4 || peak < 1e-4) return 1;
  const g = Math.min(4, Math.max(0.5, TARGET_RMS / rms), 1.5 / peak);
  for (let i = 0; i < samples.length; i++) {
    const y = samples[i] * g, a = Math.abs(y);
    samples[i] = a <= KNEE ? y : Math.sign(y) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
  }
  return g;
}

/** Encode un AudioBuffer mono en MP3 ([kbps]) et rend son adresse data:audio/mpeg. */
export async function encodeMp3(buffer, kbps = 80) {
  const { Mp3Encoder } = await import("./vendor/lamejs.js");
  const samples = buffer.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  const enc = new Mp3Encoder(1, buffer.sampleRate, kbps);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (b.length) parts.push(b);
  }
  parts.push(enc.flush());
  const bytes = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:audio/mpeg;base64,${btoa(binary)}`;
}

/** Extrait prêt à ranger : découpé, réencodé sous [SOUND_BUDGET] (débit réduit si besoin), avec son identifiant. */
export async function makeExtract(buffer, start, seconds) {
  const cut = await cutExtract(buffer, start, seconds);
  for (const kbps of [96, 80, 64, 48]) {
    const data = await encodeMp3(cut, kbps);
    if (data.length <= SOUND_BUDGET) return { id: await soundId(data), data, seconds: Math.round(cut.duration) };
  }
  throw new Error("Extrait trop lourd : choisissez une durée plus courte");
}

// ---------- Comptines du domaine public (prestation de test) ----------
// Mélodies traditionnelles, libres de droits : jouées par un petit synthétiseur dans le navigateur.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const freq = (n) => {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  const midi = 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] ? 1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
};

/** Joue une mélodie « note:temps » (temps en noires) au tempo [bpm], en boucle sur [seconds] secondes. */
export async function synthTune(melody, seconds = 20, bpm = 120) {
  const notes = melody.trim().split(/\s+/).map((t) => { const [n, d] = t.split(":"); return { n, d: Number(d ?? 1) }; });
  const beat = 60 / bpm;
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  let t = 0.05;
  while (t < seconds - 0.5) {
    for (const { n, d } of notes) {
      if (t >= seconds - 0.5) break;
      const len = d * beat;
      if (n !== "R") {
        for (const [mult, vol, type] of [[1, 1, "triangle"], [2, 0.25, "sine"]]) {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = freq(n) * mult;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(vol, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + len * 0.95);
          osc.connect(g).connect(master);
          osc.start(t);
          osc.stop(t + len);
        }
      }
      t += len;
    }
    t += beat;
  }
  return ctx.startRendering();
}
