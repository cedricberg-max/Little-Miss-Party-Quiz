// Outil de test « équipes fantômes » (cedric, 26/10) : de 1 à 7 tablettes simulées, sur l'ordinateur, entrent dans une
// vraie partie et jouent toutes seules (réponses, buzz, mini-jeux), pour tester à 4 ou 5 équipes avec une seule vraie
// tablette. Chaque fantôme est un vrai pupitre : son propre identifiant anonyme, les mêmes écritures que app.js, donc
// les mêmes règles de la base et la même box. Rien d'autre que la partie dont on a tapé le code n'est touché.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, signInAnonymously, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, push, onValue, onDisconnect, serverTimestamp, connectDatabaseEmulator, goOffline, goOnline,
  query, orderByKey, limitToLast,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { SIMON_COULEURS, SIMON_CHIFFRES } from "./simon.js";
import { envoyeurDessin } from "./picto.js";
import { plafond, ENVOI_MS } from "./gonfleur.js";
import { writeProof } from "./proof.js";
import { passwordCandidates } from "./secret.js";
import { numeroTablette, MAX_TEAMS } from "./theme.js";
import { afficherMotsDePasse } from "./oeil.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Tests automatiques uniquement : l'émulateur Firebase n'est accepté que depuis l'ordinateur de test.
const emulator = params.has("emu") && ["localhost", "127.0.0.1"].includes(location.hostname);

const BUZZ_KINDS = ["flou", "chante", "quisuis", "blind", "disparu"];
const NOMS = ["Fantôme 1", "Fantôme 2", "Fantôme 3", "Fantôme 4", "Fantôme 5", "Fantôme 6", "Fantôme 7"];
const VITESSES = { lente: 1.8, normale: 1, rapide: 0.45 };

const hasard = (min, max) => min + Math.random() * (max - min);
const auHasard = (liste) => liste[Math.floor(Math.random() * liste.length)];
const liste = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let config = null;
async function lireConfig() {
  config ??= await (await fetch("firebase-config.json", { cache: "no-store" })).json();
  return config;
}

/** Une connexion Firebase à part (son propre identifiant anonyme, gardé par le navigateur sous ce nom). */
const connexions = new Map();
async function connexion(nom) {
  if (connexions.has(nom)) {
    const c = await connexions.get(nom);
    goOnline(c.db);
    return c;
  }
  const c = ouvrirConnexion(nom);
  connexions.set(nom, c);
  c.catch(() => connexions.delete(nom));
  return c;
}
async function ouvrirConnexion(nom) {
  const app = initializeApp(await lireConfig(), nom);
  const auth = getAuth(app);
  const db = getDatabase(app);
  if (emulator) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }
  const uid = (await signInAnonymously(auth)).user.uid;
  return { db, uid };
}

const reglages = { vitesse: 1, buzz: true };

// ---------- Journal de la page ----------

