"""Does IBM Snap ML run our LightGBM model, and does it use the IBM Z AI accelerator on this machine?
Usage:  python src/snapml_check.py models/model_v1.txt demo/p000001.psv demo/p000002.psv demo/p100001.psv
Needs:  pip install snapml        (on the LinuxONE VM; install problems are a result worth reporting)
Prints: which tree format Snap ML chose, whether its scores equal LightGBM's, and batch/single timings (model step only).
"""
import platform, statistics, sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import lightgbm as lgb
from snapml import BoostingMachineClassifier
sys.path.insert(0, str(Path(__file__).parent))
from features import build_features, FEATURE_NAMES

model_path, files = sys.argv[1], sys.argv[2:]
print("machine:", platform.machine(), "| lightgbm", lgb.__version__)
X = np.vstack([build_features(pd.read_csv(f, sep="|").drop(columns="SepsisLabel", errors="ignore"))[FEATURE_NAMES].values
               for f in files]).astype(np.float32)
print("feature rows:", len(X))
ref = lgb.Booster(model_file=model_path).predict(X)


def timed(fn, x, reps=30):
    fn(x)
    t = []
    for _ in range(reps):
        t0 = time.perf_counter(); fn(x); t.append((time.perf_counter() - t0) * 1000)
    return statistics.median(t)


def batch(n):
    return np.tile(X, (n // len(X) + 1, 1))[:n]


lgb_booster = lgb.Booster(model_file=model_path)
for fmt in ["auto", "compress_trees", "zdnn_tensors"]:
    try:
        m = BoostingMachineClassifier()
        m.import_model(model_path, "lightgbm", tree_format=fmt)
        got = m.predict_proba(X)[:, 1]
    except Exception as e:                                   # e.g. zdnn_tensors without an accelerator
        print(f"\n[{fmt}] not available here: {type(e).__name__}: {str(e)[:200]}")
        continue
    used = getattr(getattr(m, "booster_", None), "optimized_tree_format_", "?")
    print(f"\n[{fmt}] optimized_tree_format_ = {used}")
    print(f"  max |snapml - lightgbm| over {len(X)} rows: {np.abs(got - ref).max():.2e}")
    for n in (1, 100, 2000):
        xb = batch(n)
        print(f"  batch {n:5d}: snapml {timed(lambda a: m.predict_proba(a), xb):8.3f} ms | lightgbm {timed(lgb_booster.predict, xb):8.3f} ms")