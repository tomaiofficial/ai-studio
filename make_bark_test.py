import sys, os, time
import numpy as np
import torch

_orig_load = torch.load


def _bark_load(*args, **kwargs):
    kwargs.setdefault("map_location", "cpu")
    kwargs["weights_only"] = False
    return _orig_load(*args, **kwargs)


torch.load = _bark_load

import scipy.io.wavfile
import bark

print("== preloading models (small, CPU) ==")
t0 = time.time()
bark.preload_models(
    text_use_gpu=False,
    text_use_small=True,
    coarse_use_gpu=False,
    coarse_use_small=True,
    fine_use_gpu=False,
    fine_use_small=True,
    codec_use_gpu=False,
    force_reload=False,
)
print("preload done in %.1fs" % (time.time() - t0))

text = "Bienvenue, c'est Astra, ton assistant vocal français."
print("== generating audio ==")
t0 = time.time()
try:
    audio = bark.generate_audio(text, silent=True, output_full=False)
    print("generate done in %.1fs" % (time.time() - t0))
except Exception as e:
    print("ERROR:", type(e).__name__, e)
    sys.exit(1)

sr = bark.SAMPLE_RATE
print("audio shape:", audio.shape, "dtype:", audio.dtype, "sr:", sr)
out = "C:/Users/tomg-/ai-studio-repo/bark-test.wav"
scipy.io.wavfile.write(out, sr, (audio * 32767).astype(np.int16))
print("wrote", out, "size", os.path.getsize(out), "bytes")