function journal(texte) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString("fr-FR")} · ${texte}`;
  $("journal").prepend(li);
  while ($("journal").children.length > 200) $("journal").lastChild.remove();
}

// ---------- Un fantôme = une tablette ----------

class Fantome {
  constructor(i) {
    this.i = i;
    this.nom = NOMS[i];
    this.code = null;
    this.teamId = null;
    this.state = null;
    this.teams = {};
    this.offset = 0;
    this.coupe = false;
    this.ecoutes = [];
    this.minuteries = new Map();
    this.faits = new Set();
    this.dessin = null;
    this.gonfleur = null;
    // Duel ou Simon en attente du journal de la box ; la bonne suite du Simon vue au dernier bilan.
    this.attente = null;
    this.simonVu = null;
    this.statut = "connexion…";
    this.ligne = null;
  }

  async demarrer(code) {
    if (!this.db) Object.assign(this, await connexion(`fantome-${this.i + 1}`));
    this.code = code;
    this.arreterEcoutes();
    const g = (p) => get(ref(this.db, `games/${code}/${p}`)).then((s) => s.val());
    if (!await g("hostUid")) return this.maj("partie introuvable");
    const teams = (await g("teams")) ?? {};
    const mine = this.monEquipe(teams);
    if (mine) { this.teamId = mine; return this.jouer(); }
    if ((await g("state/phase")) === "ended") return this.maj("partie terminée");
    if (Object.keys(teams).length >= MAX_TEAMS) return this.maj("partie complète");
    this.maj("attend la régie…");
    let demande = false;
    this.ecouter("regieActive", (s) => {
      if (s.val() !== true || demande) return;
      demande = true;
      set(ref(this.db, `games/${code}/joinRequests/${this.uid}`), { at: serverTimestamp() })
        .then(() => this.attendreEntree())
        .catch(() => this.maj("demande refusée"));
    });
  }

  monEquipe(teams) {
    return Object.keys(teams).find((t) => teams[t]?.device === this.uid) ?? (teams[this.uid] ? this.uid : null);
  }

  attendreEntree() {
    this.arreterEcoutes();
    this.maj(`en attente · Tablette ${numeroTablette(this.uid)}`);
    entrees.demander(this);
    this.ecouter("teams", (s) => {
      const mine = this.monEquipe(s.val() ?? {});
      if (!mine || this.teamId) return;
      this.teamId = mine;
      setTimeout(() => this.jouer(), 0);
    });
  }

  jouer() {
    this.arreterEcoutes();
    const presence = ref(this.db, `games/${this.code}/presence/${this.teamId}`);
    this.ecouter(".info/serverTimeOffset", (s) => { this.offset = s.val() ?? 0; }, true);
    this.ecouter(".info/connected", (s) => {
      if (s.val() !== true) return;
      onDisconnect(presence).set({ online: false, at: serverTimestamp() })
        .then(() => set(presence, { online: true, at: serverTimestamp(), awake: true }))
        .catch(() => {});
    }, true);
    this.ecouter("teams", (s) => {
      this.teams = s.val() ?? {};
      const moi = this.teams[this.teamId];
      if (!moi) { this.teamId = null; return this.maj("équipe retirée"); }
      if ((moi.device ?? this.teamId) !== this.uid) return this.maj("remplacé par un autre appareil");
      this.reagir();
    });
    this.ecouter("state", (s) => {
      this.state = s.val();
      const suite = this.state?.suite;
      // « 🏁 Fin de la fête » : la TV ouvre une nouvelle partie, les fantômes la suivent comme les tablettes.
      if (typeof suite === "string" && /^[A-Z0-9]{4,8}$/.test(suite) && suite !== this.code) {
        this.teamId = null;
        journal(`${this.nom} suit la nouvelle partie ${suite}`);
        $("code").value = suite;
        return this.demarrer(suite);
      }
      this.reagir();
    });
  }

  ecouter(chemin, fn, brut = false) {
    this.ecoutes.push(onValue(ref(this.db, brut ? chemin : `games/${this.code}/${chemin}`), fn));
  }

  arreterEcoutes() {
    this.ecoutes.forEach((u) => u());
    this.ecoutes = [];
    this.annuler();
  }

  /** Annule les actions prévues, sauf celles dont la clé est dans [garder]. */
  annuler(garder = new Set()) {
    for (const [cle, h] of this.minuteries) {
      if (garder.has(cle)) continue;
      clearTimeout(h);
      this.minuteries.delete(cle);
    }
    if (!garder.has("gonfleur") && this.gonfleur) { clearInterval(this.gonfleur.h); this.gonfleur = null; }
    if (![...garder].some((c) => c.startsWith("dessin:")) && this.dessin) { clearInterval(this.dessin.h); this.dessin = null; }
    if (this.attente && !garder.has(this.attente)) this.attente = null;
  }

  /** Action [cle] dans [ms] (une seule fois). Refusée par la base : elle pourra être retentée à l'état suivant. */
  prevoir(cle, ms, action) {
    if (this.faits.has(cle) || this.minuteries.has(cle)) return;
    this.minuteries.set(cle, setTimeout(async () => {
      try {
        await action();
        this.faits.add(cle);
      } catch {
        // Trop tard, pause, autre équipe plus rapide : normal, la box a décidé.
      }
      this.minuteries.delete(cle);
    }, Math.max(0, ms)));
  }

  maintenant() { return Date.now() + this.offset; }

  ecrire(chemin, valeur) { return set(ref(this.db, `games/${this.code}/${chemin}`), valeur); }

  /** Ce que ferait une équipe devant sa tablette, selon l'état de la partie. */
  reagir() {
    const st = this.state ?? { phase: "lobby" };
    const actives = new Set();
    const v = reglages.vitesse;
    const now = this.maintenant();
    const attente = Math.max(0, (st.resumeAt ?? 0) - now);
    const libre = !st.paused && !this.coupe;
    this.maj(`${st.kind ?? ""} · ${st.phase ?? "lobby"}${st.paused ? " · pause" : ""}`.replace(/^ · /, ""));
    if (libre && ["question", "closed"].includes(st.phase)) {
      if (st.kind === "gonfleur") this.gonfler(st, actives);
      else if (st.kind === "patate") this.patate(st, actives, now, attente);
      else if (st.kind === "coffres") this.coffre(st, actives, now, attente);
      else if (st.mime && st.kind === "pictionary") this.picto(st, actives);
      else if (st.kind === "duel") this.duel(st, actives);
      else if (st.kind === "simon") this.simon(st, actives, now);
      else if (st.kind === "chrono") this.chrono(st, actives);
      else if (BUZZ_KINDS.includes(st.kind)) this.buzzer(st, actives, now, attente);
      else if (st.phase === "question" && !st.mime && st.kind !== "statues") this.repondre(st, actives, now, attente, v);
    }
    this.annuler(actives);
  }

  repondre(st, actives, now, attente, v) {
    const cle = `rep:${st.qid}`;
    if (!st.qid || this.faits.has(cle)) return;
    actives.add(cle);
    // Une équipe sur vingt ne répond pas (enfants distraits).
    if (Math.random() < 0.05 && !this.minuteries.has(cle)) { this.faits.add(cle); return journal(`${this.nom} ne répond pas`); }
    const reste = st.kind === "portes" ? 12000 : Math.max(1500, (st.deadline ?? now + 15000) - now - attente);
    const ms = attente + Math.min(reste * 0.85, hasard(1200, Math.min(9000, reste * 0.7)) * v);
    const n = liste(st.choices).length || 4;
    const choix = st.kind === "number" ? Math.round(hasard(1, 100)) : Math.floor(Math.random() * n);
    this.prevoir(cle, ms, async () => {
      await this.ecrire(`answers/${st.qid}/${this.teamId}`, { choice: choix, at: serverTimestamp() });
      journal(`${this.nom} répond ${st.kind === "number" ? choix : "ABCD"[choix] ?? choix}`);
    });
  }

  buzzer(st, actives, now, attente) {
    if (!reglages.buzz || st.phase !== "question" || st.buzzOpen !== true) return;
    if (st.kind === "blind" && st.blind?.waiting) return;
    const b = st.buzz ?? {};
    if (b.team) return;
    const essaye = liste(b.blocked).includes(this.teamId);
    const rebuzz = essaye && typeof b.rebuzzAt === "number" ? b.rebuzzAt + 300 - now : null;
    if (essaye && rebuzz == null) return;
    const cle = `buzz:${st.round}:${essaye ? b.rebuzzAt : 0}`;
    actives.add(cle);
    // Pas toujours : parfois personne ne trouve, et la vraie tablette a sa chance.
    if (!this.minuteries.has(cle) && !this.faits.has(cle) && Math.random() < 0.3) { this.faits.add(cle); return; }
    const ms = Math.max(attente, rebuzz ?? 0) + hasard(1500, 8000) * reglages.vitesse;
    this.prevoir(cle, ms, async () => {
      await this.ecrire(`buzz/${st.round}`, { team: this.teamId, at: serverTimestamp() });
      journal(`${this.nom} BUZZE`);
    });
  }

  gonfler(st, actives) {
    const p = st.pump;
    if (st.phase !== "question" || !p?.key) return;
    actives.add("gonfleur");
    if (this.gonfleur?.cle === p.key) return;
    if (this.gonfleur) clearInterval(this.gonfleur.h);
    const g = { cle: p.key, n: 0, envoye: 0, envoi: false, rythme: hasard(5, 11) / reglages.vitesse, dernier: 0 };
    g.h = setInterval(async () => {
      const s = this.state;
      const now = this.maintenant();
      const cible = s?.pump?.target ?? 100;
      if (!s || s.paused || this.coupe || s.pump?.key !== g.cle || now < (s.pump.goAt ?? 0) || now < (s.resumeAt ?? 0)) return;
      g.n = Math.min(cible, g.n + g.rythme / 10);
      if (g.envoi || Date.now() - g.dernier < ENVOI_MS) return;
      const n = Math.min(Math.floor(g.n), plafond(s.pump.goAt ?? 0, now));
      if (n <= g.envoye) return;
      g.envoi = true;
      g.dernier = Date.now();
      try {
        await this.ecrire(`pumps/${g.cle}/${this.teamId}`, { n, at: serverTimestamp() });
        g.envoye = n;
        if (n >= cible) { journal(`${this.nom} fait éclater son ballon`); clearInterval(g.h); }
      } catch { /* pause, fin de la course */ }
      g.envoi = false;
    }, 100);
    this.gonfleur = g;
  }

  patate(st, actives, now, attente) {
    const p = st.potato ?? {};
    if (st.phase !== "question" || p.lit !== true || p.exploded === true || p.holder !== this.teamId || !p.key) return;
    const cle = `patate:${p.key}`;
    actives.add(cle);
    const pret = Math.max(0, (p.readyAt ?? 0) + 200 - now, attente);
    // Une fois sur dix, la bombe reste trop longtemps (gardée plus de 2 s, elle explose chez le fantôme) ; sinon elle
    // repart avant les 2 s, comme une équipe qui joue le jeu (règle du 27/10).
    const garde = !this.minuteries.has(cle) && Math.random() < 0.1 ? 4500 : Math.min(1700, hasard(300, 1500) * reglages.vitesse);
    const cibles = liste(p.targets).filter((id) => id !== this.teamId && this.teams[id]);
    const autres = cibles.length ? cibles : liste(p.teams).filter((id) => id !== this.teamId && id !== p.from && this.teams[id]);
    if (!autres.length) return;
    this.prevoir(cle, pret + garde, async () => {
      const to = auHasard(autres);
      await this.ecrire(`potatoPass/${p.key}`, { to, at: serverTimestamp() });
      journal(`${this.nom} envoie la bombe à ${this.teams[to]?.name ?? "une équipe"}`);
    });
  }

  coffre(st, actives, now, attente) {
    const c = st.chests ?? {};
    if (st.phase !== "question" || c.team !== this.teamId || c.ready !== true || !c.key) return;
    const cle = `coffre:${c.key}`;
    actives.add(cle);
    const ouverts = new Set(liste(c.opened).map((o) => o.chest));
    const libres = [...Array(c.count ?? 0).keys()].filter((i) => !ouverts.has(i));
    if (!libres.length) return;
    const ms = Math.max(attente, (c.readyAt ?? 0) + 300 - now) + hasard(1500, 4000) * reglages.vitesse;
    this.prevoir(cle, ms, async () => {
      const i = auHasard(libres);
      await this.ecrire(`chestChoice/${c.key}`, { i, at: serverTimestamp() });
      journal(`${this.nom} ouvre le coffre ${i + 1}`);
    });
  }

  /**
   * 🤠 Duel des robots : le fantôme du duel buzze peu après le PAN, comme un enfant qui regarde la TV ; une fois sur
   * huit trop tôt. L'heure du PAN est secrète : seule la page ouverte avec le mot de passe régie la lit dans le journal
   * de la box (comme le téléphone) ; sans lui, le fantôme tente sa chance entre 22 et 38 s.
   */
  duel(st, actives) {
    const d = st.duel ?? {};
    if (!reglages.buzz || st.phase !== "question" || d.step !== "standoff" || !d.key || !liste(d.teams).includes(this.teamId)) return;
    const cle = `duel:${d.key}`;
    actives.add(cle);
    if (this.faits.has(cle) || this.minuteries.has(cle) || this.attente === cle) return;
    this.attente = cle;
    const vu = this.maintenant();
    journalRegie(this.code, "duel_start").then((e) => {
      if (this.attente !== cle) return;
      this.attente = null;
      const pan = typeof e?.panAt === "number" && e.panAt > vu - 60_000 ? e.panAt : null;
      const tropTot = Math.random() < 0.125;
      const quand = tropTot ? (pan ?? vu + 20_000) - hasard(1500, 6000)
        : (pan ?? vu + hasard(22_000, 38_000)) + hasard(250, 900) * reglages.vitesse;
      this.prevoir(cle, quand - this.maintenant(), async () => {
        await this.ecrire(`duel/${d.key}/${this.teamId}`, { t: this.maintenant(), at: serverTimestamp() });
        journal(`${this.nom} tire au duel${pan != null && this.maintenant() < pan ? " (trop tôt !)" : ""}`);
      });
    });
  }

  /**
   * ⏱️ Chrono de Buzzy : le fantôme compte dans sa tête comme un enfant, à environ ±2 s de la cible (une fois sur dix à
   * ±5 s, et une fois sur vingt il oublie de buzzer). L'heure du 0 est publiée : il buzze à 0 + cible + son erreur.
   */
  chrono(st, actives) {
    const c = st.chrono ?? {};
    if (!reglages.buzz || st.phase !== "question" || c.step !== "run" || !c.key || typeof c.goAt !== "number" || !liste(c.teams).includes(this.teamId)) return;
    const cle = `chrono:${c.key}`;
    actives.add(cle);
    if (this.faits.has(cle) || this.minuteries.has(cle)) return;
    if (Math.random() < 0.05) { this.faits.add(cle); return journal(`${this.nom} oublie de buzzer au chrono`); }
    const erreur = (Math.random() < 0.1 ? hasard(-5000, 5000) : hasard(-2000, 2000)) * reglages.vitesse;
    const quand = c.goAt + (c.cible ?? 30) * 1000 + erreur;
    this.prevoir(cle, quand - this.maintenant(), async () => {
      await this.ecrire(`chrono/${c.key}/${this.teamId}`, { t: this.maintenant(), at: serverTimestamp() });
      journal(`${this.nom} buzze au chrono (${erreur >= 0 ? "+" : ""}${(erreur / 1000).toFixed(1)} s)`);
    });
  }

  /**
   * 🔴 Simon de Buzzy : le joueur fantôme du tour tape la suite, élément par élément (la TV les montre en direct), puis
   * valide avant la fin du chrono ; une fois sur dix il se trompe d'un élément. La suite est secrète : avec le mot de
   * passe régie, la page la lit dans le journal de la box (elle y est dès le début du tour) ; sans lui, le fantôme se
   * souvient de la bonne suite montrée au bilan d'avant et devine le reste.
   */
  simon(st, actives, now) {
    const sm = st.simon ?? {};
    if (sm.verdict?.solution) this.simonVu = String(sm.verdict.solution).split(",");
    if (st.phase !== "question" || sm.step !== "play" || !sm.key || sm.players?.[this.teamId] == null || sm.out?.[this.teamId] != null) return;
    const cle = `simon:${sm.key}`;
    actives.add(cle);
    if (this.faits.has(cle) || this.minuteries.has(cle) || this.attente === cle) return;
    this.attente = cle;
    journalRegie(this.code, "simon_tour").then((e) => {
      if (this.attente !== cle) return;
      this.attente = null;
      const n = sm.suite ?? 0;
      const vocabulaire = [...SIMON_COULEURS.map(([c]) => c), ...(sm.chiffres ? SIMON_CHIFFRES : [])];
      const secret = e && e.tour === sm.tour && e.qid === st.qid ? String(e.sequence ?? "").split(",") : [];
      const suite = Array.from({ length: n }, (_, k) => secret[k] ?? this.simonVu?.[k] ?? auHasard(vocabulaire));
      // Comme de vrais enfants, ils se trompent de plus en plus quand la suite s'allonge (1 fois sur 10 à 1 boule,
      // 1 sur 3 à 5, 6 sur 10 à 12) : une partie avec des fantômes ne dure pas indéfiniment (cedric, 30/10).
      if (n && Math.random() < 1 - 0.92 ** Math.max(n, 1.3)) { const k = Math.floor(Math.random() * n); suite[k] = auHasard(vocabulaire.filter((x) => x !== suite[k])); }
      const debut = Math.max(sm.reponseAt ?? now, this.maintenant()) + hasard(600, 1500) * reglages.vitesse;
      const fin = (sm.finAt ?? debut + 10_000) - 400;
      const pas = Math.max(80, Math.min(hasard(350, 900) * reglages.vitesse, (fin - debut) / (n + 1)));
      this.prevoir(cle, debut - this.maintenant(), async () => {
        for (let k = 1; k <= n; k++) {
          await this.ecrire(`simon/${sm.key}/${this.teamId}`, { items: suite.slice(0, k).join(","), ok: false, at: serverTimestamp() });
          await new Promise((r) => setTimeout(r, pas));
        }
        await this.ecrire(`simon/${sm.key}/${this.teamId}`, { items: suite.join(","), ok: true, at: serverTimestamp() });
        journal(`${this.nom} valide sa suite (${n})`);
      });
    });
  }

  picto(st, actives) {
    const m = st.mime;
    if (m.secret === this.teamId && liste(m.offer).length && m.pickKey && m.chosen == null) {
      const cle = `mot:${m.pickKey}`;
      actives.add(cle);
      this.prevoir(cle, hasard(2000, 4000) * reglages.vitesse, async () => {
        const i = Math.floor(Math.random() * liste(m.offer).length);
        await this.ecrire(`pictoChoice/${m.pickKey}`, { i, at: serverTimestamp() });
        journal(`${this.nom} choisit son mot`);
      });
    }
    if (m.team === this.teamId && m.drawKey) {
      const cle = `dessin:${m.drawKey}`;
      actives.add(cle);
      if (this.dessin?.cle === m.drawKey) return;
      if (this.dessin) clearInterval(this.dessin.h);
      const envoi = envoyeurDessin(this.db, `games/${this.code}/drawing/${m.drawKey}`);
      const d = { cle: m.drawKey, n: 0 };
      d.h = setInterval(() => {
        const s = this.state;
        if (!s || s.paused || this.coupe || s.mime?.drawKey !== d.cle || d.n >= 30) return;
        envoi.trait(gribouillis(++d.n), true);
      }, 1300);
      this.dessin = d;
      journal(`${this.nom} dessine`);
    }
  }

  /** Coupe ou rebranche Internet pour ce fantôme seul (comme une tablette qui perd le wifi). */
  basculerCoupure() {
    if (!this.db) return;
    this.coupe = !this.coupe;
    if (this.coupe) { goOffline(this.db); journal(`${this.nom} perd la connexion`); } else { goOnline(this.db); journal(`${this.nom} revient`); }
    this.reagir();
  }

  arreter() {
    this.arreterEcoutes();
    if (this.db) goOffline(this.db);
    this.maj("arrêté");
  }

  maj(statut) {
    this.statut = statut;
    afficher();
  }
}

/** Un trait au hasard (rond, vague ou zigzag) sur la feuille 0..1 de l'ardoise. */
function gribouillis(n) {
  const cx = hasard(0.2, 0.8); const cy = hasard(0.2, 0.8); const r = hasard(0.05, 0.18);
  const forme = n % 3;
  const p = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    if (forme === 0) p.push(cx + r * Math.cos(t * 2 * Math.PI), cy + r * Math.sin(t * 2 * Math.PI));
    else if (forme === 1) p.push(cx - r + 2 * r * t, cy + r * 0.5 * Math.sin(t * 4 * Math.PI));
    else p.push(cx - r + 2 * r * t, cy + (k % 2 ? r : -r) * 0.4);
  }
  return { id: `f${n}`, c: n % 6, w: 1, p };
}

// ---------- Entrée automatique (mot de passe régie) ----------

/**
 * Facultatif : la page devient aussi une régie (mot de passe régie, vérifié par le serveur) et fait entrer les
 * fantômes elle-même, avec la même commande « admit » que le téléphone. Sans mot de passe, l'animatrice les accepte
 * sur son téléphone comme de vraies tablettes.
 */
const entrees = {
  regie: null,
  code: null,
  file: [],
  enCours: false,
  motDePasse: "",
  demander(f) {
    if (!this.motDePasse) return;
    this.file.push(f);
    this.traiter();
  },
  async traiter() {
    if (this.enCours) return;
    this.enCours = true;
    try {
      while (this.file.length) {
        const f = this.file.shift();
        if (f.teamId) continue;
        if (!await this.ouvrir(f.code)) { this.file = []; break; }
        const resultat = await this.admettre(f);
        journal(resultat === "applied" ? `${f.nom} entre dans la partie` : `${f.nom} pas admis (${resultat ?? "la TV ne répond pas"})`);
      }
    } finally {
      this.enCours = false;
    }
  },
  async ouvrir(code) {
    this.regie ??= await connexion("fantomes-regie");
    if (this.code === code) return true;
    const { db, uid } = this.regie;
    if ((await get(ref(db, `games/${code}/regie/${uid}`)).catch(() => null))?.exists()) { this.code = code; return true; }
    for (const mdp of passwordCandidates(this.motDePasse)) {
      const preuve = await writeProof(this.regie, "regie", mdp);
      if (preuve !== "written") { journal(`Mot de passe régie : ${preuve === "unset" ? "aucun enregistré" : "serveur occupé"}`); return false; }
      try {
        await set(ref(db, `games/${code}/regie/${uid}`), { pairedAt: serverTimestamp(), via: "password" });
        this.code = code;
        journal("Régie des fantômes ouverte : ils entrent tout seuls");
        return true;
      } catch { /* mauvais mot de passe sous cette forme : on essaie l'autre */ }
    }
    journal("Mot de passe régie refusé : acceptez les fantômes sur le téléphone");
    this.motDePasse = "";
    return false;
  },
  async admettre(f) {
    const { db, uid } = this.regie;
    const seq = (await get(ref(db, `games/${f.code}/state/seq`))).val() ?? 0;
    const cmd = push(ref(db, `games/${f.code}/commands`));
    const statut = new Promise((resolve) => {
      const fin = setTimeout(() => { stop(); resolve(null); }, 10000);
      const stop = onValue(ref(db, `games/${f.code}/commandStatus/${cmd.key}`), (s) => {
        if (!s.exists()) return;
        clearTimeout(fin);
        setTimeout(() => stop());
        resolve(s.val().reason ?? s.val().status);
      });
    });
    await set(cmd, { type: "admit", expectSeq: seq, by: uid, at: serverTimestamp(), device: f.uid, name: f.nom });
    return statut;
  },
};

/** Dernier événement [type] du journal de la box, lu par la régie des fantômes (mot de passe régie), sinon null. */
async function journalRegie(code, type) {
  if (!entrees.regie || entrees.code !== code) return null;
  const s = await get(query(ref(entrees.regie.db, `games/${code}/log`), orderByKey(), limitToLast(60))).catch(() => null);
  return liste(s?.val()).filter((e) => e?.type === type).at(-1) ?? null;
}

// ---------- La page ----------

let fantomes = [];

function afficher() {
  const corps = $("fantomes");
  corps.replaceChildren(...fantomes.map((f) => {
    const tr = document.createElement("tr");
    const equipe = f.teamId ? f.teams[f.teamId] : null;
    const pastille = document.createElement("td");
    pastille.innerHTML = `<span class="pastille" style="background:${equipe?.color ?? "#555"}"></span>`;
    const nom = document.createElement("td");
    nom.textContent = equipe?.name ?? f.nom;
    const statut = document.createElement("td");
    statut.textContent = f.coupe ? "📵 coupé" : f.statut;
    const action = document.createElement("td");
    const b = document.createElement("button");
    b.textContent = f.coupe ? "Rebrancher" : "Couper le wifi";
    b.disabled = !f.teamId;
    b.onclick = () => f.basculerCoupure();
    action.append(b);
    tr.append(pastille, nom, statut, action);
    return tr;
  }));
  $("arreter").disabled = !fantomes.length;
}

