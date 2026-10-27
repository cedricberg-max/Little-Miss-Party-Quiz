#!/usr/bin/env python3
"""Outro du robot : récupère des sons libres (CC0 / domaine public uniquement) et les range dans
<dossier>/kenney/<pack>/… (packs Kenney, CC0) et <dossier>/commons/<theme>/… (Wikimedia Commons) + sources.json.
(Openverse ne répond pas depuis les machines GitHub.) Ne publie rien sur le site ni sur la TV."""
import io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile

OUT = sys.argv[1] if len(sys.argv) > 1 else "sons"
UA = {"User-Agent": "little-miss-party-quiz-outro/1.0 (https://github.com/cedricberg-max/little-miss-party-quiz)"}
FIN = time.time() + 13 * 60
KENNEY = ["sci-fi-sounds", "interface-sounds", "impact-sounds", "digital-audio", "ui-audio"]
THEMES = {
    "robot": ["robot sound", "beep sound effect", "servo motor"],
    "hangar": ["industrial ambience", "room tone", "metal door", "garage door"],
    "neons": ["fluorescent lamp", "electrical hum", "light switch"],
    "fusee": ["rocket launch", "rocket engine", "jet engine", "space shuttle launch"],
    "divers": ["footsteps metal", "airlock", "pneumatic", "suitcase", "whoosh"],
}
LIBRE = re.compile(r"cc0|public domain|pd-", re.I)

def get(url, t=40):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t) as r:
        return r.read()

sources = []
def note(**k):
    sources.append(k); json.dump(sources, open(f"{OUT}/sources.json", "w"), ensure_ascii=False, indent=1)
os.makedirs(OUT, exist_ok=True)

for pack in KENNEY:
    page = f"https://kenney.nl/assets/{pack}"
    try:
        html = get(page).decode("utf-8", "replace")
        m = re.search(r'href="([^"]+\.zip)"', html)
        if not m:
            print("pas de zip", pack, flush=True); continue
        z = zipfile.ZipFile(io.BytesIO(get(urllib.parse.urljoin(page, m.group(1)), 120)))
        n = 0
        for nom in z.namelist():
            if nom.lower().endswith((".ogg", ".wav", ".mp3")):
                cible = f"{OUT}/kenney/{pack}/{os.path.basename(nom)}"
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                open(cible, "wb").write(z.read(nom)); n += 1
        note(fichier=f"kenney/{pack}/", titre=pack, auteur="Kenney (kenney.nl)", licence="CC0", page=page, nb=n)
        print("kenney", pack, n, flush=True)
    except Exception as e:
        print("ERREUR kenney", pack, e, flush=True)

API = "https://commons.wikimedia.org/w/api.php?"
for theme, requetes in THEMES.items():
    os.makedirs(f"{OUT}/commons/{theme}", exist_ok=True)
    for q in requetes:
        if time.time() > FIN:
            break
        p = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 12,
             "gsrsearch": f"{q} filemime:audio/ogg|audio/x-wav|audio/wav|audio/mpeg|audio/flac",
             "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime"}
        try:
            pages = json.loads(get(API + urllib.parse.urlencode(p))).get("query", {}).get("pages", {})
        except Exception as e:
            print("ERREUR commons", q, e, flush=True); continue
        for pg in pages.values():
            ii = (pg.get("imageinfo") or [{}])[0]; md = ii.get("extmetadata", {})
            lic = md.get("LicenseShortName", {}).get("value", "")
            if not LIBRE.search(lic) or ii.get("size", 0) > 25_000_000 or not ii.get("url"):
                continue
            nom = re.sub(r"[^A-Za-z0-9._-]+", "_", pg["title"].split(":", 1)[1])[:80]
            cible = f"{OUT}/commons/{theme}/{nom}"
            if os.path.exists(cible):
                continue
            try:
                open(cible, "wb").write(get(ii["url"], 60))
            except Exception as e:
                print("ERREUR fichier", nom, e, flush=True); continue
            auteur = re.sub("<[^>]+>", "", md.get("Artist", {}).get("value", ""))[:80]
            note(fichier=f"commons/{theme}/{nom}", titre=pg["title"], auteur=auteur, licence=lic,
                 page=ii.get("descriptionurl"), requete=q)
            print("commons", theme, nom, lic, flush=True)
print(len(sources), "entrées")
