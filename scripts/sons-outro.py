#!/usr/bin/env python3
"""Outro du robot : cherche des sons libres (CC0 uniquement) via l'API Openverse
(Freesound, Wikimedia Commons…) et les range dans <dossier>/<theme>/<n>-<id>.<ext> + sources.json.
Ne publie rien sur le site ni sur la TV."""
import json, os, re, sys, urllib.parse, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "sons"
UA = {"User-Agent": "little-miss-party-quiz/outro (github actions)"}
PAR_THEME = 6
MAX_OCTETS = 20_000_000
THEMES = {
    "robot-bips": ["robot beeps", "droid chatter", "robot voice beeps", "r2d2 style"],
    "robot-moteurs": ["servo motor", "robot movement servo", "small motor whir"],
    "nappe-hangar": ["room tone hangar", "industrial ambience drone", "large hall ambience", "dark ambient drone low"],
    "porte-hangar": ["hangar door", "metal garage door", "large metal door opening"],
    "neons": ["fluorescent light turn on", "neon light flicker buzz", "light switch large"],
    "pas-metal": ["footsteps metal walkway", "metal stairs footsteps"],
    "boutons": ["button click sci-fi", "control panel beeps", "switch click"],
    "trappe-sas": ["airlock door", "sci-fi door hiss", "hydraulic hiss"],
    "fusee-moteur": ["rocket engine ignition", "jet engine startup", "rocket launch rumble"],
    "decollage": ["rocket launch", "spaceship takeoff", "whoosh fly away"],
    "valise": ["suitcase close latch", "suitcase zipper"],
}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()

sources, deja = [], set()
for theme, requetes in THEMES.items():
    os.makedirs(f"{OUT}/{theme}", exist_ok=True)
    n = 0
    for q in requetes:
        if n >= PAR_THEME:
            break
        api = "https://api.openverse.org/v1/audio/?" + urllib.parse.urlencode({"q": q, "license": "cc0", "page_size": 10})
        try:
            res = json.loads(get(api))["results"]
        except Exception as e:
            print("ERREUR recherche", q, e); continue
        for r in res:
            if n >= PAR_THEME or r["id"] in deja or not r.get("url"):
                continue
            ext = (r.get("filetype") or os.path.splitext(urllib.parse.urlparse(r["url"]).path)[1].lstrip(".") or "mp3").lower()
            try:
                data = get(r["url"])
            except Exception as e:
                print("ERREUR fichier", r["url"], e); continue
            if len(data) > MAX_OCTETS or len(data) < 2000:
                continue
            deja.add(r["id"]); n += 1
            nom = f"{n}-{re.sub(r'[^a-z0-9]+', '-', (r.get('title') or 'son').lower())[:40].strip('-')}.{ext}"
            open(f"{OUT}/{theme}/{nom}", "wb").write(data)
            sources.append({"theme": theme, "fichier": f"{theme}/{nom}", "titre": r.get("title"), "auteur": r.get("creator"),
                            "licence": f"{r.get('license')} {r.get('license_version') or ''}".strip(), "source": r.get("source"),
                            "page": r.get("foreign_landing_url"), "duree_ms": r.get("duration"), "requete": q})
            print(theme, nom, len(data))
json.dump(sources, open(f"{OUT}/sources.json", "w"), ensure_ascii=False, indent=1)
print(len(sources), "sons")
