"""Little Miss Party : studio de production des musiques et sons du plateau (rendu hors ligne).

Instruments enregistrés : FluidR3 GM (CC BY 3.0, via pepperscore-sounds-complete).
Batterie, impacts, souffles et montées : synthèse maison.
"""
import base64, io, json, os, sys
import numpy as np
import soundfile as sf
from pedalboard import Pedalboard, Reverb, Compressor, Limiter, HighpassFilter, LowpassFilter, Chorus, Gain, LowShelfFilter, HighShelfFilter, PeakFilter

SR = 44100
BPM = 120
B = 60 / BPM  # durée d'un temps
HERE = os.path.dirname(os.path.abspath(__file__))
FL = os.path.join(HERE, 'pep/package/soundfonts/fluidr3/')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- échantillons
_cache = {}
def inst(name):
    if name in _cache:
        return _cache[name]
    d = json.load(open(FL + name + '.json'))['samples']
    out = {}
    for k, v in d.items():
        x, sr = sf.read(io.BytesIO(base64.b64decode(v)), dtype='float32', always_2d=True)
        if sr != SR:
            n = int(len(x) * SR / sr)
            x = np.stack([np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], 1)
        if x.shape[1] == 1:
            x = np.repeat(x, 2, axis=1)
        # retire le silence de tête du MP3 (au plus 60 ms)
        lead = np.argmax(np.abs(x).max(1) > 2e-3)
        x = x[min(lead, int(.06 * SR)):]
        out[int(k)] = x.astype(np.float32)
    _cache[name] = out
    return out

def env_ar(n, attack, rel_start, rel):
    e = np.ones(n, np.float32)
    a = int(attack * SR)
    if a > 0:
        e[:a] = np.linspace(0, 1, a) ** 1.5
    r0, r1 = int(rel_start * SR), int((rel_start + rel) * SR)
    if r0 < n:
        m = min(n, r1) - r0
        e[r0:r0 + m] *= np.cos(np.linspace(0, np.pi / 2, max(r1 - r0, 1)))[:m]
        e[min(n, r1):] = 0
    return e

def extend(x, need):
    """Prolonge une note tenue en bouclant son milieu, fondus à puissance constante."""
    if len(x) >= need:
        return x
    a, b, cf = int(1.0 * SR), len(x) - int(.2 * SR), int(.3 * SR)
    if b - a < 2 * cf:
        return x
    seg = x[a:b]
    out = x[:b].copy()
    fo = np.cos(np.linspace(0, np.pi / 2, cf))[:, None]; fi = np.sin(np.linspace(0, np.pi / 2, cf))[:, None]
    while len(out) < need:
        tail = out[-cf:] * fo + seg[:cf] * fi
        out = np.vstack([out[:-cf], tail, seg[cf:]])
    return out.astype(np.float32)

def note(name, midi, dur, vel=1.0, attack=0.0, release=0.25, detune=0.0):
    s = inst(name)
    k = min(s, key=lambda q: abs(q - midi))
    x = s[k]
    ratio = 2 ** ((midi - k + detune / 100) / 12)
    n = int((dur + release) * SR)
    x = extend(x, int(n * ratio) + 4)
    t = np.arange(n) * ratio
    t = t[t < len(x) - 1]
    y = np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(2)], 1)
    if len(y) < n:
        f = min(len(y), int(.05 * SR))
        y[-f:] *= np.linspace(1, 0, f)[:, None]
        y = np.vstack([y, np.zeros((n - len(y), 2), np.float32)])
    return (y * env_ar(n, attack, dur, release)[:, None] * vel).astype(np.float32)

def chord(name, notes, dur, vel=1.0, **kw):
    return sum_at([(note(name, m, dur, vel / np.sqrt(len(notes)), **kw), 0) for m in notes])

def sum_at(parts):
    n = max(int(t * SR) + len(y) for y, t in parts)
    out = np.zeros((n, 2), np.float32)
    for y, t in parts:
        i = int(t * SR)
        out[i:i + len(y)] += y
    return out

# ---------------------------------------------------------------- synthèse
def noise(n):
    return rng.standard_normal(n).astype(np.float32)

def onepole_lp(x, fc):
    from scipy.signal import lfilter
    a = np.exp(-2 * np.pi * fc / SR)
    return lfilter([1 - a], [1, -a], x).astype(np.float32)

def biquad(x, kind, fc, q=0.707):
    from scipy.signal import butter, sosfilt
    if kind == 'bp':
        lo, hi = fc / (2 ** (1 / (2 * q))), fc * (2 ** (1 / (2 * q)))
        sos = butter(2, [lo, min(hi, SR / 2 - 100)], 'bandpass', fs=SR, output='sos')
    else:
        sos = butter(2, fc, 'lowpass' if kind == 'lp' else 'highpass', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)

