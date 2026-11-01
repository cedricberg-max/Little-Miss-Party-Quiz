"""Le robot prof du Simon : sépare ses pupilles (pixels cyan de l'écran-visage) du reste de l'image, pour qu'il puisse
cligner des yeux et regarder le tableau (cedric, 1/11 au soir : « il doit avoir un peu plus de vie »).

Pour chaque pose, écrit dans tv/src/main/res/drawable-nodpi :
  gs_simon_prof_<pose>_verres.webp   le visage sans les pupilles (les verres « réparés »), opaque, posé sur l'image ;
  gs_simon_prof_<pose>_pupilles.webp les deux pupilles seules, sur fond transparent.
Les deux ont la même taille et se posent au même endroit (ZONE ci-dessous, en pixels de l'image 954 × 1000).

    python3 outils/simon_prof_yeux.py
"""
import numpy as np
from PIL import Image
from scipy import ndimage

DOSSIER = "tv/src/main/res/drawable-nodpi"
# Les pupilles de chaque pose (g, h, d, b), les mêmes que PoseSimon dans SimonScreens.kt : seuls ces pixels bougent
# (pas les sourcils ni la bouche de l'écran-visage).
POSES = {
    "attend": [(310, 383, 341, 411), (389, 384, 422, 412)],
    "montre": [(310, 383, 341, 411), (388, 384, 422, 412)],
    "chiffres": [(309, 340, 341, 374), (389, 351, 420, 373)],
    "bahalors": [(309, 376, 341, 411), (389, 393, 420, 416)],
    "felicite": [(309, 394, 341, 422), (389, 395, 420, 423)],
}
# Les deux verres de lunettes, toutes poses confondues (les pupilles vont de x 309 à 422, y 340 à 423).
ZONE = (296, 326, 436, 438)  # g, h, d, b
CYAN = np.array([63.0, 232.0, 224.0])


def separer(pose):
    a = np.array(Image.open(f"{DOSSIER}/gs_simon_prof_{pose}.webp").convert("RGBA")).astype(float)
    g, h, d, b = ZONE
    z = a[h:b, g:d].copy()
    r, v, bl = z[..., 0], z[..., 1], z[..., 2]
    # Les pixels cyan des pupilles (pas l'or des lunettes, pas les sourcils hors zone).
    cyan = (v > 90) & (bl > 90) & (r < 140) & (v - r > 40)
    cyan = ndimage.binary_dilation(cyan, iterations=4)
    dedans = np.zeros(cyan.shape, bool)
    for pg, ph, pd, pb in POSES[pose]:
        dedans[ph - h - 3:pb - h + 3, pg - g - 3:pd - g + 3] = True
    # Jamais l'or des lunettes : il reste tel quel (le petit reflet blanc de la pupille, lui, part avec elle).
    cyan &= dedans & ((r < 110) | (bl > 150))
    # Le fond des verres sous les pupilles : rempli de proche en proche par la moyenne des voisins connus.
    fond = z[..., :3].copy()
    # On ne remplit qu'à partir du verre sombre (pas des reflets dorés du bord).
    sombre = (r < 90) & (v < 120) & (bl < 120)
    connu = ~cyan
    source = connu & sombre
    for _ in range(400):
        if connu.all():
            break
        somme = np.zeros_like(fond)
        nb = np.zeros(connu.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(source, (dy, dx), (0, 1))
            somme += np.roll(fond * source[..., None], (dy, dx), (0, 1))
            nb += k
        neuf = (~connu) & (nb > 0)
        fond[neuf] = somme[neuf] / nb[neuf][:, None]
        connu = connu | neuf
        source = source | neuf
    verres = np.dstack([fond, z[..., 3]])
    # Les pupilles seules : de combien chaque pixel s'éloigne du fond vers le cyan.
    alpha = np.clip((z[..., 1] - fond[..., 1]) / np.maximum(CYAN[1] - fond[..., 1], 1), 0, 1) * cyan
    couleur = np.where(alpha[..., None] > 0.02, (z[..., :3] - (1 - alpha[..., None]) * fond) / np.maximum(alpha[..., None], 0.02), 0)
    pupilles = np.dstack([np.clip(couleur, 0, 255), alpha * 255])
    Image.fromarray(verres.astype(np.uint8), "RGBA").save(f"{DOSSIER}/gs_simon_prof_{pose}_verres.webp", lossless=True)
    Image.fromarray(pupilles.astype(np.uint8), "RGBA").save(f"{DOSSIER}/gs_simon_prof_{pose}_pupilles.webp", lossless=True)
    return verres, pupilles


if __name__ == "__main__":
    for p in POSES:
        separer(p)
        print(p, "ok")
