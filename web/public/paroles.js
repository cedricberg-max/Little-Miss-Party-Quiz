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

/** Clé de comparaison d'un texte : lettres et chiffres, sans accents ni majuscules. */
export const cle = (x) => `${x ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Moment du refrain d'après les paroles (secondes), ou null : la première fois qu'arrive le passage le plus répété de
 * la chanson (une phrase chantée au moins deux fois), en remontant au début de son groupe de phrases répétées.
 */
export function refrainDesParoles(lignes) {
  return refrainsDesParoles(lignes)[0] ?? null;
}

/**
 * Chaque fois que le refrain est chanté (secondes, dans l'ordre) : les moments de la première phrase du passage le
 * plus répété (voir refrainDesParoles). La même phrase reprise dans le même refrain (moins de 12 s après) ne compte
 * qu'une fois. Vide sans refrain.
 */
export function refrainsDesParoles(lignes) {
  const chantees = (lignes ?? []).filter((l) => cle(l.text).length >= 4);
  if (chantees.length < 4) return [];
  const compte = new Map();
  chantees.forEach((l) => compte.set(cle(l.text), (compte.get(cle(l.text)) ?? 0) + 1));
  const max = Math.max(...compte.values());
  if (max < 2) return [];
  let k = chantees.findIndex((l) => compte.get(cle(l.text)) === max);
  // Début du refrain : les phrases chantées juste avant aussi souvent que lui font partie du même passage. Un refrain
  // chanté 3 fois ou plus ne remonte pas sur le pré-refrain, chanté seulement 2 fois (cedric, 21/10 : le hook tombait
  // sur le passage calme juste avant le vrai refrain).
  const seuil = Math.min(3, max);
  while (k > 0 && compte.get(cle(chantees[k - 1].text)) >= seuil && chantees[k].t - chantees[k - 1].t < 12) k -= 1;
  const premiere = cle(chantees[k].text);
  const fois = [];
  for (const l of chantees.slice(k)) {
    if (cle(l.text) === premiere && (!fois.length || l.t - fois[fois.length - 1] >= 12)) fois.push(l.t);
  }
  return fois;
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
 * Phrase chantée au moment [s] (secondes depuis le début de la chanson) : l'indice de la dernière phrase commencée, ou
 * -1 avant la première. Pour la fenêtre des paroles de la Régie PC (cedric, 23/10).
 */
export function ligneAuMoment(lignes, s) {
  let i = -1;
  for (const [k, l] of (lignes ?? []).entries()) {
    if (l.t > s) break;
    i = k;
  }
  return i;
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

/**
 * Mauvaises réponses du Quiz musical (cedric, 24/10) : des mots du refrain qui pourraient passer pour le titre, à côté
 * du vrai titre, pour semer le doute. Elles sont prises dans les phrases chantées pendant les [LEURRES_FENETRE_SEC]
 * premières secondes du refrain réglé pour le hook (tout l'extrait du refrain s'il en faut plus).
 */
export const LEURRES_FENETRE_SEC = 30;
/** Longueur maximale d'une mauvaise réponse (elle tient sur une carte de la TV et un bouton de pupitre). */
export const LEURRE_MAX = 40;

// Petits mots qui ne finissent jamais un titre plausible (« Je veux de », « Dans la »), en français et en anglais.
const PAS_EN_FIN = new Set(("a à au aux de des du en et l la le les un une ou je j tu il elle on nous vous ils elles me m te t se s ce c "
  + "ça qu que qui ne n pour par sur dans avec sans mais mon ma mes ton ta tes son sa ses leur nos vos "
  + "the an and or of to in on at for with from my your his her our their i you he she we they it is am are was be so but get got all dont cant wont im").split(" "));
// Ni le début d'un titre : une phrase coupée au milieu.
const PAS_EN_DEBUT = new Set(["et", "ou", "mais", "que", "qu", "and", "or", "but", "that"]);
// Bruits chantés : jamais une mauvaise réponse à eux seuls.
const BRUITS = new Set("oh ooh oooh ah aah eh hey yeah yeh ouh ouais la na da di du doo ba uh hmm mmm whoa wow yo ha hou".split(" "));

/**
 * Propositions de mauvaises réponses pour la chanson [titre], d'après ses paroles du refrain [paroles] (forme courte de
 * la TV, voir parolesDuRefrain) : la meilleure d'abord. Les bouts de phrase répétés dans le refrain passent devant (on
 * les retient comme un titre), puis les phrases entières et les bouts de 2 ou 3 mots. Jamais le titre lui-même ni une
 * phrase qui le contient, jamais deux propositions dont l'une contient l'autre. Vide sans paroles.
 */
export function propositionsDeTitre(paroles, titre) {
  const lignes = `${paroles ?? ""}`.split("\n").map((l) => l.split("|")).filter((p) => p.length >= 2 && p[1].trim())
    .map((p) => ({ ms: Number(p[0]), text: p[1] }));
  const dansLeRefrain = lignes.filter((l) => l.ms < LEURRES_FENETRE_SEC * 1000);
  const propositions = proposer(dansLeRefrain, titre);
  return propositions.length >= 3 || dansLeRefrain.length === lignes.length ? propositions : proposer(lignes, titre);
}

function proposer(lignes, titre) {
  // Le titre sans ses précisions : « Toxic (Radio Edit) » se compare comme « Toxic ».
  const titreCle = cle(`${titre ?? ""}`.replace(/\s*[([].*$/, "")) || cle(titre);
  const candidats = new Map();
  let rang = 0;
  for (const l of lignes) {
    for (const morceau of l.text.split(/[,;:!?.()«»"“”…]+|\s[-–—]\s/)) {
      const mots = morceau.split(/\s+/).map((m) => m.replace(/^['’\-]+|['’\-]+$/g, "")).filter((m) => cle(m));
      for (let debut = 0; debut < mots.length; debut += 1) {
        // Jusqu'à 5 mots, 6 pour une phrase entière.
        for (let n = 1; n <= 6 && debut + n <= mots.length; n += 1) {
          const bout = mots.slice(debut, debut + n);
          const cles = bout.map((m) => cle(m));
          const entier = n === mots.length;
          if (n === 6 && !entier) continue;
          // Un mot seul : un vrai mot d'au moins 4 lettres.
          if (n === 1 && (cles[0].length < 4 || PAS_EN_FIN.has(cles[0]) || BRUITS.has(cles[0]))) continue;
          if (PAS_EN_DEBUT.has(cles[0]) || PAS_EN_FIN.has(cles[n - 1]) || cles.every((c) => BRUITS.has(c))) continue;
          if (!cles.some((c) => c.length >= 3 && !PAS_EN_FIN.has(c) && !BRUITS.has(c))) continue;
          const texte = bout.join(" ");
          const k = cles.join("");
          if (texte.length > LEURRE_MAX || !k || k === titreCle || (titreCle.length >= 3 && k.includes(titreCle))) continue;
          const c = candidats.get(k) ?? { texte, k, fois: 0, rang: rang++, bonus: 0 };
          c.fois += 1;
          c.bonus = Math.max(c.bonus, (n === 2 || n === 3 ? 5 : n === 4 ? 3 : n >= 5 ? 0 : 1) + (entier ? 6 : 0) + (debut === 0 ? 2 : 0));
          candidats.set(k, c);
        }
      }
    }
  }
  const classes = [...candidats.values()].sort((a, b) => (b.fois * 6 + b.bonus) - (a.fois * 6 + a.bonus) || a.rang - b.rang);
  const gardes = [];
  let dansLeTitre = false;
  for (const c of classes) {
    if (gardes.some((g) => g.k.includes(c.k) || c.k.includes(g.k))) continue;
    // Un seul bout du titre (« Libérée » pour « Libérée, délivrée ») : le doute, pas la devinette.
    const partDuTitre = titreCle.includes(c.k);
    if (partDuTitre && dansLeTitre) continue;
    dansLeTitre ||= partDuTitre;
    gardes.push(c);
    if (gardes.length >= 20) break;
  }
  return gardes.map((c) => c.texte.charAt(0).toLocaleUpperCase("fr") + c.texte.slice(1));
}
