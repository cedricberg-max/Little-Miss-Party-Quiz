"""Platine du blind test : vinyle, étiquettes, reflet et bras rendus en images réalistes (vue de dessus).

Tout est calculé ici (aucune photo ni image existante) : python3 platine.py <dossier>
Sorties (WebP transparents ; cadre de la platine 1200 × 1000, disque centré en (500, 500), rayon 480) :
  lmp_bt_vinyle.webp  le disque sans étiquette, carré 1000 × 1000 centré sur l'axe (tourne)
  lmp_bt_label_rose.webp, lmp_bt_label_or.webp   étiquettes (tournent avec le disque)
  lmp_bt_reflet.webp  lumière et ombre portée sur tout le cadre, fixes pendant que le disque tourne
  lmp_bt_bras.webp    bras de lecture et son ombre sur tout le cadre ; pivot en (1090, 150)
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
SS = 2                       # suréchantillonnage pour des bords nets
W, H = 1200, 1000
CX, CY, R = 500, 500, 480
PIVOT = (1090, 150)
rng = np.random.default_rng(7)


def grille(w, h):
    y, x = np.mgrid[0:h * SS, 0:w * SS].astype(np.float32) / SS
    return x, y


def lisse(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def enregistrer(rgba, nom, w, h, cadre=None):
    img = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), 'RGBA').resize((w, h), Image.LANCZOS)
    if cadre:
        img = img.crop(cadre)
    img.save(os.path.join(OUT, nom), 'WEBP', quality=90, method=6)
    return img


def profil_sillons(n=6000):
    """Variation de brillance d'un sillon à l'autre, le long du rayon (pas angulaire : tout est concentrique)."""
    p = rng.normal(0, 1, n)
    k = np.exp(-np.linspace(-3, 3, 9) ** 2); k /= k.sum()
    p = np.convolve(p, k, 'same')
    lent = np.convolve(rng.normal(0, 1, n), np.ones(120) / 120, 'same') * 4
    return (p + lent) / np.abs(p + lent).max()


SILLONS = profil_sillons()
# Plages (silences entre deux chansons) : bandes lisses et un peu plus brillantes.
PLAGES = [0.52, 0.63, 0.735, 0.83, 0.915]


def plages(rn):
    m = np.zeros_like(rn)
    for p in PLAGES:
        m = np.maximum(m, 1 - lisse(0.0, 0.006, np.abs(rn - p)))
    return m


def vinyle():
    x, y = grille(W, H)
    dx, dy = x - CX, y - CY
    r = np.hypot(dx, dy)
    rn = r / R
    s = SILLONS[np.clip((rn * (len(SILLONS) - 1)).astype(int), 0, len(SILLONS) - 1)]
    pl = plages(rn)
    gravee = (rn > 0.43) & (rn < 0.965)
    base = 0.045 + 0.012 * s * gravee - 0.008 * pl * gravee
    # Cire morte autour de l'étiquette (lisse), bord relevé (biseau) à l'extérieur.
    cire = (rn >= 0.36) & (rn <= 0.43)
    base = np.where(cire, 0.06, base)
    biseau = lisse(0.965, 0.985, rn) * (1 - lisse(0.99, 1.0, rn))
    base = base + 0.05 * biseau
    c = np.stack([base, base, base * 1.06], -1)
    a = 1 - lisse(R - 0.8, R + 0.8, r)
    a = a * lisse(0.335 * R, 0.345 * R, r) + (r < 0.345 * R) * 0  # trou pour l'étiquette
    return enregistrer(np.dstack([c, a]), 'lmp_bt_vinyle.webp', W, H, cadre=(CX - 500, CY - 500, CX + 500, CY + 500))


def etiquette(fond, encre, nom):
    taille = int(2 * 0.345 * R)
    S = taille * SS
    x, y = np.mgrid[0:S, 0:S].astype(np.float32) / SS
    dx, dy = x - taille / 2, y - taille / 2
    r = np.hypot(dx, dy)
    rr = taille / 2
    papier = 1 + 0.035 * rng.normal(0, 1, (S, S)).astype(np.float32)
    vignette = 1 - 0.18 * (r / rr) ** 2
    col = np.array(fond, np.float32)[None, None, :] * (papier * vignette)[..., None]
    # Filets imprimés.
    for rf, ep in ((0.92, 0.012), (0.62, 0.008)):
        anneau = 1 - lisse(0, ep * rr, np.abs(r - rf * rr))
        col = col * (1 - 0.55 * anneau[..., None]) + np.array(encre, np.float32) * 0.55 * anneau[..., None]
    a = 1 - lisse(rr - 1, rr, r)
    # Trou central et son reflet métallique (axe de la platine).
    axe = r < 0.055 * rr
    metal = 0.55 + 0.4 * np.clip(-(dx + dy) / (0.055 * rr * 1.4), -1, 1)
    col = np.where(axe[..., None], np.stack([metal, metal, metal * 1.02], -1), col)
    img = Image.fromarray((np.dstack([np.clip(col, 0, 1), a]) * 255).astype(np.uint8), 'RGBA')
    d = ImageDraw.Draw(img)
    police = ImageFont.truetype('/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf', int(0.15 * rr * SS))
    petite = ImageFont.truetype('/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf', int(0.1 * rr * SS))
    teinte = tuple(int(v * 255) for v in encre) + (235,)
    texte_courbe(img, 'LITTLE MISS PARTY', police, 0.76 * rr * SS, -90, teinte, haut=True)
    texte_courbe(img, 'BLIND TEST', police, 0.76 * rr * SS, 90, teinte, haut=False)
    for t, dy_ in (('33⅓', -0.3), ('STÉRÉO', 0.3)):
        bb = d.textbbox((0, 0), t, font=petite)
        d.text((S / 2 - (bb[2] - bb[0]) / 2, S / 2 + dy_ * rr * SS - (bb[3] - bb[1]) / 2 - bb[1]), t, font=petite, fill=teinte)
    img.resize((taille, taille), Image.LANCZOS).save(os.path.join(OUT, nom), 'WEBP', quality=90, method=6)


def texte_courbe(img, texte, police, rayon, centre_deg, couleur, haut):
    """Écrit [texte] le long d'un cercle, centré sur l'angle [centre_deg] (haut : lu de gauche à droite par-dessus)."""
    S = img.size[0]
    d = ImageDraw.Draw(img)
    largeurs = [d.textlength(ch, font=police) for ch in texte]
    total = sum(largeurs) * 1.08
    angle = math.radians(centre_deg) - (total / rayon / 2 if haut else -total / rayon / 2)
    for ch, lw in zip(texte, largeurs):
        pas = lw * 1.08 / rayon
        a = angle + (pas / 2 if haut else -pas / 2)
        cx, cy = S / 2 + rayon * math.cos(a), S / 2 + rayon * math.sin(a)
        tuile = Image.new('RGBA', (int(lw * 2 + 8), int(police.size * 1.6)), (0, 0, 0, 0))
        ImageDraw.Draw(tuile).text((tuile.size[0] / 2 - lw / 2, police.size * 0.2), ch, font=police, fill=couleur)
        rot = -math.degrees(a) - 90 if haut else -math.degrees(a) + 90
        tuile = tuile.rotate(rot, resample=Image.BICUBIC, expand=True)
        img.alpha_composite(tuile, (int(cx - tuile.size[0] / 2), int(cy - tuile.size[1] / 2)))
        angle += pas if haut else -pas


def reflet():
    x, y = grille(W, H)
    dx, dy = x - CX, y - CY
    r = np.hypot(dx, dy)
    rn = r / R
    th = np.arctan2(dy, dx)
    s = SILLONS[np.clip((rn * (len(SILLONS) - 1)).astype(int), 0, len(SILLONS) - 1)]
    # Lumière en haut à gauche : les sillons renvoient deux pinceaux opposés, perpendiculaires à la lumière.
    axe = math.radians(45)
    pinceau = np.abs(np.cos(th - axe)) ** 18
    large = np.abs(np.cos(th - axe)) ** 3
    grave = ((rn > 0.43) & (rn < 0.965)).astype(np.float32)
    pl = plages(rn)
    eclat = grave * (pinceau * (0.38 + 0.28 * s + 0.25 * pl) + large * 0.07)
    eclat += lisse(0.965, 0.985, rn) * (1 - lisse(0.99, 1.0, rn)) * (0.25 + 0.5 * pinceau)
    eclat += ((rn >= 0.36) & (rn <= 0.43)) * pinceau * 0.18
    # Légère irisation dans les pinceaux, comme sur un vrai disque.
    teinte = np.stack([1 + 0.10 * np.sin(rn * 90), 1 + 0.10 * np.sin(rn * 90 + 2.1), 1 + 0.12 * np.sin(rn * 90 + 4.2)], -1)
    dans = 1 - lisse(R - 0.8, R + 0.8, r)
    a_eclat = np.clip(eclat, 0, 1) * dans * (rn > 0.345)
    # Ombre portée du disque, vers le bas à droite, hors du disque.
    ox, oy = dx - 14, dy - 20
    ro = np.hypot(ox, oy)
    ombre = (1 - lisse(R - 30, R + 50, ro)) * 0.55 * (1 - dans)
    col = np.clip(teinte, 0, 1) * (a_eclat[..., None] > 0)
    a = a_eclat + ombre
    col = np.where((a_eclat > 0)[..., None], np.clip(teinte, 0, 1), 0)
    return enregistrer(np.dstack([col, np.clip(a, 0, 1)]), 'lmp_bt_reflet.webp', W, H)


LUMIERE = np.array([-0.45, -0.55, 0.7]); LUMIERE = LUMIERE / np.linalg.norm(LUMIERE)


def ombrage(nx, ny, nz, albedo, spec, brillance):
    diff = np.clip(nx * LUMIERE[0] + ny * LUMIERE[1] + nz * LUMIERE[2], 0, 1)
    h = LUMIERE + np.array([0, 0, 1.0]); h = h / np.linalg.norm(h)
    sp = np.clip(nx * h[0] + ny * h[1] + nz * h[2], 0, 1) ** brillance
    return np.clip(albedo * (0.25 + 0.85 * diff) + spec * sp, 0, 1)


def cylindre(x, y, p0, p1, rayon, albedo, spec=0.9, brillance=40, couleur=(1, 1, 1)):
    """Tube vu de dessus entre p0 et p1 : ombrage de cylindre, extrémités arrondies."""
    p0 = np.array(p0, np.float32); p1 = np.array(p1, np.float32)
    v = p1 - p0; L = np.linalg.norm(v); u = v / L; n = np.array([-u[1], u[0]])
    rx, ry = x - p0[0], y - p0[1]
    t = np.clip(rx * u[0] + ry * u[1], 0, L)
    px, py = rx - t * u[0], ry - t * u[1]
    d = np.hypot(px, py)
    off = np.clip((px * n[0] + py * n[1]) / rayon, -1, 1)
    nz = np.sqrt(np.clip(1 - off ** 2, 0, 1))
    nx, ny = off * n[0], off * n[1]
    v_ = ombrage(nx, ny, nz, albedo, spec, brillance)
    a = 1 - lisse(rayon - 0.7, rayon + 0.7, d)
    c = np.stack([v_ * couleur[0], v_ * couleur[1], v_ * couleur[2]], -1)
    return c, a


def dome(x, y, c0, rayon, albedo, spec=0.8, brillance=30, brosse=True, couleur=(1, 1, 1)):
    dx, dy = x - c0[0], y - c0[1]
    d = np.hypot(dx, dy)
    q = np.clip(d / rayon, 0, 1)
    nz = np.sqrt(np.clip(1 - (q * 0.75) ** 2, 0, 1))
    nx, ny = dx / rayon * 0.75, dy / rayon * 0.75
    v = ombrage(nx, ny, nz, albedo, spec, brillance)
    if brosse:  # aluminium brossé : stries concentriques
        v = v * (1 + 0.06 * np.sin(d * 2.3) + 0.03 * np.sin(d * 7.1))
    a = 1 - lisse(rayon - 0.7, rayon + 0.7, d)
    return np.stack([v * couleur[0], v * couleur[1], v * couleur[2]], -1), a


def boite(x, y, centre, demi_l, demi_h, angle, albedo, spec=0.5, brillance=20, couleur=(1, 1, 1), arrondi=4):
    ca, sa = math.cos(angle), math.sin(angle)
    rx, ry = x - centre[0], y - centre[1]
    lx, ly = rx * ca + ry * sa, -rx * sa + ry * ca
    qx, qy = np.abs(lx) - demi_l + arrondi, np.abs(ly) - demi_h + arrondi
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - arrondi
    # Biseau sur les bords : la lumière accroche le côté haut-gauche.
    bord = np.clip(-d / 4, 0, 1)
    nx = (1 - bord) * np.sign(lx) * (np.abs(lx) > demi_l - 5) * 0.6
    ny = (1 - bord) * np.sign(ly) * (np.abs(ly) > demi_h - 5) * 0.6
    gx, gy = nx * ca - ny * sa, nx * sa + ny * ca
    nz = np.sqrt(np.clip(1 - gx ** 2 - gy ** 2, 0, 1))
    v = ombrage(gx, gy, nz, albedo, spec, brillance)
    a = 1 - lisse(-0.7, 0.7, d)
    return np.stack([v * couleur[0], v * couleur[1], v * couleur[2]], -1), a


def bras():
    x, y = grille(W, H)
    calques = []
    px, py = PIVOT
    coude = (1072, 600)
    tete = (842, 732)            # centre de la coquille ; la pointe de lecture se pose vers 0,85 du rayon
    ang_tete = math.atan2(tete[1] - coude[1], tete[0] - coude[0])
    calques.append(dome(x, y, (px, py), 74, 0.62, brillance=25))                       # socle
    calques.append(dome(x, y, (px, py), 50, 0.30, spec=0.5, brosse=False))            # bague sombre
    calques.append(cylindre(x, y, (px + 34, py - 40), (px + 78, py - 82), 34, 0.55, brillance=30))  # contrepoids
    for k in range(6):                                                                 # moletage du contrepoids
        t = 0.2 + k * 0.12
        cx_, cy_ = px + 34 + 44 * t, py - 40 - 42 * t
        c, a = cylindre(x, y, (cx_ - 1, cy_ + 2), (cx_ + 1, cy_ - 2), 35, 0.35, spec=0.3)
        calques.append((c, a * 0.5))
    calques.append(cylindre(x, y, (px + 14, py - 14), (px + 34, py - 40), 12, 0.6))   # axe arrière
    calques.append(cylindre(x, y, (px, py), coude, 13, 0.7, brillance=60))             # tube
    calques.append(cylindre(x, y, coude, (tete[0] + 40 * math.cos(ang_tete), tete[1] + 40 * math.sin(ang_tete)), 12, 0.7, brillance=60))
    calques.append(dome(x, y, (px, py), 22, 0.75, brillance=50, brosse=False))         # chapeau du pivot
    calques.append(boite(x, y, tete, 60, 30, ang_tete, 0.16, spec=0.35))               # coquille noire
    calques.append(boite(x, y, (tete[0] - 4 * math.cos(ang_tete), tete[1] - 4 * math.sin(ang_tete)), 34, 19, ang_tete, 0.08, spec=0.25, arrondi=3))  # cellule
    for s in (-1, 1):                                                                  # vis dorées
        sx = tete[0] + 14 * math.cos(ang_tete) - s * 12 * math.sin(ang_tete)
        sy = tete[1] + 14 * math.sin(ang_tete) + s * 12 * math.cos(ang_tete)
        calques.append(dome(x, y, (sx, sy), 4, 0.8, brosse=False, couleur=(1.0, 0.82, 0.45)))
    lev = ang_tete + math.pi / 2                                                        # lève-bras
    calques.append(cylindre(x, y, (tete[0] + 40 * math.cos(ang_tete) + 20 * math.cos(lev), tete[1] + 40 * math.sin(ang_tete) + 20 * math.sin(lev)),
                            (tete[0] + 40 * math.cos(ang_tete) + 52 * math.cos(lev), tete[1] + 40 * math.sin(ang_tete) + 52 * math.sin(lev)), 5, 0.7))
    col = np.zeros(x.shape + (3,), np.float32); alpha = np.zeros(x.shape, np.float32)
    for c, a in calques:
        col = c * a[..., None] + col * (1 - a[..., None])
        alpha = a + alpha * (1 - a)
    # Ombre portée sous le bras.
    ombre = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10 * SS))
    # Décalage sans enroulement : l'ombre qui sortirait du cadre à droite ne doit pas réapparaître à gauche.
    ombre = np.asarray(ombre, np.float32) / 255
    dy, dx = 16 * SS, 12 * SS
    ombre = np.pad(ombre, ((dy, 0), (dx, 0)))[:ombre.shape[0], :ombre.shape[1]] * 0.55
    a_tot = alpha + ombre * (1 - alpha)
    col_tot = np.where(a_tot[..., None] > 0, col * alpha[..., None] / np.maximum(a_tot, 1e-6)[..., None], 0)
    return enregistrer(np.dstack([col_tot, a_tot]), 'lmp_bt_bras.webp', W, H)


if __name__ == '__main__':
    vinyle()
    etiquette((0.97, 0.53, 0.70), (0.16, 0.05, 0.12), 'lmp_bt_label_rose.webp')
    etiquette((0.94, 0.80, 0.57), (0.20, 0.12, 0.04), 'lmp_bt_label_or.webp')
    reflet()
    bras()
    print('ok', OUT)