def sweep_bp(x, f0, f1, q=2.0, blocks=64):
    """Bande passante qui glisse de f0 à f1 (par blocs, fondus)."""
    n = len(x)
    out = np.zeros_like(x)
    edges = np.linspace(0, n, blocks + 1).astype(int)
    for i in range(blocks):
        f = f0 * (f1 / f0) ** (i / (blocks - 1))
        a, b = max(0, edges[i] - 512), min(n, edges[i + 1] + 512)
        seg = biquad(x[a:b], 'bp', f, q)
        w = np.ones(b - a)
        out[a:b] += (seg.T * w).T if seg.ndim > 1 else seg * w
    # normalisation du recouvrement
    cover = np.zeros(n)
    for i in range(blocks):
        a, b = max(0, edges[i] - 512), min(n, edges[i + 1] + 512)
        cover[a:b] += 1
    return (out.T / cover).T.astype(np.float32) if out.ndim > 1 else (out / cover).astype(np.float32)

def stereo(m, width=0.0, delay_ms=0.0):
    m = m.astype(np.float32)
    if delay_ms:
        d = int(delay_ms * SR / 1000)
        r = np.concatenate([np.zeros(d, np.float32), m[:-d]])
        return np.stack([m, r * (1 - width) + m * width], 1)
    return np.stack([m, m], 1)

def pan(y, p):  # p de -1 (gauche) à 1 (droite)
    l, r = np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)
    return y * np.array([l, r], np.float32) * np.sqrt(2)

def kick(vel=1.0):
    n = int(.42 * SR); t = np.arange(n) / SR
    f = 48 + 95 * np.exp(-t / .035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / .16)
    click = biquad(noise(n), 'hp', 2500) * np.exp(-t / .004) * .35
    y = np.tanh(2.2 * (body + click)) * .8
    return stereo(y * vel)

def clap(vel=1.0):
    n = int(.35 * SR); t = np.arange(n) / SR
    e = np.zeros(n)
    for k, o in enumerate([0, .009, .018, .028]):
        i = int(o * SR)
        e[i:] += np.exp(-(t[:n - i]) / (.006 if k < 3 else .11)) * (1 if k < 3 else 1.2)
    y = biquad(noise(n), 'bp', 1300, .9) * e * .9
    return stereo(y * vel, .3, 7)

def snare(vel=1.0, tight=False):
    n = int(.3 * SR); t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * 186 * t) * .6 + np.sin(2 * np.pi * 332 * t) * .3) * np.exp(-t / .045)
    sn = biquad(noise(n), 'bp', 3800, .7) * np.exp(-t / (.07 if tight else .14))
    y = np.tanh(1.5 * (tone * .7 + sn * 1.0)) * .8
    return stereo(y * vel, .2, 4)

HAT_F = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]
def hat(vel=1.0, open_=False):
    n = int((.45 if open_ else .07) * SR); t = np.arange(n) / SR
    m = sum(np.sign(np.sin(2 * np.pi * f * 1.9 * t)) for f in HAT_F) / 6
    m = biquad(m + noise(n) * .5, 'hp', 7500)
    y = m * np.exp(-t / (.13 if open_ else .018))
    return stereo(y * vel * .9, .4, 3)

def shaker(vel=1.0):
    n = int(.08 * SR); t = np.arange(n) / SR
    e = np.minimum(1, t / .012) * np.exp(-t / .03)
    return stereo(biquad(noise(n), 'bp', 6500, 1.2) * e * vel, .5, 5)

def sub_boom(vel=1.0, dur=1.4):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 30 + 60 * np.exp(-t / .12)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .5)
    y = np.tanh(1.6 * y)
    return stereo(y * vel)

def crash(vel=1.0, dur=3.0):
    rc = inst('reverse_cymbal')
    x = rc[min(rc, key=lambda q: abs(q - 60))][::-1].copy()  # cymbale inversée = crash
    lead = np.argmax(np.abs(x).max(1) > 1e-2)
    x = x[lead:lead + int(dur * SR)]
    t = np.arange(len(x)) / SR
    x = x * np.exp(-t / (dur / 2.2))[:, None]
    n = len(x)
    shimmer = biquad(noise(n), 'hp', 6000) * np.exp(-t / .6) * .1
    return ((x / (np.abs(x).max() + 1e-9)) * .8 + stereo(shimmer, .5, 9)) * vel

def reverse_swell(dur, vel=1.0):
    """Cymbale à l'envers qui culmine exactement à la fin."""
    rc = inst('reverse_cymbal')
    x = rc[min(rc, key=lambda q: abs(q - 60))].copy()
    peak = np.argmax(np.abs(x).max(1))
    x = x[:peak]
    n = int(dur * SR)
    if len(x) >= n:
        x = x[-n:]
    else:
        x = np.vstack([np.zeros((n - len(x), 2), np.float32), x])
    return x / (np.abs(x).max() + 1e-9) * vel

def noise_riser(dur, vel=1.0, f0=250, f1=9000):
    n = int(dur * SR); t = np.arange(n) / SR
    x = sweep_bp(noise(n), f0, f1, 2.2)
    e = (t / dur) ** 2.2
    return stereo(x * e * vel, .5, 11)

def whoosh(dur=.7, vel=1.0, peak=.18, f0=6000, f1=350):
    n = int(dur * SR); t = np.arange(n) / SR
    x = sweep_bp(noise(n), f0, f1, 1.6)
    e = np.where(t < peak, (t / peak) ** 2, np.exp(-(t - peak) / (dur / 4)))
    l = x * e; r = np.roll(x, int(.006 * SR)) * e
    # passage de gauche à droite
    p = np.linspace(-.8, .8, n)
    L = l * np.cos((p + 1) * np.pi / 4) * 1.4; R = r * np.sin((p + 1) * np.pi / 4) * 1.4
    return np.stack([L, R], 1).astype(np.float32) * vel

