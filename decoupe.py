"""Répartit les images de l'outro entre N machines et lance le rendu de la part n° IDX : python3 decoupe.py IDX N"""
import subprocess, sys, os, shutil, glob
IDX, NB = int(sys.argv[1]), int(sys.argv[2])
DEB = {1: 0, 2: 3, 3: 6, 4: 9, 5: 11, 6: 14, 7: 16.7, 8: 19.3, 9: 21.9, 10: 27, 11: 32, 12: 34.5, 14: 45, 15: 50, 16: 53, 17: 56, 18: 61, 19: 65, 20: 69, 21: 73, 22: 76, 23: 81, 24: 86, 25: 91, 26: 97, 27: 103, 28: 109, 29: 112}
LOCAL = {11, 12, 14, 29}                       # souvenirs (rendus sur place) et noir final
o = sorted(DEB); toutes = []
for i, s in enumerate(o[:-1]):
    if s in LOCAL: continue
    N = round((DEB[o[i + 1]] - DEB[s]) * 25); toutes += [(s, j, N) for j in range(N)]
part = len(toutes) / NB; mes = toutes[round(IDX * part):round((IDX + 1) * part)]
os.makedirs("sortie", exist_ok=True)
runs = []
for s, j, N in mes:
    if runs and runs[-1][0] == s and runs[-1][2] == j - 1: runs[-1][2] = j
    else: runs.append([s, j, j, N])
for s, a, b, N in runs:
    n = b - a + 1; tmp = f"tmp_{s}_{a}"
    subprocess.run(["node", "film.mjs", str(s), tmp, "1920", "1080", str(n), str(a / N), str(b / N)], check=True, env={**os.environ, "Q": "&porte=B&look=duel"})
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", "25", "-i", f"{tmp}/%05d.png", "-c:v", "libx264", "-crf", "12", "-preset", "slow", "-pix_fmt", "yuv420p", f"sortie/s{s:02d}_{a:04d}.mp4"], check=True)
    shutil.rmtree(tmp); print(f"plan {s} images {a}-{b} faites", flush=True)
