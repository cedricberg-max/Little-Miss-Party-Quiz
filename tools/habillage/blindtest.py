"""
Paquet « Blind test libre de droits » : mélodies du domaine public (comptines traditionnelles, compositeurs
morts depuis plus de 70 ans) arrangées et jouées par le studio de Little Miss Party. La composition est
libre, l'enregistrement est le nôtre : aucun droit d'auteur ni droit voisin à déclarer.

    python3 blindtest.py out [noms...]
"""
import sys
import numpy as np
import studio as S
from pedalboard import Pedalboard, Limiter, Gain
from studio import note, chord, kick, snare, hat, clap, shaker, crash, Mix, save, SR

NOTES = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

def m(nom):
    """« C4 », « F#5 », « Bb3 » → numéro MIDI (C4 = 60)."""
    lettre, reste = nom[0], nom[1:]
    alt = 0
    while reste and reste[0] in '#b':
        alt += 1 if reste[0] == '#' else -1
        reste = reste[1:]
    return 12 * (int(reste) + 1) + NOTES[lettre] + alt

def mel(texte):
    """« E5:.5 D#5:.5 R:1 » → [(midi ou None, temps)]."""
    out = []
    for jeton in texte.split():
        n, d = jeton.split(':')
        out.append((None if n == 'R' else m(n), float(d)))
    return out

ACC = {'': (0, 4, 7), 'm': (0, 3, 7), '7': (0, 4, 7, 10)}
def accord(nom):
    racine = nom[0] + (nom[1] if len(nom) > 1 and nom[1] in '#b' else '')
    qual = nom[len(racine):]
    r = m(racine + '3')
    if r > m('F#3'):
        r -= 12
    return r, [r + 12 + i for i in ACC[qual]]

def piece(nom, tempo, metre, melodie, accords, lead, style='pop', octave=0, repeter=1, intro=1):
    """
    Arrange une mélodie : `accords` donne un accord par mesure (ou deux, séparés par « / »), `style`
    choisit l'accompagnement : pop (batterie, basse, piano), valse, classique (cordes, sans batterie),
    fanfare (cuivres et caisse claire).
    """
    k = 120 / tempo  # un temps de la pièce en temps du studio (120 BPM)
    notes = mel(melodie) * repeter
    total = sum(d for _, d in notes)
    mesures = int(np.ceil(total / metre))
    acc = (accords * int(np.ceil(mesures / len(accords))))[:mesures]
    debut = intro * metre  # une mesure d'introduction pour se caler
    mx = Mix((debut + total) * k + 2, tail=2.5)
    sec = 60 / tempo
    # Mélodie
    t = debut
    for n, d in notes:
        if n is not None:
            bus = 'brass' if lead in ('trumpet', 'brass_section', 'muted_trumpet', 'trombone') else ('strings' if lead in ('violin', 'string_ensemble_1', 'pizzicato_strings', 'flute', 'oboe', 'clarinet') else 'keys')
            mx.add(bus, note(lead, n + 12 * octave, d * sec * .92, .95, release=.18), t * k)
            if style == 'pop':
                mx.add('bells', note('glockenspiel', n + 12 * octave + 12, min(d, .5) * sec, .18, release=.3), t * k)
        t += d
    # Accompagnement
    for b in range(-intro, mesures):
        nom = acc[max(b, 0)] if b >= 0 else acc[0]
        moities = nom.split('/')
        for j, a in enumerate(moities):
            r, tri = accord(a)
            t0 = debut + b * metre + j * metre / len(moities)
            dur = metre / len(moities)
            if style == 'pop':
                for q in range(int(dur)):
                    mx.add('bass', note('electric_bass_finger', r + (7 if q % 2 else 0), .9 * sec, .8, release=.08), (t0 + q) * k)
                    mx.add('keys', chord('electric_piano_1', tri, .4 * sec, .45, release=.15), (t0 + q + .5) * k)
            elif style == 'valse':
                mx.add('bass', note('acoustic_bass', r, .9 * sec, .85, release=.1), t0 * k)
                for q in range(1, int(dur)):
                    mx.add('keys', chord('acoustic_grand_piano', tri, .5 * sec, .4, release=.15), (t0 + q) * k)
            elif style == 'classique':
                mx.add('strings', chord('string_ensemble_1', tri, dur * sec, .35, attack=.08, release=.4), t0 * k)
                mx.add('bass', note('contrabass', r, dur * sec * .9, .6, release=.2), t0 * k)
            elif style == 'fanfare':
                for q in range(int(dur)):
                    mx.add('bass', note('tuba', r + (7 if q % 2 else 0), .5 * sec, .8, release=.1), (t0 + q) * k)
                    mx.add('brass', chord('brass_section', tri, .25 * sec, .3, release=.1), (t0 + q + .5) * k)
            elif style == 'pizz':
                for q in range(int(dur)):
                    mx.add('strings', note('pizzicato_strings', r + 12 + (7 if q % 2 else 0), .4 * sec, .55, release=.2), (t0 + q) * k)
    # Batterie
    for b in range(-intro, mesures):
        t0 = debut + b * metre
        if style == 'pop':
            for q in range(metre):
                if q % 2 == 0:
                    mx.add('kick', kick(.8), (t0 + q) * k)
                else:
                    mx.add('drums', clap(.5), (t0 + q) * k)
                mx.add('drums', hat(.25), (t0 + q + .5) * k)
                mx.add('drums', shaker(.15), (t0 + q + .25) * k)
        elif style == 'fanfare':
            for q in range(metre):
                mx.add('kick', kick(.6), (t0 + q) * k) if q % 2 == 0 else mx.add('drums', snare(.4, tight=True), (t0 + q) * k)
        elif style == 'valse':
            mx.add('drums', hat(.2), (t0 + 1) * k)
            mx.add('drums', hat(.2), (t0 + 2) * k)
    if style in ('pop', 'fanfare'):
        mx.add('drums', crash(.25), debut * k)
    y = mx.render(duck=.25 if style == 'pop' else 0, verb=1.0)
    # 20 s au plus, fondu final de 1,5 s
    n = min(len(y), int(20 * SR))
    y = y[:n].copy()
    f = int(1.5 * SR)
    y[-f:] *= np.linspace(1, 0, f)[:, None] ** 1.5
    return y

