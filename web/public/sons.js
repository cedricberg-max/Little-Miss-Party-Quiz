// Bibliothèque des sons du blind test : chaque chanson importée une fois, avec ses préréglages (début de
// l'extrait, temps pour buzzer, moment du refrain). Une playlist pioche dans la bibliothèque : la chanson garde
// ses réglages d'une playlist à l'autre. Les fichiers d'origine restent sur le PC de Sarah ; la base garde
// seulement les deux extraits découpés (celui du buzz et le refrain de la révélation).

/** Temps pour buzzer proposés (secondes) : la durée de l'extrait et du chrono. Les règles acceptent de 10 à 45 s. */
export const BUZZ_SECONDS = [20, 25, 30, 35, 40, 45];
export const BUZZ_DEFAULT = 30;
/** Refrain joué en boucle à la révélation (secondes), sous la taille maximale d'un extrait. */
export const REFRAIN_SEC = 90;
/** Débits essayés pour le refrain (kbit/s, mono) : 90 s doivent tenir sous la limite d'un extrait. */
export const REFRAIN_KBPS = [56, 48, 40];

const HEX = /^[0-9a-f]{16}$/;
const sansAccent = (x) => `${x ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const listOf = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
const bounded = (v, min, max, fallback) => (Number.isFinite(v) && v >= min && v <= max ? v : fallback);

/** Temps pour buzzer d'une chanson ou d'un morceau, dans les limites. */
export const buzzOf = (x, fallback = BUZZ_DEFAULT) => bounded(x, 10, 45, fallback);

/**
 * Moment du refrain proposé, en secondes : souvent vers le milieu du morceau, après l'extrait du buzz, et assez
 * tôt pour que les 90 s tiennent dans le morceau.
 */
export function defaultRefrain(length, start = 0, buzz = BUZZ_DEFAULT) {
  const len = Number.isFinite(length) && length > 0 ? length : 0;
  const guess = Math.max(start + buzz, len * 0.4);
  return Math.max(0, Math.floor(Math.min(guess, len - REFRAIN_SEC)));
}

/**
 * Toutes les chansons connues, triées par titre : celles de la bibliothèque (library/songs), puis les morceaux des
 * playlists qui n'y sont pas encore (même extrait = même chanson). Chaque chanson dit dans quelles playlists elle est.
 * Les chansons des statues restent à part : elles n'ont ni refrain ni temps pour buzzer. Les chansons retirées
 * (cedric, 21/10) n'y sont plus, même si une playlist les garde : voir [songsRetirees].
 */
export function songList(songs, playlists, isStatuesList = (p) => p?.use === "statues") {
  const byAudio = new Map();
  const out = [];
  const retirees = new Set();
  Object.entries(songs ?? {}).forEach(([id, s]) => {
    if (!s?.title || !HEX.test(s.audioId ?? "")) return;
    if (s.retiree === true) { retirees.add(s.audioId); return; }
    const song = {
      id, title: s.title, artist: s.artist ?? "", imageId: HEX.test(s.imageId ?? "") ? s.imageId : null,
      audioId: s.audioId, refrainId: HEX.test(s.refrainId ?? "") ? s.refrainId : null, buzz: buzzOf(s.buzz),
      start: bounded(s.start, 0, 3600, 0), refrain: bounded(s.refrain, 0, 3600, null), length: bounded(s.length, 0, 7200, null),
      rights: s.rights ?? "", lists: [],
      // Paroles (fichier .lrc rangé dans library/lyrics) et celles de l'extrait du refrain ; moments pas encore réglés.
      lrc: s.lrc === true, paroles: typeof s.paroles === "string" ? s.paroles : "", auto: s.auto === true,
    };
    byAudio.set(s.audioId, song);
    out.push(song);
  });
  Object.entries(playlists ?? {}).forEach(([pid, p]) => {
    if (!p || isStatuesList(p)) return;
    listOf(p.tracks).forEach((t) => {
      if (!t?.title?.trim() || !HEX.test(t.audioId ?? "")) return;
      let song = (t.songId && songs?.[t.songId] ? out.find((x) => x.id === t.songId) : null) ?? byAudio.get(t.audioId);
      // Pas dans la bibliothèque : une chanson retirée, une chanson effacée pour de bon (le morceau garde son numéro,
      // voir [marquerEffacees]) ou une comptine des prestations de test (cedric, 22/10 : ce ne sont pas ses chansons).
      if (!song && (retirees.has(t.audioId) || t.songId || PLAYLIST_TEST.test(pid))) return;
      if (!song) {
        song = {
          id: null, title: t.title.trim(), artist: t.artist ?? "", imageId: HEX.test(t.imageId ?? "") ? t.imageId : null,
          audioId: t.audioId, refrainId: HEX.test(t.refrainId ?? "") ? t.refrainId : null, buzz: buzzOf(t.duration ?? p.duration),
          start: 0, refrain: null, length: null, rights: t.rights ?? "", lists: [],
          lrc: false, paroles: typeof t.paroles === "string" ? t.paroles : "", auto: false,
        };
        byAudio.set(t.audioId, song);
        out.push(song);
      }
      if (p.title && !song.lists.some((l) => l.id === pid)) song.lists.push({ id: pid, title: p.title });
    });
  });
  return out.sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

/** Playlists des prestations de test (Paramètres) : leurs comptines n'entrent pas dans la bibliothèque des sons. */
const PLAYLIST_TEST = /^test-/;

/**
 * Chanson [songId] effacée pour de bon : les anciens morceaux des playlists qui ont son extrait [audioId] sans dire de
 * quelle chanson ils viennent reçoivent son numéro, pour qu'elle ne revienne pas dans la bibliothèque. Les morceaux et
 * leurs extraits restent dans les playlists. Rend les chemins à écrire, avec la date [stamp] de chaque playlist touchée.
 */
export function marquerEffacees(songId, audioId, playlists, stamp, isStatuesList = (p) => p?.use === "statues") {
  const out = {};
  Object.entries(playlists ?? {}).forEach(([pid, p]) => {
    if (!p || isStatuesList(p)) return;
    Object.entries(Array.isArray(p.tracks) ? { ...p.tracks } : p.tracks ?? {}).forEach(([i, t]) => {
      if (t?.audioId !== audioId || t.songId) return;
      out[`library/playlists/${pid}/tracks/${i}/songId`] = songId;
      out[`library/playlists/${pid}/updatedAt`] = stamp;
    });
  });
  return out;
}

/** Chansons retirées de la bibliothèque, triées par titre : { id, title, artist }, pour les remettre. */
export function songsRetirees(songs) {
  return Object.entries(songs ?? {})
    .filter(([, s]) => s?.retiree === true && s.title && HEX.test(s.audioId ?? ""))
    .map(([id, s]) => ({ id, title: s.title, artist: s.artist ?? "", lists: [] }))
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

/** La recherche de Sarah : chaque mot doit se trouver dans le titre, l'artiste ou le nom d'une playlist. */
export function songMatches(song, query) {
  const words = sansAccent(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = sansAccent([song.title, song.artist, ...song.lists.map((l) => l.title)].join(" "));
  return words.every((w) => hay.includes(w));
}

/** Morceau de playlist tiré d'une chanson de la bibliothèque : mêmes extraits, mêmes réglages. */
export function trackFromSong(song) {
  return {
    title: song.title.trim().slice(0, 80), audioId: song.audioId,
    ...(song.artist?.trim() ? { artist: song.artist.trim().slice(0, 80) } : {}),
    ...(song.rights?.trim() ? { rights: song.rights.trim().slice(0, 120) } : {}),
    ...(HEX.test(song.imageId ?? "") ? { imageId: song.imageId } : {}),
    ...(HEX.test(song.refrainId ?? "") ? { refrainId: song.refrainId } : {}),
    // Paroles du refrain (forme courte de la TV) : seulement avec l'extrait du refrain.
    ...(HEX.test(song.refrainId ?? "") && typeof song.paroles === "string" && song.paroles && song.paroles.length <= 8000 ? { paroles: song.paroles } : {}),
    ...(song.id ? { songId: song.id } : {}),
    duration: buzzOf(song.buzz),
  };
}

/**
 * Réglages d'une chanson changés dans la bibliothèque : les morceaux des playlists qui la reprennent suivent
 * (extraits, refrain, temps pour buzzer, titre), ainsi que les anciens morceaux sans chanson dont l'extrait est dans
 * [audioIds]. Les listes des statues ne changent pas. Rend les chemins à écrire,
 * { "library/playlists/<id>/tracks/<i>": track }, avec la date [stamp] de chaque playlist touchée.
 */
export function songUpdates(songId, song, playlists, stamp, audioIds = [], isStatuesList = (p) => p?.use === "statues") {
  const out = {};
  Object.entries(playlists ?? {}).forEach(([pid, p]) => {
    if (!p || isStatuesList(p)) return;
    const tracks = p.tracks;
    Object.entries(Array.isArray(tracks) ? { ...tracks } : tracks ?? {}).forEach(([i, t]) => {
      // La chanson elle-même, ou un ancien morceau (d'avant la bibliothèque) qui avait le même extrait.
      if (!t || (t.songId !== songId && (t.songId || !audioIds.includes(t.audioId)))) return;
      const { points } = t;
      out[`library/playlists/${pid}/tracks/${i}`] = { ...trackFromSong({ ...song, id: songId }), ...(Number.isInteger(points) ? { points } : {}) };
      // Les règles demandent la date de mise à jour de la playlist à chaque écriture.
      out[`library/playlists/${pid}/updatedAt`] = stamp;
    });
  });
  return out;
}
