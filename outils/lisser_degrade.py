"""Fond un dégradé à bandes d'une planche (cartes de réponse du Quiz 3D, cedric 30/10) : flou vertical seulement,
sur les pixels du masque (intérieur de la carte), puis tramage d'un demi-niveau. Les bords et le tube néon ne bougent pas.

  python3 outils/lisser_degrade.py entree.webp sortie.webp y0 y1 sigma mode [marge_x]
  mode : fond (alpha >= 225) ou alpha:min:max:rouge_max
Cartes du 30/10 :  carte_fond 92 200 3.5 fond  ·  carte_juste 83 268 6 alpha:100:205:110
"""
import sys, numpy as np
from PIL import Image
src, dst, y0, y1, sigma, mode = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float64)
h, w, _ = a.shape
if mode == 'fond':
    masque = a[:, :, 3] >= 225
elif mode.startswith('alpha:'):
    _, lo, hi, rmax = mode.split(':')
    masque = (a[:, :, 3] >= int(lo)) & (a[:, :, 3] <= int(hi)) & (a[:, :, 0] <= int(rmax))
else:  # juste : intérieur vert, ni le tube ni sa lueur vive
    masque = (a[:, :, 3] >= 150) & (a[:, :, 3] <= 200) & (a[:, :, 0] <= 110)
masque[:y0] = False; masque[y1:] = False
mx = int(sys.argv[7]) if len(sys.argv) > 7 else 0
if mx: masque[:, :mx] = False; masque[:, w - mx:] = False
r = int(3 * sigma)
k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
pm = a * a[:, :, 3:4] / 255.0  # prémultiplié
m = masque.astype(np.float64)
num = np.zeros_like(pm); den = np.zeros((h, w))
for d, kv in zip(range(-r, r + 1), k):
    lo, hi = max(0, -d), min(h, h - d)
    num[lo:hi] += kv * (pm[lo + d:hi + d] * m[lo + d:hi + d, :, None])
    den[lo:hi] += kv * m[lo + d:hi + d]
out = a.copy()
sel = masque & (den > 0)
p = num[sel] / den[sel][:, None]
# p[:, 3] contient alpha²/255 : on retrouve l'alpha lissé
alpha = np.sqrt(np.clip(p[:, 3], 0, None) * 255.0)
rgb = np.where(alpha[:, None] > 0, p[:, :3] * 255.0 / np.maximum(alpha[:, None], 1e-6), 0)
res = np.concatenate([rgb, alpha[:, None]], axis=1)
rng = np.random.default_rng(30)
res = res + rng.uniform(-0.5, 0.5, res.shape)  # tramage : pas de marches de 1 niveau
out[sel] = res
Image.fromarray(np.clip(np.rint(out), 0, 255).astype(np.uint8), 'RGBA').save(dst, 'WEBP', lossless=True, quality=100, method=6)