PIECES = {
    'frere_jacques': lambda: piece('Frère Jacques', 112, 4,
        'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 F4:1 G4:2 E4:1 F4:1 G4:2 '
        'G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1 G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1 C4:1 G3:1 C4:2 C4:1 G3:1 C4:2',
        ['C', 'C', 'C', 'C', 'C', 'C', 'C/G', 'C/G'], 'marimba', octave=1),
    'au_clair_de_la_lune': lambda: piece('Au clair de la lune', 104, 4,
        'C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 '
        'C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 '
        'D4:1 D4:1 D4:1 D4:1 A3:2 A3:2 D4:1 C4:1 B3:1 A3:1 G3:4',
        ['C', 'C/G', 'C/G', 'C', 'C', 'C/G', 'C/G', 'C', 'G', 'Dm', 'G', 'G'], 'flute', style='valse', octave=1),
    'ah_vous_dirai_je_maman': lambda: piece('Ah ! vous dirai-je, maman', 108, 4,
        'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 '
        'G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 '
        'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2',
        ['C', 'F/C', 'F/C', 'G/C', 'C/F', 'C/G', 'C/F', 'C/G'], 'music_box', octave=1),
    'joyeux_anniversaire': lambda: piece('Joyeux anniversaire', 100, 3,
        'R:2 G4:.75 G4:.25 A4:1 G4:1 C5:1 B4:2 G4:.75 G4:.25 A4:1 G4:1 D5:1 C5:2 G4:.75 G4:.25 '
        'G5:1 E5:1 C5:1 B4:1 A4:1 F5:.75 F5:.25 E5:1 C5:1 D5:1 C5:3',
        ['C', 'C', 'G', 'G', 'C', 'C7', 'F', 'C/G', 'C'], 'trumpet', style='valse'),
    'vive_le_vent': lambda: piece('Vive le vent', 120, 4,
        'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:.5 E4:4 '
        'F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5 E4:1 D4:1 D4:1 E4:1 D4:2 G4:2 '
        'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2 E4:1 G4:1 C4:1.5 D4:.5 E4:4 '
        'F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5 G4:1 G4:1 F4:1 D4:1 C4:4',
        ['C', 'C', 'C', 'C', 'F', 'C', 'D7', 'G', 'C', 'C', 'C', 'C', 'F', 'C', 'G', 'C'], 'tubular_bells', octave=1),
    'lettre_a_elise': lambda: piece('Lettre à Élise', 76, 3,
        'E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1 R:.5 C4:.5 E4:.5 A4:.5 B4:1 R:.5 E4:.5 G#4:.5 B4:.5 C5:1 R:.5 E4:.5 '
        'E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1 R:.5 C4:.5 E4:.5 A4:.5 B4:1 R:.5 E4:.5 C5:.5 B4:.5 A4:3',
        ['Am', 'Am', 'Am', 'E', 'Am', 'Am', 'Am', 'Am', 'E', 'Am'], 'acoustic_grand_piano', style='classique', intro=0),
    'hymne_a_la_joie': lambda: piece('Hymne à la joie', 116, 4,
        'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:.5 D4:2 '
        'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:.5 C4:2',
        ['C', 'G/C', 'C', 'G', 'C', 'G/C', 'C', 'G/C'], 'brass_section', style='fanfare', octave=1),
    'marche_turque': lambda: piece('Marche turque', 120, 2,
        'B4:.25 A4:.25 G#4:.25 A4:.25 C5:1 D5:.25 C5:.25 B4:.25 C5:.25 E5:1 '
        'F5:.25 E5:.25 D#5:.25 E5:.25 B5:.25 A5:.25 G#5:.25 A5:.25 B5:.25 A5:.25 G#5:.25 A5:.25 C6:1 '
        'A5:.5 C6:.5 B5:.5 A5:.5 G#5:.5 A5:.5 E5:1',
        ['Am', 'Am', 'Am', 'E/Am', 'Am', 'E', 'Am'], 'acoustic_grand_piano', style='pizz', repeter=3, intro=1),
    'antre_du_roi_de_la_montagne': lambda: piece("Dans l'antre du roi de la montagne", 132, 4,
        'A3:.5 B3:.5 C4:.5 D4:.5 E4:.5 C4:.5 E4:1 D#4:.5 B3:.5 D#4:1 D4:.5 Bb3:.5 D4:1 '
        'A3:.5 B3:.5 C4:.5 D4:.5 E4:.5 C4:.5 E4:.5 A4:.5 G4:.5 E4:.5 C4:.5 E4:.5 G4:2',
        ['Am', 'E/Dm', 'Am', 'C'], 'bassoon', style='pizz', repeter=3, intro=1),
    'le_printemps_vivaldi': lambda: piece('Le Printemps (Vivaldi)', 100, 4,
        'R:3.5 E4:.5 G#4:.5 G#4:.5 G#4:.5 F#4:.25 E4:.25 B4:1.5 B4:.25 A4:.25 G#4:.5 G#4:.5 G#4:.5 F#4:.25 E4:.25 B4:1.5 B4:.25 A4:.25 '
        'G#4:.5 A4:.5 B4:.5 A4:.5 G#4:1 F#4:1 E4:3',
        ['E', 'E', 'E', 'E/B', 'E'], 'violin', style='classique', repeter=2, octave=1, intro=0),
    'french_cancan': lambda: piece('French cancan (Offenbach)', 152, 4,
        'C5:2 C5:.5 D5:.5 F5:.5 E5:.5 D5:1 G5:1 G5:1 G5:.5 A5:.5 E5:.5 F5:.5 D5:1 D5:1 D5:.5 F5:.5 E5:.5 D5:.5 '
        'C5:.5 C6:.5 B5:.5 A5:.5 G5:.5 F5:.5 E5:.5 D5:.5 C5:2 R:2',
        ['C', 'G', 'G', 'C', 'C', 'C'], 'brass_section', style='fanfare', repeter=2),
    'la_cucaracha': lambda: piece('La cucaracha', 132, 4,
        'C4:.5 C4:.5 C4:.5 F4:1.5 A4:1 C4:.5 C4:.5 C4:.5 F4:1.5 A4:2 R:2 '
        'F4:1 F4:.5 E4:.5 E4:.5 D4:.5 D4:.5 C4:2.5 R:3',
        ['F', 'F', 'F', 'C7', 'C7', 'F'], 'trumpet', style='pop', repeter=2, octave=1),
}

if __name__ == '__main__':
    noms = sys.argv[2:] or list(PIECES)
    for nom in noms:
        y = PIECES[nom]()
        # Même niveau perçu pour tous les extraits : gain vers -15 dB RMS environ, crêtes tenues par un limiteur.
        rms = np.sqrt(np.mean(y ** 2) + 1e-12)
        y = y * (10 ** (-19.5 / 20) / rms)
        y = Pedalboard([Limiter(-1.5, 80)])(y.T.astype(np.float32).copy(), SR).T
        p = save('bt_' + nom, y, rms=20 * np.log10(np.sqrt(np.mean(y ** 2))), fade_tail=False)
        print(f'{nom:30s} {len(y) / SR:5.1f} s -> {p}', flush=True)