async function lancer() {
  const code = $("code").value.trim().toUpperCase();
  const nombre = Number($("nombre").value);
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return alerte("Tapez le code de la partie (menu Retour de la TV, en haut).");
  $("lancer").disabled = true;
  try {
    // On montre la fête visée avant d'y envoyer qui que ce soit : jamais une autre partie par erreur.
    const sonde = await connexion("fantomes-sonde");
    const host = await get(ref(sonde.db, `games/${code}/hostUid`));
    if (!host.exists()) return alerte(`La partie ${code} n'existe pas. Vérifiez le code sur la TV.`);
    const pub = (await get(ref(sonde.db, `games/${code}/public`)).catch(() => null))?.val();
    const teams = (await get(ref(sonde.db, `games/${code}/teams`))).val() ?? {};
    const nomFete = pub?.childName ? `l'anniversaire de ${pub.childName}` : pub?.title ? `« ${pub.title} »` : `la partie ${code}`;
    if (!confirm(`Envoyer ${nombre} équipe${nombre > 1 ? "s" : ""} fantôme${nombre > 1 ? "s" : ""} dans ${nomFete} (${Object.keys(teams).length} équipe(s) déjà là) ?`)) return;
    arreterTout();
    entrees.motDePasse = $("auto").checked ? $("mdp").value : "";
    entrees.code = null;
    fantomes = [...Array(nombre).keys()].map((i) => new Fantome(i));
    afficher();
    journal(`${nombre} fantôme(s) vers la partie ${code}`);
    // Un par un, un peu espacés : comme des tablettes qui scannent le QR l'une après l'autre.
    for (const f of fantomes) {
      f.demarrer(code).catch((e) => { console.error(e); f.maj("connexion impossible"); });
      await sleep(400);
    }
  } catch (e) {
    console.error(e);
    alerte("Connexion impossible. Vérifiez Internet puis réessayez.");
  } finally {
    $("lancer").disabled = false;
  }
}

function arreterTout() {
  fantomes.forEach((f) => f.arreter());
  if (fantomes.length) journal("Fantômes arrêtés : leurs équipes passent hors ligne");
  fantomes = [];
  afficher();
}

function alerte(texte) {
  $("alerte").textContent = texte;
  $("alerte").hidden = false;
  setTimeout(() => { $("alerte").hidden = true; }, 6000);
}

$("lancer").onclick = lancer;
$("arreter").onclick = arreterTout;
$("vitesse").onchange = () => { reglages.vitesse = VITESSES[$("vitesse").value] ?? 1; };
$("buzz").onchange = () => { reglages.buzz = $("buzz").checked; fantomes.forEach((f) => f.reagir()); };
$("auto").onchange = () => { $("mdp-ligne").hidden = !$("auto").checked; };
// Petit œil sur le mot de passe régie, comme dans la Régie PC : voir ce qu'on tape (cedric, 27/10).
afficherMotsDePasse();
if (params.get("g")) $("code").value = params.get("g").toUpperCase();
// Pour les tests automatiques : les fantômes de la page.
window.fantomes = () => fantomes;
afficher();
