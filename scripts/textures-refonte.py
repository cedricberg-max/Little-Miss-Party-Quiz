"""Télécharge des matières PBR libres (CC0) pour la refonte 3D du Game Show (plateau, enceintes, coffres) : ambientCG et Poly Haven.
Résultat dans le dossier donné : <source>-<id>/{couleur,normale,rugosite,metal,ao}.jpg + sources.json.
Utilisé par .github/workflows/textures-refonte.yml (le conteneur de Claude n'a pas accès à ces sites)."""
import io, json, os, sys, urllib.parse, urllib.request, zipfile

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "little-miss-party-quiz/1.0 (textures CC0)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()

# ambientCG : recherches, on garde les 3 premiers résultats de chacune, en 2K pour des détails nets en full HD
RECHERCHES = ["leather", "fabric", "speaker grille", "wood planks", "painted wood", "gold", "brushed metal", "scratched metal",
              "tiles", "marble", "plastic", "carbon fiber", "rubber", "chipped paint", "metal plates"]
sources = []
vus = set()
for q in RECHERCHES:
    try:
        data = json.loads(get("https://ambientcg.com/api/v2/full_json?type=Material&limit=3&sort=Popular&include=downloadData&q=" + urllib.parse.quote(q)))
    except Exception as e:
        print("ambientCG recherche", q, "->", e); continue
    for a in data.get("foundAssets", []):
        aid = a["assetId"]
        if aid in vus: continue
        vus.add(aid)
        lien = None
        for cat in a.get("downloadFolders", {}).get("default", {}).get("downloadFiletypeCategories", {}).values():
            for d in cat.get("downloads", []):
                if d.get("attribute") == "2K-JPG": lien = d.get("downloadLink") or d.get("fullDownloadPath")
        if not lien: print("pas de 2K-JPG pour", aid); continue
        try:
            z = zipfile.ZipFile(io.BytesIO(get(lien)))
        except Exception as e:
            print("zip", aid, "->", e); continue
        dos = os.path.join(OUT, "acg-" + aid); os.makedirs(dos, exist_ok=True)
        garde = {"_Color.": "couleur", "_NormalGL.": "normale", "_Roughness.": "rugosite", "_Metalness.": "metal", "_AmbientOcclusion.": "ao"}
        for n in z.namelist():
            for k, v in garde.items():
                if k in n and n.lower().endswith(".jpg"):
                    open(os.path.join(dos, v + ".jpg"), "wb").write(z.read(n))
        sources.append({"source": "ambientCG", "id": aid, "recherche": q, "licence": "CC0", "page": "https://ambientcg.com/view?id=" + aid})
        print("ok ambientCG", aid)

# Poly Haven : quelques matières par catégorie, plus une image d'environnement (studio) pour les reflets
for cat in ["wood", "fabric", "plaster-concrete", "terrain"][:3]:
    try:
        assets = json.loads(get("https://api.polyhaven.com/assets?t=textures&c=" + cat))
    except Exception as e:
        print("polyhaven", cat, "->", e); continue
    noms = sorted(assets, key=lambda k: -assets[k].get("download_count", 0))[:4]
    for aid in noms:
        if aid in vus: continue
        vus.add(aid)
        try:
            f = json.loads(get("https://api.polyhaven.com/files/" + aid))
        except Exception as e:
            print("polyhaven files", aid, "->", e); continue
        dos = os.path.join(OUT, "ph-" + aid); os.makedirs(dos, exist_ok=True)
        for cle, nom in [("Diffuse", "couleur"), ("nor_gl", "normale"), ("Rough", "rugosite"), ("Metal", "metal"), ("AO", "ao")]:
            try:
                open(os.path.join(dos, nom + ".jpg"), "wb").write(get(f[cle]["2k"]["jpg"]["url"]))
            except Exception:
                pass
        sources.append({"source": "Poly Haven", "id": aid, "categorie": cat, "licence": "CC0", "page": "https://polyhaven.com/a/" + aid})
        print("ok polyhaven", aid)
for aid in ["studio_small_09", "studio_small_03", "brown_photostudio_02"]:
    try:
        f = json.loads(get("https://api.polyhaven.com/files/" + aid))
        os.makedirs(os.path.join(OUT, "hdri"), exist_ok=True)
        open(os.path.join(OUT, "hdri", aid + "_1k.hdr"), "wb").write(get(f["hdri"]["1k"]["hdr"]["url"]))
        sources.append({"source": "Poly Haven", "id": aid, "type": "hdri", "licence": "CC0", "page": "https://polyhaven.com/a/" + aid})
        print("ok hdri", aid)
    except Exception as e:
        print("hdri", aid, "->", e)

json.dump(sources, open(os.path.join(OUT, "sources.json"), "w"), ensure_ascii=False, indent=1)
print(len(sources), "matières")