def roll(dur, vel=1.0, timpani_midi=43):
    """Roulement de caisse claire + timbales, crescendo, s'arrête net à la fin."""
    parts = []
    t, k = 0.0, 0
    while t < dur - .02:
        p = t / dur
        v = vel * (.25 + .75 * p ** 1.3) * (0.85 + .3 * rng.random())
        parts.append((snare(v * .55, tight=True), t))
        t += .072 - .035 * p
        k += 1
    tt = 0.0
    while tt < dur - .05:
        p = tt / dur
        parts.append((note('timpani', timpani_midi + (k % 2) * 0, .25, vel * (.3 + .7 * p) * .9, release=.25), tt))
        tt += .1 - .04 * p
    y = sum_at(parts)
    n = int(dur * SR)
    y = y[:n + int(.03 * SR)]
    y[n:] *= np.linspace(1, 0, len(y) - n)[:, None]
    return y

# ---------------------------------------------------------------- mixage
class Mix:
    def __init__(self, beats, tail=3.0):
        self.n = int((beats * B + tail) * SR)
        self.bus = {k: np.zeros((self.n, 2), np.float32) for k in ('kick', 'drums', 'bass', 'keys', 'strings', 'brass', 'bells', 'fx')}
        self.kicks = []

    def add(self, bus, y, beat, gain=1.0):
        i = int(round(beat * B * SR))
        if i >= self.n:
            return
        m = min(len(y), self.n - i)
        self.bus[bus][i:i + m] += y[:m] * gain
        if bus == 'kick':
            self.kicks.append(i)

    def render(self, duck=0.45, master_gain_db=0.0, verb=1.0):
        n = self.n
        # côté « pompe » : les instruments s'effacent sous chaque grosse caisse
        side = np.ones(n, np.float32)
        if self.kicks and duck > 0:
            L = int(.22 * SR)
            shape = 1 - duck * np.exp(-np.arange(L) / (.07 * SR))
            for i in self.kicks:
                m = min(L, n - i)
                side[i:i + m] = np.minimum(side[i:i + m], shape[:m])
        fx = {
            'kick': Pedalboard([HighpassFilter(28), Compressor(-8, 3, 2, 80)]),
            'drums': Pedalboard([HighpassFilter(120), Compressor(-14, 3, 3, 90), Reverb(room_size=.25, damping=.5, wet_level=.10 * verb, dry_level=.9, width=1)]),
            'bass': Pedalboard([HighpassFilter(35), LowpassFilter(2600), Compressor(-16, 4, 5, 120), Gain(2)]),
            'keys': Pedalboard([HighpassFilter(160), Chorus(rate_hz=.6, depth=.18, mix=.25), Reverb(room_size=.45, damping=.55, wet_level=.18 * verb, dry_level=.85, width=1)]),
            'strings': Pedalboard([HighpassFilter(140), HighShelfFilter(7000, 2), Reverb(room_size=.7, damping=.4, wet_level=.28 * verb, dry_level=.8, width=1)]),
            'brass': Pedalboard([HighpassFilter(120), PeakFilter(2800, 2.5, 1), Compressor(-14, 2.5, 5, 120), Reverb(room_size=.6, damping=.45, wet_level=.22 * verb, dry_level=.85, width=1)]),
            'bells': Pedalboard([HighpassFilter(400), Reverb(room_size=.75, damping=.3, wet_level=.32 * verb, dry_level=.8, width=1)]),
            'fx': Pedalboard([HighpassFilter(25), Reverb(room_size=.8, damping=.4, wet_level=.22 * verb, dry_level=.9, width=1)]),
        }
        mix = np.zeros((n, 2), np.float32)
        for k, y in self.bus.items():
            if not np.any(y):
                continue
            z = fx[k](y.T.copy(), SR).T
            if k in ('bass', 'keys', 'strings', 'brass', 'drums'):
                z = z * (side if k != 'drums' else (1 - (1 - side) * .4))[:, None]
            mix += z
        master = Pedalboard([HighpassFilter(25), LowShelfFilter(90, 1.0), Compressor(-12, 2.2, 8, 150), Gain(master_gain_db), Limiter(-1.2, 120)])
        return master(mix.T.copy(), SR).T

def loudness_norm(y, target_rms_db=-15.0):
    rms = np.sqrt(np.mean(y ** 2) + 1e-12)
    g = 10 ** (target_rms_db / 20) / rms
    y = y * g
    pk = np.abs(y).max()
    if pk > .95:
        y = y * (.95 / pk)
    return y

