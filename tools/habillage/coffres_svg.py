"""Little Miss Party : les 6 coffres de « La bombe cachée » pour les tablettes (mêmes formes et couleurs que la TV).

Usage : python3 tools/habillage/coffres_svg.py  → web/public/img/coffres/coffre-1..6.svg
La plaque dorée de chaque coffre est vide : la tablette écrit le numéro par-dessus (centre donné par PLAQUES).
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../web/public/img/coffres')
# largeur, hauteur, part du couvercle, bombé, clair, foncé, trait (comme MODELES dans BombeCachee.kt)
MODELES = [
    (118, 94, .38, True, '#F6C6D5', '#DC8EAC', '#9C4F6E'),
    (100, 106, .20, False, '#C8DCF6', '#8EAEDD', '#3F5E8C'),
    (80, 64, .44, True, '#C8EFDF', '#86C8AD', '#2F6E58'),
    (126, 70, .30, False, '#DED2F7', '#A895DC', '#5A458F'),
    (96, 90, .26, False, '#FFDCC2', '#F2A97E', '#A55A35'),
    (108, 90, .36, True, '#F8EEDF', '#DCC5A2', '#8A6A44'),
]
OR = ('#FFF3D1', '#E9C27A', '#A8782F')


def plaque(k):
    w, h, c, *_ = MODELES[k]
    l = .30 if k == 4 else c
    pw, ph = .36, min(.3, (1 - l) * .56)
    cy = l + (1 - l) * (.42 if k == 2 else .46)
    return .5 - pw / 2, cy - ph / 2, pw, ph


def svg(k):
    w, h, c, bombe, clair, fonce, trait = MODELES[k]
    m = 6  # marge pour le couvercle qui déborde et le trait
    pied = .1 * h if k == 2 else 0
    l = (.30 if k == 4 else c) * h
    bas = h - pied
    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-m} {-m} {w + 2 * m} {h + 2 * m}" width="{w + 2 * m}" height="{h + 2 * m}">')
    o.append('<defs>'
             f'<linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{clair}"/><stop offset="1" stop-color="{fonce}"/></linearGradient>'
             f'<linearGradient id="o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{OR[0]}"/><stop offset=".5" stop-color="{OR[1]}"/><stop offset="1" stop-color="{OR[2]}"/></linearGradient>'
             f'<linearGradient id="oh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{OR[2]}"/><stop offset=".35" stop-color="{OR[0]}"/><stop offset=".7" stop-color="{OR[1]}"/><stop offset="1" stop-color="{OR[2]}"/></linearGradient>'
             '<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient>'
             '<radialGradient id="ombre"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
             '</defs>')
    o.append(f'<ellipse cx="{w / 2}" cy="{h - 1}" rx="{w * .58}" ry="5" fill="url(#ombre)"/>')
    if pied:
        for fx in (.14, .86):
            o.append(f'<circle cx="{w * fx}" cy="{bas + pied * .3}" r="{pied * .7}" fill="url(#o)"/>')
    r = .06 * w
    if k == 4:
        corps = f'M0 {l - .02 * h} H{w} V{bas - .07 * h} A{w / 2} {.07 * h} 0 0 1 0 {bas - .07 * h} Z'
    else:
        corps = f'M0 {l} H{w} V{bas - r} Q{w} {bas} {w - r} {bas} H{r} Q0 {bas} 0 {bas - r} Z'
    o.append(f'<clipPath id="cc"><path d="{corps}"/></clipPath>')
    o.append(f'<path d="{corps}" fill="url(#c)"/><path d="{corps}" fill="url(#s)"/>')
    g = []
    if k == 0:
        for fx in (.18, .82):
            g.append(f'<rect x="{fx * w - .04 * w}" y="0" width="{.08 * w}" height="{h}" fill="url(#oh)"/>')
    elif k == 1:
        for fx in (.22, .78):
            g.append(f'<rect x="{fx * w - .035 * w}" y="0" width="{.07 * w}" height="{h}" fill="{trait}" opacity=".55"/>')
        for x in (0, w - .1 * w):
            g.append(f'<rect x="{x}" y="{bas - .1 * w}" width="{.1 * w}" height="{.1 * w}" fill="url(#o)"/>')
    elif k == 2:
        g.append(f'<rect x="{.05 * w}" y="{l + .06 * h}" width="{.9 * w}" height="{bas - l - .12 * h}" rx="{.04 * w}" fill="none" stroke="{OR[1]}" stroke-width="1.6"/>')
    elif k == 3:
        for i in range(7):
            g.append(f'<circle cx="{w * (.08 + i * .14)}" cy="{bas - .08 * h}" r="{.018 * w}" fill="url(#o)"/>')
    elif k == 4:
        g.append(f'<rect x="{w * .43}" y="0" width="{w * .14}" height="{h}" fill="#FFF4E4"/>')
    elif k == 5:
        for fy in (.62, .86):
            g.append(f'<rect x="0" y="{l + (bas - l) * fy - .03 * h}" width="{w}" height="{.06 * h}" fill="#8E5BB5"/>')
    o.append('<g clip-path="url(#cc)">' + ''.join(g) + '</g>')
    o.append(f'<path d="{corps}" fill="none" stroke="{trait}" stroke-opacity=".7" stroke-width="1.6"/>')
    # Couvercle.
    if k == 4:
        couv = f'M{-.03 * w} {.08 * h} H{1.03 * w} V{l} A{.53 * w} {.05 * h} 0 0 1 {-.03 * w} {l} Z'
    elif bombe:
        couv = f'M{-.02 * w} {l + .02 * h} V{l} A{.52 * w} {l} 0 0 1 {1.02 * w} {l} V{l + .02 * h} Z'
    else:
        rr = .05 * w
        couv = f'M{-.03 * w + rr} 0 H{1.03 * w - rr} Q{1.03 * w} 0 {1.03 * w} {rr} V{l + .02 * h} H{-.03 * w} V{rr} Q{-.03 * w} 0 {-.03 * w + rr} 0 Z'
    o.append(f'<clipPath id="cv"><path d="{couv}"/></clipPath>')
    o.append(f'<path d="{couv}" fill="url(#c)"/><path d="{couv}" fill="#fff" opacity=".14"/>')
    g = []
    if k == 0:
        for fx in (.18, .82):
            g.append(f'<rect x="{fx * w - .04 * w}" y="0" width="{.08 * w}" height="{l + .02 * h}" fill="url(#oh)"/>')
    elif k == 1:
        for fx in (.22, .78):
            g.append(f'<rect x="{fx * w - .035 * w}" y="0" width="{.07 * w}" height="{l}" fill="{trait}" opacity=".55"/>')
    elif k == 3:
        for i in range(7):
            g.append(f'<circle cx="{w * (.08 + i * .14)}" cy="{l - .07 * h}" r="{.016 * w}" fill="url(#o)"/>')
    elif k == 4:
        g.append(f'<rect x="{w * .43}" y="0" width="{w * .14}" height="{l + .05 * h}" fill="#FFF4E4"/>')
    elif k == 5:
        g.append(f'<rect x="{w * .46}" y="0" width="{w * .08}" height="{l}" fill="#8E5BB5"/>')
    o.append('<g clip-path="url(#cv)">' + ''.join(g) + '</g>')
    o.append(f'<path d="{couv}" fill="none" stroke="{trait}" stroke-opacity=".7" stroke-width="1.6"/>')
    if k == 4:
        o.append(f'<ellipse cx="{w / 2}" cy="{.08 * h}" rx="{.53 * w}" ry="{.08 * h}" fill="{clair}" stroke="{trait}" stroke-opacity=".7" stroke-width="1.6"/>')
        cx, cy = w / 2, .06 * h
        for dx in (-.2, .01):
            o.append(f'<ellipse cx="{cx + (dx + .095) * w}" cy="{cy - .02 * h}" rx="{.095 * w}" ry="{.05 * h}" fill="#FFF4E4" stroke="{trait}" stroke-opacity=".35"/>')
        o.append(f'<circle cx="{cx}" cy="{cy}" r="{.045 * w}" fill="#F6D9C4"/>')
    else:
        o.append(f'<rect x="{-.025 * w}" y="{l - .035 * h}" width="{1.05 * w}" height="{.07 * h}" rx="{.02 * w}" fill="url(#o)"/>')
    if k == 2:
        o.append(f'<circle cx="{w / 2}" cy="{.06 * h}" r="{.065 * w}" fill="#F7A6C8" stroke="{OR[1]}" stroke-width="1.6"/>')
    px, py, pw, ph = plaque(k)
    o.append(f'<rect x="{px * w}" y="{py * h}" width="{pw * w}" height="{ph * h}" rx="{.05 * w}" fill="url(#o)" stroke="{OR[2]}" stroke-opacity=".6" stroke-width="1.6"/>')
    o.append('</svg>')
    return '\n'.join(o) + '\n'


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for k in range(6):
        w, h, *_ = MODELES[k]
        px, py, pw, ph = plaque(k)
        m = 6
        # centre de la plaque en % de l'image (marge comprise), pour y écrire le numéro
        print(f'coffre-{k + 1}.svg  plaque x={(px + pw / 2) * w + m:.1f}/{w + 2 * m} ({((px + pw / 2) * w + m) / (w + 2 * m) * 100:.1f} %)  y={((py + ph / 2) * h + m) / (h + 2 * m) * 100:.1f} %  hauteur={ph * h / (h + 2 * m) * 100:.1f} %')
        open(os.path.join(OUT, f'coffre-{k + 1}.svg'), 'w').write(svg(k))
