"""Icône et bannière Android TV tirées du logo Little Miss Party.

Usage : python3 tools/habillage/icone_tv.py  (depuis la racine du dépôt)
Produit tv/src/main/res/drawable-xhdpi/banner.png (320×180 dp) et le premier plan / fond de l'icône adaptative
en mipmap-xxxhdpi (108 dp, zone sûre au centre : cercle de 66 dp).
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

RES = "tv/src/main/res"
LOGO = Image.open(f"{RES}/drawable-nodpi/lmp_logo.webp").convert("RGBA")
COUPE = 535  # espace entre « Little » et « Miss » dans le logo
POLICE = "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf"


def fond(w, h, lueur=(255, 60, 172), force=0.55):
    """Violet nuit avec une lueur rose au centre et quelques paillettes, comme l'écran d'accueil."""
    y, x = np.mgrid[0:h, 0:w].astype(float)
    t = (x / w * 0.4 + y / h * 0.6)
    haut, bas = np.array([44, 12, 84]), np.array([18, 6, 40])
    img = haut * (1 - t[..., None]) + bas * t[..., None]
    d = np.sqrt(((x - w / 2) / (w * 0.55)) ** 2 + ((y - h * 0.45) / (h * 0.6)) ** 2)
    g = np.clip(1 - d, 0, 1) ** 2 * force
    img = img * (1 - g[..., None]) + np.array(lueur) * g[..., None]
    im = Image.fromarray(img.clip(0, 255).astype("uint8"), "RGB").convert("RGBA")
    rnd = np.random.default_rng(7)
    dr = ImageDraw.Draw(im)
    for _ in range(int(w * h / 3600)):
        px, py, r = rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(0.6, 1.8)
        a = int(rnd.uniform(60, 170))
        dr.ellipse((px - r, py - r, px + r, py + r), fill=(255, 230, 250, a))
    return im


def adoucir_bord(img, cote, largeur=30):
    a = np.array(img).astype(float)
    n = a.shape[1]
    rampe = np.ones(n)
    k = np.linspace(0, 1, largeur)
    if cote == "droite":
        rampe[-largeur:] = k[::-1]
    else:
        rampe[:largeur] = k
    a[..., 3] *= rampe[None, :]
    return Image.fromarray(a.astype("uint8"), "RGBA")


def coller(dest, img, cx, cy, largeur):
    h = round(img.height * largeur / img.width)
    img = img.resize((largeur, h), Image.LANCZOS)
    dest.alpha_composite(img, (round(cx - largeur / 2), round(cy - h / 2)))
    return h


def banniere():
    w, h = 640, 360
    im = fond(w, h)
    coller(im, LOGO, w / 2, h * 0.43, 560)
    # Petite étiquette dorée « LE QUIZ » sous le logo, dans le style de « PARTY ».
    f = ImageFont.truetype(POLICE, 30)
    texte = "  ".join("QUIZ")
    dr = ImageDraw.Draw(im)
    tw = dr.textlength(texte, font=f)
    x0, y0 = (w - tw) / 2, h * 0.79
    masque = Image.new("L", (w, h))
    ImageDraw.Draw(masque).text((x0, y0), texte, font=f, fill=255)
    or_ = Image.new("RGBA", (w, h))
    grad = np.zeros((h, w, 4), "uint8")
    yy = np.linspace(0, 1, h)[:, None]
    grad[..., 0] = (255 - 20 * yy).astype("uint8")
    grad[..., 1] = (226 - 60 * yy).astype("uint8")
    grad[..., 2] = (160 - 90 * yy).astype("uint8")
    grad[..., 3] = 255
    or_ = Image.fromarray(grad, "RGBA")
    halo = Image.new("RGBA", (w, h), (255, 200, 120, 0))
    halo.putalpha(masque.filter(ImageFilter.GaussianBlur(6)).point(lambda v: v * 0.6))
    im.alpha_composite(halo)
    im.paste(or_, (0, 0), masque)
    ligne = (230, 190, 120, 200)
    dr = ImageDraw.Draw(im)
    dr.line((x0 - 70, y0 + 18, x0 - 18, y0 + 18), fill=ligne, width=2)
    dr.line((x0 + tw + 18, y0 + 18, x0 + tw + 70, y0 + 18), fill=ligne, width=2)
    im.convert("RGB").save(f"{RES}/drawable-xhdpi/banner.png", optimize=True)


def icone():
    t = 432  # 108 dp en xxxhdpi
    fond(t, t, force=0.7).convert("RGB").save(f"{RES}/mipmap-xxxhdpi/ic_launcher_background.png", optimize=True)
    fg = Image.new("RGBA", (t, t))
    little = adoucir_bord(LOGO.crop((30, 20, COUPE, 250)), "droite")
    miss = adoucir_bord(LOGO.crop((COUPE, 20, 990, 250)), "gauche")
    party = LOGO.crop((300, 262, 700, 345))
    # « Little » puis « Miss » en dessous, décalé, et « PARTY » : tient dans la zone sûre de 264 px.
    coller(fg, little, t / 2 - 18, t * 0.35, 250)
    coller(fg, miss, t / 2 + 22, t * 0.53, 224)
    coller(fg, party, t / 2, t * 0.695, 150)
    fg.save(f"{RES}/mipmap-xxxhdpi/ic_launcher_foreground.png", optimize=True)


if __name__ == "__main__":
    import os
    os.makedirs(f"{RES}/drawable-xhdpi", exist_ok=True)
    os.makedirs(f"{RES}/mipmap-xxxhdpi", exist_ok=True)
    banniere()
    icone()