def save(name, y, beats=None, loop=False, rms=-15.0, fade_tail=True):
    y = loudness_norm(y, rms)
    if beats is not None and loop:
        n = int(round(beats * B * SR))
        y = y[:n]
    elif fade_tail:
        # coupe le silence final et fond les 80 dernières ms
        thr = 10 ** (-60 / 20)
        last = len(y) - np.argmax(np.abs(y[::-1]).max(1) > thr)
        y = y[:max(last, int(.05 * SR))]
        f = min(len(y), int(.08 * SR))
        y[-f:] *= np.linspace(1, 0, f)[:, None]
    wav = os.path.join(OUT, name + '.wav')
    sf.write(wav, y, SR, subtype='PCM_16')
    return wav

# ---------------------------------------------------------------- harmonie
# Do majeur, accords à 7e : Fmaj7 - Em7 - Dm7 - Cmaj7, logo sonore sol-do-si-MI (sur Cmaj7).
CH = {
    'F': ([53, 57, 60, 64], 41), 'Em': ([52, 55, 59, 62], 40), 'Dm': ([50, 53, 57, 60], 38),
    'C': ([55, 59, 60, 64], 36), 'G': ([55, 59, 62, 65], 43), 'Gs': ([55, 60, 62, 65], 43),
    'Am': ([52, 55, 57, 60], 45),
}
PROG8 = ['F', 'Em', 'Dm', 'C', 'F', 'Em', 'Dm', 'G']
LOGO = [(67, 0, .5), (72, .5, .25), (71, .75, .25), (76, 1, 3)]  # (note, temps, durée en temps)

def groove(mx, bar0, bars, prog, level='full'):
    """Rythmique disco-pop sur `bars` mesures à partir de la mesure bar0."""
    for bi in range(bars):
        name = prog[bi % len(prog)]
        notes, root = CH[name]
        b0 = (bar0 + bi) * 4
        last = bi == bars - 1
        for q in range(4):
            bb = b0 + q
            mx.add('kick', kick(1.0 if level == 'full' else .7), bb)
            if level == 'full' and q in (1, 3):
                mx.add('drums', clap(.75), bb)
            if level == 'light' and q in (1, 3):
                mx.add('drums', snare(.18, tight=True), bb)
            mx.add('drums', hat(.5 if level == 'full' else .35, open_=True), bb + .5)
            for s in (.25, .75):
                mx.add('drums', hat(.28 if level == 'full' else .2), bb + s)
            for s in (0, .25, .5, .75):
                mx.add('drums', shaker(.22 if level == 'full' else .16), bb + s)
        # basse disco en octaves
        bassp = [(0, 0), (.5, 12), (1, 0), (1.5, 12), (2, 0), (2.5, 12), (3, 7), (3.5, 12)] if level == 'full' else [(0, 0), (1.5, 0), (2, 7), (3.5, 12)]
        for o, iv in bassp:
            mx.add('bass', note('electric_bass_finger', root + iv, B * .42, .95 if level == 'full' else .75, release=.06), b0 + o)
        # cordes tenues
        mx.add('strings', chord('string_ensemble_1', [m + 12 for m in notes], 4 * B - .05, .55 if level == 'full' else .45, attack=.12, release=.35), b0)
        # piano électrique en contretemps
        for o in ((.5, 1.5, 2.5, 3.5) if level == 'full' else (0, 1.5, 2.5)):
            mx.add('keys', chord('electric_piano_1', notes, B * .4, .55 if level == 'full' else .6, release=.15), b0 + o)
        if level == 'full':
            # guitare funk étouffée en doubles croches
            gnotes = [notes[1] + 12, notes[2] + 12, notes[3] + 12]
            for s in range(16):
                if s % 4 in (1, 3) or s in (6, 14):
                    mx.add('keys', pan(chord('electric_guitar_muted', gnotes, B * .18, .35, release=.03), -.45), b0 + s * .25)
            # cuivres : ponctuation sur le « et » du 4
            mx.add('brass', chord('brass_section', [m + 12 for m in notes[1:]], B * .35, .5, release=.12), b0 + 3.5)
        else:
            # cordes pizzicato en arpège : ambiance « réflexion »
            arp = [notes[0] + 12, notes[2] + 12, notes[1] + 24, notes[3] + 12]
            for s in range(8):
                mx.add('strings', note('pizzicato_strings', arp[s % 4], B * .4, .5, release=.1), b0 + s * .5)

def logo_phrase(mx, beat, inst_list=(('brass', 'brass_section', 0, .9), ('bells', 'glockenspiel', 24, .55)), slow=1.0):
    for (m, o, d) in LOGO:
        for bus, ins, tr, v in inst_list:
            mx.add(bus, note(ins, m + tr, d * B * slow, v, release=.4 if bus != 'bells' else 1.2), beat + o * slow)

# ================================================================ pièces
def bed(level):
    mx = Mix(8 * 4 * 3, tail=0.5)
    groove(mx, 0, 24, PROG8, level)
    if level == 'full':
        # accroche mélodique aux cordes + cuivres sur la 2e moitié de chaque boucle
        hook = [(72, 0, .5), (71, .5, .5), (69, 1, .5), (67, 1.5, 1.5), (64, 3.5, .5), (67, 4, .5), (71, 4.5, .5), (74, 5, 2), (72, 7, 1)]
        for rep in range(3):
            base = rep * 32 + 16
            for m, o, d in hook:
                mx.add('strings', note('violin', m + 12, d * B, .45, attack=.03, release=.25), base + o)
                mx.add('bells', note('glockenspiel', m + 12, d * B, .18, release=.8), base + o)
            for m, o, d in hook:
                mx.add('strings', note('violin', m + 12, d * B, .4, attack=.03, release=.25), base + 8 + o)
    y = mx.render(duck=.4 if level == 'full' else .3)
    n = int(32 * B * SR)
    return y[n:2 * n]

