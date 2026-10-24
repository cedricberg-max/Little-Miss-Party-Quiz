import sys, numpy as np
from PIL import Image
S = sys.argv[1]
C = [np.asarray(Image.open(f"{S}/bras{k}/c/s00.png").convert("RGB")).astype(np.float32)/255 for k in range(9)]
M = [np.asarray(Image.open(f"{S}/bras{k}/m/s00.png").convert("L")).astype(np.float32)/255 for k in range(9)]
x0=y0=10**9; x1=y1=0
for c, m in zip(C, M):
    a = np.maximum(m, c.max(2)); ys, xs = np.where(a > 1.5/255)
    x0=min(x0,xs.min()); y0=min(y0,ys.min()); x1=max(x1,xs.max()+1); y1=max(y1,ys.max()+1)
x0=max(0,x0-2); y0=max(0,y0-2); x1=min(1012,x1+2); y1=min(900,y1+2)
w, h = x1-x0, y1-y0
print("rect", x0, y0, w, h)
pl = np.zeros((3*h, 3*w, 4), np.float32)
for k in range(9):
    c = C[k][y0:y1, x0:x1]; m = M[k][y0:y1, x0:x1]
    a = np.maximum(m, c.max(2)); a = np.where(a < 1.5/255, 0, a)
    rgb = np.where(a[..., None] > 0, c / np.maximum(a, 1e-6)[..., None], 0)
    r, col = divmod(k, 3)
    pl[r*h:(r+1)*h, col*w:(col+1)*w, :3] = np.clip(rgb, 0, 1); pl[r*h:(r+1)*h, col*w:(col+1)*w, 3] = a
Image.fromarray((pl*255+.5).astype(np.uint8), "RGBA").save(sys.argv[2], "WEBP", quality=int(sys.argv[3]), alpha_quality=100, method=6, lossless=sys.argv[3]=="100")
