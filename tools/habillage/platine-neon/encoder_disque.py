import sys, subprocess, numpy as np
from PIL import Image
S = sys.argv[1]; out = sys.argv[2]; crf = sys.argv[3]
W, H, B = 1008, 900, 20
ff = subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{2*H+B}","-r","25","-i","-",
    "-c:v","libx264","-profile:v","high","-preset","veryslow","-level","4.2","-x264-params","ref=4","-crf",crf,"-g","91","-keyint_min","91","-sc_threshold","0",
    "-vf","scale=out_color_matrix=bt709:out_range=tv","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709","-color_range","tv","-pix_fmt","yuv420p","-movflags","+faststart","-an",out], stdin=subprocess.PIPE)
for i in range(91):
    c = np.asarray(Image.open(f"{S}/disque/c/f{i:04d}.png").convert("RGB"))[:, :W]
    m = np.asarray(Image.open(f"{S}/disque/m/f{i:04d}.png").convert("L"))[:, :W]
    f = np.zeros((2*H+B, W, 3), np.uint8)
    f[:H] = c; f[H+B:] = m[..., None]
    ff.stdin.write(f.tobytes())
ff.stdin.close(); ff.wait()