def generique():
    mx = Mix(16, tail=3)
    # 0-4 : roulement de timbales, cordes en trémolo qui montent, cymbale à l'envers
    mx.add('fx', roll(4 * B, .9, 43), 0)
    mx.add('fx', reverse_swell(4 * B, .7), 0)
    mx.add('fx', noise_riser(4 * B, .35), 0)
    for i, m in enumerate([55, 57, 59, 60, 62, 64, 65, 67]):
        mx.add('strings', chord('tremolo_strings', [m, m + 12], B * .5, .35 + .07 * i, release=.1), i * .5)
    # 4 : impact + logo aux cuivres, carillon et cordes
    mx.add('fx', sub_boom(1.0), 4); mx.add('fx', crash(.9, 4), 4)
    mx.add('brass', note('orchestra_hit', 60, 1.0, .9, release=.5), 4)
    mx.add('drums', note('taiko_drum', 41, .8, 1.0), 4)
    logo_phrase(mx, 4, (('brass', 'brass_section', 0, 1.0), ('brass', 'trumpet', 12, .55), ('bells', 'glockenspiel', 24, .6), ('strings', 'string_ensemble_1', 0, .6)))
    mx.add('strings', chord('string_ensemble_1', [48, 55, 59, 64, 67], 3.5 * B, .8, attack=.05, release=.6), 5)
    mx.add('bass', note('electric_bass_finger', 36, 3 * B, 1.0), 5)
    mx.add('drums', note('timpani', 36, 1.5, .9), 5)
    # 8-16 : la rythmique démarre, réponse mélodique aux cuivres
    groove(mx, 2, 2, ['F', 'Gs'], 'full')
    answer = [(76, 0, .5), (74, .5, .5), (72, 1, .5), (74, 1.5, .5), (76, 2, 1.5), (79, 4, .5), (77, 4.5, .5), (76, 5, .5), (74, 5.5, 2.5)]
    for m, o, d in answer:
        mx.add('brass', note('brass_section', m, d * B, .75, release=.3), 8 + o)
        mx.add('strings', note('violin', m + 12, d * B, .35, attack=.02, release=.3), 8 + o)
    mx.add('fx', reverse_swell(2 * B, .5), 14)
    return mx.render(duck=.35)

def tension(beats=10):
    """Tension de fin de chrono : 10 temps (5 s) pour les questions, 20 temps (10 s) pour les mimes."""
    mx = Mix(beats, tail=.1)
    n8 = 2 * beats
    for i in range(n8):  # croches : pédale de basse sur sol, tic-tac, timbales sur les temps
        bb = i * .5
        p = i / n8
        mx.add('bass', note('synth_bass_1', 43 if i % 2 == 0 else 55, B * .4, .8, release=.05), bb)
        mx.add('drums', note('woodblock', 84 if i % 2 == 0 else 79, .1, .55 + .3 * p), bb)
        if i % 2 == 0:
            mx.add('kick', kick(.6 + .4 * p), bb)
            mx.add('fx', note('timpani', 43, .3, .4 + .5 * p), bb)
    # cordes en trémolo qui montent chromatiquement
    for k in range(beats):
        m = 67 + k * 10 // beats
        mx.add('strings', chord('tremolo_strings', [m - 12, m], B, .35 + .5 * k / beats, release=.08), k)
    mx.add('fx', noise_riser(5 * B, .3, 400, 10000), beats - 5)
    mx.add('fx', reverse_swell(4 * B, .45), beats - 4)
    y = mx.render(duck=.25)
    return y[:int(beats * B * SR)]

def riser_4b():
    mx = Mix(4, tail=.05)
    mx.add('fx', noise_riser(4 * B, .5), 0)
    mx.add('fx', reverse_swell(4 * B, .6), 0)
    mx.add('fx', roll(4 * B, .55, 43), 0)
    for i, m in enumerate([60, 62, 64, 65, 67, 69, 71, 72]):
        mx.add('strings', chord('tremolo_strings', [m, m + 12], B * .5, .25 + .06 * i, release=.05), i * .5)
    y = mx.render(duck=0)
    return y[:int(4 * B * SR) + int(.02 * SR)]

def impact():
    mx = Mix(1, tail=3)
    mx.add('fx', sub_boom(1.0, 1.6), 0)
    mx.add('fx', crash(.8, 3), 0)
    mx.add('drums', note('taiko_drum', 38, 1, 1.0), 0)
    mx.add('brass', note('orchestra_hit', 55, 1, .7, release=.5), 0)
    return mx.render(duck=0)

