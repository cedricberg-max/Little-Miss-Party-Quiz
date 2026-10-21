// Paroles des chansons du blind test (cedric, 21/10) : Sarah ajoute le fichier .lrc de chaque chanson (paroles avec
// leurs temps). La Régie PC le lit, devine le refrain (la phrase la plus répétée) et garde seulement le passage de
// l'extrait du refrain, sous une forme courte que la TV affiche au rythme de la musique : une ligne par phrase,
// « début|texte » ou « début|texte|temps des mots », en millisecondes depuis le début de l'extrait du refrain.

/** Taille maximale d'un fichier .lrc rangé dans la bibliothèque, et des paroles d'un refrain (comme la TV). */
export const MAX_LRC = 60000;
export const MAX_PAROLES = 8000;

const TEMPS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const MOT = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const sec = (m, s, f) => Number(m) * 60 + Number(s) + (f ? Number(`0.${f}`) : 0);

/**
 * Lit un fichier .lrc : les phrases dans l'ordre, { t (secondes), text, words? } ; words (forme « enrichie », un temps
 * par mot) : [{ t, w }]. Une phrase répétée à plusieurs moments ([00:12.00][01:30.00]…) apparaît à chacun. Le décalage
 * [offset:…] du fichier est appliqué. Les lignes d'informations ([ar:…], [ti:…]) sont ignorées.
 */
export function lireLrc(texte) {
  const out = [];
  let decalage = 0;
  for (const brute of `${texte ?? ""}`.replace(/^﻿/, "").split(/\r?\n/)) {
    const off = brute.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { decalage = Number(off[1]) / 1000; continue; }
    const temps = [...brute.matchAll(TEMPS)];
    if (!temps.length) continue;
    const reste = brute.slice(temps[temps.length - 1].index + temps[temps.length - 1][0].length);
    // Forme enrichie : <mm:ss.xx>mot <mm:ss.xx>mot…
    const marques = [...reste.matchAll(MOT)];
    const words = marques.length ? marques.map((m, k) => ({
      t: sec(m[1], m[2], m[3]) - decalage,
      w: reste.slice(m.index + m[0].length, k + 1 < marques.length ? marques[k + 1].index : undefined).trim(),
    })).filter((x) => x.w) : null;
    const text = (words ? words.map((x) => x.w).join(" ") : reste).replace(/\s+/g, " ").trim();
    for (const m of temps) {
      const t = sec(m[1], m[2], m[3]) - decalage;
      if (Number.isFinite(t) && t >= 0) out.push({ t, text, ...(words ? { words } : {}) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

const cle = (x) => `${x ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Moment du refrain d'après les paroles (secondes), ou null : la première fois qu'arrive le passage le plus répété de
 * la chanson (une phrase chantée au moins deux fois), en remontant au début de son groupe de phrases répétées.
 */
export function refrainDesParoles(lignes) {
  const chantees = (lignes ?? []).filter((l) => cle(l.text).length >= 4);
  if (chantees.length < 4) return null;
  const compte = new Map();
  chantees.forEach((l) => compte.set(cle(l.text), (compte.get(cle(l.text)) ?? 0) + 1));
  const max = Math.max(...compte.values());
  if (max < 2) return null;
  let k = chantees.findIndex((l) => compte.get(cle(l.text)) === max);
  // Début du refrain : les phrases répétées juste avant font partie du même passage.
  while (k > 0 && compte.get(cle(chantees[k - 1].text)) >= 2 && chantees[k].t - chantees[k - 1].t < 12) k -= 1;
  return chantees[k].t;
}

/**
 * Premiers mots chantés (secondes) : la première phrase des paroles, sans les petits bruits (« ♪ », « oh »). Null
 * sans paroles chantées.
 */
export function debutDesParoles(lignes) {
  const l = (lignes ?? []).find((x) => cle(x.text).length >= 3);
  return l ? l.t : null;
}

/**
 * Paroles de l'extrait du refrain sous la forme courte de la TV : les phrases chantées entre [debut] et
 * [debut] + [duree] secondes, temps en millisecondes depuis [debut]. La phrase déjà commencée au début de l'extrait
 * est gardée (calée à 0). Rend "" s'il n'y a rien à chanter dans ce passage.
 */
export function parolesDuRefrain(lignes, debut, duree) {
  const ms = (t) => Math.max(0, Math.round((t - debut) * 1000));
  const dedans = (lignes ?? []).filter((l) => l.t >= debut - 0.25 && l.t < debut + duree);
  // La phrase qui chante déjà quand l'extrait commence (commencée depuis peu, et loin de sa fin).
  const avant = (lignes ?? []).filter((l) => l.t < debut - 0.25).pop();
  const suivante = dedans[0]?.t ?? debut + duree;
  if (avant?.text && debut - avant.t < 8 && suivante - debut > 1.5) dedans.unshift({ text: avant.text, t: debut });
  const out = [];
  let taille = 0;
  for (const l of dedans) {
    const text = l.text.replace(/[|\n]/g, " ").trim();
    const mots = text.split(" ").filter(Boolean);
    const temps = l.words && l.t >= debut - 0.25 && l.words.length === mots.length ? `|${l.words.map((x) => ms(x.t)).join(",")}` : "";
    const ligne = `${ms(l.t)}|${text}${temps}`;
    if (taille + ligne.length + 1 > MAX_PAROLES) break;
    out.push(ligne);
    taille += ligne.length + 1;
  }
  return out.some((x) => x.split("|")[1]) ? out.join("\n") : "";
}

/**
 * Nom simplifié d'un fichier pour retrouver ses paroles : « Black Eyed Peas - GIRL LIKE ME.mp3 » et
 * « Black Eyed Peas_GIRL LIKE ME.lrc » donnent le même nom (lettres et chiffres seulement, sans accents).
 */
export function nomSimple(fichier) {
  return cle(`${fichier ?? ""}`.replace(/\.[^.]+$/, ""));
}

/** Associe à chaque fichier musical son fichier .lrc (même nom simplifié) ; rend aussi les .lrc restés seuls. */
export function associerParoles(fichiers) {
  const lrc = new Map();
  const musiques = [];
  for (const f of fichiers) {
    if (/\.lrc$/i.test(f.name)) lrc.set(nomSimple(f.name), f);
    else musiques.push(f);
  }
  const paires = musiques.map((f) => {
    const p = lrc.get(nomSimple(f.name)) ?? null;
    if (p) lrc.delete(nomSimple(f.name));
    return { musique: f, lrc: p };
  });
  return { paires, seuls: [...lrc.values()] };
}
