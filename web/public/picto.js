// Pictionary sur le pupitre : la feuille à dessin de l'équipe qui joue. Le dessin part vers la TV par petits
// paquets de traits (environ 10 par seconde) dans games/<code>/drawing/<clé du tour>/<push> :
//   { c: couleur "#RRGGBB" ou "paper" (gomme), w: épaisseur 1 à 3, p: "x,y x,y …" }  ou  { clear: true }.
// Les coordonnées vont de 0 à 1000 sur une feuille au format 4:3 (la TV dessine la même feuille, à sa taille).
// Un paquet qui continue un trait recommence par son dernier point : la TV relie les paquets sans trou.
import { ref, push } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";

/** Couleurs de la palette (la première est celle du crayon au départ) ; « paper » est la gomme. */
export const PICTO_COLORS = ["#1A0B2E", "#F94144", "#FF8C1A", "#FFD60A", "#2EE86B", "#2B86C5", "#9B5DE5", "#8B5A2B"];
const WIDTHS = { 1: 6, 2: 14, 3: 30 };
/** Feuille au format 4:3 ; coordonnées entières de 0 à 1000 sur chaque axe. */
export const SHEET_RATIO = 4 / 3;
const FLUSH_MS = 90;
const MIN_STEP = 4;

/**
 * Feuille à dessin dans [root] (canvas, outils) qui envoie ses traits dans [path] de la base [db].
 * Renvoie un objet { stop() } : arrêter de dessiner (fin du tour, autre écran).
 */
export function startSheet(root, db, path, { onError } = {}) {
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const target = ref(db, path);
  let color = PICTO_COLORS[0];
  let width = 2;
  let stroke = null;
  let sent = 0;
  let timer = null;
  let stopped = false;
  const done = [];

  const send = (data) => push(target, data).catch((e) => { console.error(e); onError?.(); });

  function size() {
    const box = root.querySelector(".sheet-paper").getBoundingClientRect();
    const w = Math.max(1, Math.min(box.width, box.height * SHEET_RATIO));
    const h = w / SHEET_RATIO;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    redraw();
  }

  function paint(s) {
    const sx = canvas.width / 1000;
    const sy = canvas.height / 1000;
    ctx.strokeStyle = ctx.fillStyle = s.c === "paper" ? "#FFFFFF" : s.c;
    ctx.lineWidth = WIDTHS[s.w] * (canvas.width / 1000) * (1000 / 800);
    ctx.lineCap = ctx.lineJoin = "round";
    if (s.pts.length === 1) {
      ctx.beginPath();
      ctx.arc(s.pts[0][0] * sx, s.pts[0][1] * sy, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * sx, y * sy) : ctx.moveTo(x * sx, y * sy)));
    ctx.stroke();
  }

  function redraw() {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    done.forEach(paint);
    if (stroke) paint(stroke);
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000);
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000);
    return [Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y))];
  }

  /** Envoie les points pas encore partis du trait en cours, en reprenant le dernier point déjà envoyé. */
  function flush() {
    if (!stroke) return;
    const from = Math.max(0, sent - 1);
    const pts = stroke.pts.slice(from);
    if (sent > 0 && pts.length < 2) return;
    send({ c: stroke.c, w: stroke.w, p: pts.map(([x, y]) => `${x},${y}`).join(" ") });
    sent = stroke.pts.length;
  }

  canvas.onpointerdown = (e) => {
    if (stopped) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    stroke = { c: color, w: width, pts: [point(e)] };
    sent = 0;
    paint(stroke);
    clearInterval(timer);
    timer = setInterval(flush, FLUSH_MS);
  };
  canvas.onpointermove = (e) => {
    if (!stroke || stopped) return;
    e.preventDefault();
    const p = point(e);
    const last = stroke.pts[stroke.pts.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < MIN_STEP) return;
    stroke.pts.push(p);
    paint({ ...stroke, pts: [last, p] });
  };
  const end = () => {
    if (!stroke) return;
    clearInterval(timer);
    flush();
    done.push(stroke);
    stroke = null;
  };
  canvas.onpointerup = end;
  canvas.onpointercancel = end;
  canvas.onpointerleave = end;

  root.querySelectorAll("[data-color]").forEach((b) => {
    b.style.setProperty("--swatch", b.dataset.color === "paper" ? "#FFFFFF" : b.dataset.color);
    b.onclick = () => {
      color = b.dataset.color;
      root.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  root.querySelectorAll("[data-width]").forEach((b) => {
    b.onclick = () => {
      width = Number(b.dataset.width);
      root.querySelectorAll("[data-width]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  const clear = root.querySelector("[data-clear]");
  clear.onclick = () => {
    if (stopped) return;
    done.length = 0;
    stroke = null;
    redraw();
    send({ clear: true });
  };
  // Outils remis à zéro à chaque tour : crayon foncé, trait moyen.
  root.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x.dataset.color === color));
  root.querySelectorAll("[data-width]").forEach((x) => x.classList.toggle("on", Number(x.dataset.width) === width));

  window.addEventListener("resize", size);
  size();
  return {
    stop() {
      stopped = true;
      end();
      clearInterval(timer);
      window.removeEventListener("resize", size);
      canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = canvas.onpointerleave = null;
    },
  };
}