def round_sting():
    mx = Mix(2, tail=3)
    mx.add('brass', chord('brass_section', [60, 64, 67, 72], 1.5 * B, 1.0, release=.5), 0)
    mx.add('brass', note('orchestra_hit', 60, 1, .6), 0)
    mx.add('drums', note('timpani', 36, 1.2, 1.0), 0)
    for m, o in ((79, 0), (84, .5)):
        mx.add('bells', note('glockenspiel', m + 12, .6, .5, release=1), o)
    return mx.render(duck=0)

def whoosh_snd():
    mx = Mix(1, tail=1)
    mx.add('fx', whoosh(.75, .9), 0)
    mx.add('fx', reverse_swell(.25, .15), 0)
    return mx.render(duck=0)

def pop(i):
    mx = Mix(1, tail=1)
    m = [72, 76, 79, 84][i]
    mx.add('bells', note('marimba', m, .25, .9, release=.3), 0)
    mx.add('bells', note('xylophone', m + 12, .15, .35, release=.2), 0)
    n = int(.06 * SR); t = np.arange(n) / SR
    f = 500 * (1.8 ** (t / .06))
    mx.add('fx', stereo(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .02) * .4), 0)
    return mx.render(duck=0)

def tick_answer():
    mx = Mix(1, tail=1)
    mx.add('bells', note('celesta', 88, .2, .8, release=.6), 0)
    mx.add('bells', note('kalimba', 76, .2, .6, release=.4), 0)
    mx.add('bells', note('tinkle_bell', 96, .2, .25, release=.6), .1)
    return mx.render(duck=0)

def lock_clac():
    mx = Mix(1, tail=1.2)
    mx.add('drums', snare(1.0, tight=True), 0)
    mx.add('drums', note('woodblock', 72, .1, 1.0), 0)
    mx.add('fx', sub_boom(.6, .5), 0)
    n = int(.03 * SR); t = np.arange(n) / SR
    mx.add('fx', stereo(biquad(noise(n), 'hp', 3000) * np.exp(-t / .006) * .9, .4, 3), 0)
    mx.add('brass', note('orchestra_hit', 48, .3, .35, release=.3), 0)
    return mx.render(duck=0)

def drumroll(beats):
    mx = Mix(beats, tail=.05)
    mx.add('fx', roll(beats * B, .85, 43), 0)
    mx.add('fx', reverse_swell(beats * B, .35), 0)
    y = mx.render(duck=0, verb=.6)
    return y[:int(beats * B * SR) + int(.02 * SR)]

def wrong_off():
    mx = Mix(1, tail=1)
    mx.add('strings', note('pizzicato_strings', 52, .2, .8, release=.2), 0)
    mx.add('bells', note('vibraphone', 64, .25, .25, release=.5), 0)
    n = int(.25 * SR); t = np.arange(n) / SR
    mx.add('fx', stereo(sweep_bp(noise(n), 3000, 600, 1.5) * np.exp(-t / .07) * .35, .4, 5), 0)
    return mx.render(duck=0)

def reveal_chime():
    mx = Mix(4, tail=3)
    logo_phrase(mx, 0, (('bells', 'glockenspiel', 24, .75), ('bells', 'celesta', 12, .5), ('bells', 'vibraphone', 12, .45), ('brass', 'brass_section', 0, .65)))
    mx.add('brass', chord('brass_section', [55, 59, 64, 67, 72], 2.5 * B, .8, attack=.04, release=.8), 1)
    mx.add('strings', chord('string_ensemble_1', [48, 55, 64, 71, 76], 3 * B, .7, attack=.06, release=1), 1)
    mx.add('fx', crash(.55, 3), 1)
    for k in range(10):
        mx.add('bells', note('tinkle_bell', 96 + (k % 5) * 2, .2, .18, release=.5), 1 + k * .12)
    return mx.render(duck=0)

def stamp():
    mx = Mix(1, tail=1)
    mx.add('drums', note('taiko_drum', 45, .5, .9), 0)
    mx.add('drums', clap(.6), 0)
    mx.add('bells', note('glockenspiel', 91, .2, .3, release=.5), 0)
    return mx.render(duck=0)

def points_bling():
    mx = Mix(4, tail=2)
    for k, m in enumerate([84, 88, 91, 96, 100]):
        mx.add('bells', note('glockenspiel', m, .25, .6, release=.8), k * .18)
        mx.add('bells', note('celesta', m - 12, .25, .3, release=.6), k * .18)
    for k in range(12):
        mx.add('bells', note('tinkle_bell', 100 + (k % 3) * 3, .1, .12, release=.4), 1 + k * .08)
    return mx.render(duck=0)

def points_count():
    mx = Mix(4, tail=1.5)
    for k in range(24):
        mx.add('bells', note('celesta', 76 + (k % 12), .08, .35 + .02 * k, release=.15), k * (3.2 / 24))
    mx.add('bells', note('glockenspiel', 96, .4, .5, release=1), 3.3)
    return mx.render(duck=0)

def crown_hit():
    mx = Mix(4, tail=3)
    mx.add('fx', sub_boom(.8), 0); mx.add('fx', crash(.8, 3.5), 0)
    mx.add('brass', note('orchestra_hit', 60, 1, .8), 0)
    mx.add('brass', chord('brass_section', [60, 64, 67, 72, 76], 2 * B, .95, release=.7), 0)
    mx.add('drums', note('timpani', 36, 1.2, 1.0), 0)
    for m, o in ((84, .5), (88, .75), (91, 1)):
        mx.add('bells', note('glockenspiel', m + 12, .5, .5, release=1.2), o)
    return mx.render(duck=0)

def team_sting(i):
    a, b = [(72, 79), (74, 81), (76, 83), (77, 84)][i]
    mx = Mix(2, tail=2)
    mx.add('brass', note('brass_section', a, .5 * B, .85, release=.2), 0)
    mx.add('brass', note('brass_section', b, 1.0 * B, .95, release=.4), .5)
    mx.add('bells', note('glockenspiel', a + 12, .3, .45, release=.8), 0)
    mx.add('bells', note('glockenspiel', b + 12, .5, .5, release=1), .5)
    mx.add('drums', note('taiko_drum', 43, .5, .55), 0)
    return mx.render(duck=0)

def victory_fanfare():
    mx = Mix(12, tail=4)
    groove(mx, 0, 3, ['C', 'F', 'C'], 'full')
    fan = [(67, 0, .5), (72, .5, .25), (71, .75, .25), (76, 1, 1.5), (76, 2.5, .25), (74, 2.75, .25), (72, 3, .5), (74, 3.5, .5),
           (76, 4, .5), (79, 4.5, .5), (77, 5, .5), (76, 5.5, .5), (74, 6, 1), (79, 7, 1)]
    for m, o, d in fan:
        mx.add('brass', note('brass_section', m, d * B, 1.0, release=.3), o)
        mx.add('brass', note('trumpet', m + 12, d * B, .45, release=.25), o)
        mx.add('strings', note('violin', m + 12, d * B, .4, attack=.02, release=.3), o)
    # montée des cordes puis accord final tenu
    for k, m in enumerate([67, 69, 71, 72, 74, 76, 77, 79]):
        mx.add('strings', note('string_ensemble_1', m + 12, .14, .55, release=.06), 7.5 + k * .0625 * 2)
    mx.add('brass', chord('brass_section', [60, 64, 67, 72, 76], 4 * B, 1.0, attack=.03, release=1.2), 8)
    mx.add('brass', note('trumpet', 84, 4 * B, .5, release=1), 8)
    mx.add('strings', chord('string_ensemble_1', [48, 60, 67, 76, 84], 4 * B, .9, attack=.05, release=1.5), 8)
    mx.add('drums', note('timpani', 36, 2, 1.0), 8); mx.add('fx', crash(1.0, 4), 8); mx.add('fx', sub_boom(.8), 8)
    mx.add('fx', roll(1 * B, .6, 36), 7)
    mx.add('bass', note('electric_bass_finger', 36, 4 * B, 1.0), 8)
    for k in range(8):
        mx.add('bells', note('glockenspiel', [84, 88, 91, 96][k % 4], .3, .4, release=1), 8 + k * .25)
    return mx.render(duck=.3)

def applause():
    a = inst('applause')
    srcs = [v for k, v in a.items() if 52 <= k <= 68]
    parts = []
    t = 0.0
    while t < 8:
        x = srcs[rng.integers(len(srcs))]
        seg = x[:int(min(len(x) / SR, 2.5) * SR)] * (0.5 + .5 * rng.random())
        f = int(.3 * SR)
        e = np.ones(len(seg)); e[:f] = np.linspace(0, 1, f); e[-f:] = np.linspace(1, 0, f)
        parts.append((pan(seg * e[:, None], rng.uniform(-.7, .7)), t))
        t += .35
    y = sum_at(parts)
    n = int(8 * SR); y = y[:n]
    tt = np.arange(len(y)) / SR
    e = np.minimum(1, tt / .4) * np.minimum(1, (8 - tt) / 2.5)
    y = y * e[:, None]
    # quelques « youhou » de fête ? non : uniquement des applaudissements et des cris aigus évitent le kitsch
    mx = Mix(16, tail=1)
    mx.add('fx', y, 0)
    return mx.render(duck=0)

def prize_bells():
    mx = Mix(4, tail=2)
    for k, m in enumerate([72, 76, 79, 84]):
        mx.add('bells', note('tubular_bells', m, .6, .55, release=1.2), k * .32)
        mx.add('bells', note('glockenspiel', m + 12, .3, .35, release=.8), k * .32)
    return mx.render(duck=0)

def end_jingle():
    mx = Mix(8, tail=4)
    mx.add('keys', chord('electric_piano_1', [55, 59, 60, 64], 4 * B, .7, release=1), 0)
    mx.add('keys', chord('electric_piano_1', [53, 57, 60, 64], 2 * B, .6, release=1), 4)
    mx.add('keys', chord('electric_piano_1', [48, 55, 59, 64, 67], 2 * B, .7, release=2), 6)
    mx.add('strings', chord('string_ensemble_1', [60, 64, 67, 71], 8 * B, .5, attack=.4, release=2), 0)
    logo_phrase(mx, 0, (('bells', 'music_box', 24, .6), ('bells', 'celesta', 12, .4)), slow=2.0)
    mx.add('bells', note('glockenspiel', 96, 1, .3, release=2), 6)
    mx.add('bass', note('electric_bass_finger', 36, 2 * B, .6, release=1), 6)
    return mx.render(duck=0)

# ---------------------------------------------------------------- mimes
def mime_go():
    """Top départ : coup de sifflet d'arbitre, puis les cuivres lancent le tour."""
    mx = Mix(2, tail=2.5)
    mx.add('fx', note('whistle', 96, .16, .8, release=.04), 0)
    mx.add('fx', note('whistle', 96, .4, 1.0, release=.08), .5)
    mx.add('brass', chord('brass_section', [60, 64, 67, 72], 1 * B, 1.0, release=.4), 1)
    mx.add('brass', note('orchestra_hit', 60, .8, .6), 1)
    mx.add('kick', kick(1.0), 1)
    mx.add('fx', crash(.6, 2.5), 1)
    for m, o in ((84, 1), (91, 1.25)):
        mx.add('bells', note('glockenspiel', m + 12, .4, .45, release=1), o)
    return mx.render(duck=0)

def mime_found():
    """Mime trouvé : arpège doré qui monte, clap et petit coup de cuivres, paillettes."""
    mx = Mix(3, tail=2)
    for k, m in enumerate([72, 76, 79, 84]):
        mx.add('bells', note('glockenspiel', m + 12, .2, .7, release=.8), k * .125)
        mx.add('bells', note('marimba', m, .2, .6, release=.3), k * .125)
    mx.add('brass', chord('brass_section', [67, 72, 76], .75 * B, .75, release=.3), .5)
    mx.add('drums', clap(.8), .5)
    mx.add('kick', kick(.8), .5)
    for k in range(8):
        mx.add('bells', note('tinkle_bell', 100 + (k % 3) * 3, .1, .15, release=.4), .6 + k * .08)
    return mx.render(duck=0)

def mime_pass():
    """Carte passée : souffle et trois notes qui descendent, sans rien de vexant."""
    mx = Mix(1.5, tail=1)
    mx.add('fx', whoosh(.5, .8, f0=5000, f1=500), 0)
    for k, m in enumerate([67, 64, 60]):
        mx.add('strings', note('pizzicato_strings', m, .15, .8, release=.15), .1 + k * .25)
        mx.add('bells', note('marimba', m, .15, .45, release=.2), .1 + k * .25)
    return mx.render(duck=0)

def mime_time_up():
    """Temps écoulé : long coup de sifflet, puis « ta-daa » des cuivres et timbales."""
    mx = Mix(4, tail=3)
    mx.add('fx', note('whistle', 91, .9, 1.0, release=.15), 0)
    mx.add('brass', chord('brass_section', [55, 59, 62, 67], .5 * B, .9, release=.2), 1)
    mx.add('brass', chord('brass_section', [48, 55, 60, 64, 72], 2 * B, 1.0, release=.8), 1.5)
    mx.add('brass', note('orchestra_hit', 48, 1, .7), 1.5)
    mx.add('drums', note('timpani', 36, 1.5, 1.0), 1.5)
    mx.add('fx', crash(.8, 3), 1.5)
    mx.add('fx', sub_boom(.7), 1.5)
    return mx.render(duck=0)

PIECES = {
    'generique': (generique, -14.5), 'bed_full': (lambda: bed('full'), -15.5), 'bed_light': (lambda: bed('light'), -18.5),
    'tension': (tension, -16), 'riser_4b': (riser_4b, -17), 'impact': (impact, -15), 'round_sting': (round_sting, -15),
    'whoosh': (whoosh_snd, -21), 'tick_answer': (tick_answer, -21), 'lock_clac': (lock_clac, -15),
    'drumroll_2b': (lambda: drumroll(2), -17), 'drumroll_4b': (lambda: drumroll(4), -17), 'wrong_off': (wrong_off, -21),
    'reveal_chime': (reveal_chime, -16), 'stamp': (stamp, -19), 'points_bling': (points_bling, -20), 'points_count': (points_count, -21),
    'crown_hit': (crown_hit, -15), 'victory_fanfare': (victory_fanfare, -14.5), 'applause': (applause, -20), 'prize_bells': (prize_bells, -19),
    'end_jingle': (end_jingle, -17),
    'mime_go': (mime_go, -15), 'mime_found': (mime_found, -18), 'mime_pass': (mime_pass, -21),
    'mime_time_up': (mime_time_up, -15), 'mime_tension': (lambda: tension(20), -16),
}
for i in range(4):
    PIECES[f'pop_{i + 1}'] = ((lambda i=i: pop(i)), -22)
    PIECES[f'team_sting_{i + 1}'] = ((lambda i=i: team_sting(i)), -17)
LOOPS = {'bed_full': 32, 'bed_light': 32}

if __name__ == '__main__':
    only = sys.argv[2:] or list(PIECES)
    for name in only:
        fn, rms = PIECES[name]
        y = fn()
        p = save(name, y, beats=LOOPS.get(name), loop=name in LOOPS, rms=rms, fade_tail=name not in LOOPS and name not in ('tension', 'mime_tension', 'riser_4b', 'drumroll_2b', 'drumroll_4b'))
        print(f'{name:16s} {len(y) / SR:6.2f} s  -> {p}', flush=True)
