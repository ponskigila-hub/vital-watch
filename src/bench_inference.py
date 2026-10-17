"""Measure single-request scoring latency on THIS machine (CPU). Run on laptop and on LinuxONE.
Usage:  python src/bench_inference.py models/model_v1.txt demo/p000001.psv [more .psv ...]
Each request = the last 24 hourly rows for one patient/hour -> features -> model score (what /score does).
"""
import platform, statistics, sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import lightgbm as lgb
sys.path.insert(0, str(Path(__file__).parent))
from features import build_features, FEATURE_NAMES, WINDOW

model_path, files = sys.argv[1], sys.argv[2:]
booster = lgb.Booster(model_file=model_path)
print("machine:", platform.machine(), "| python", platform.python_version(), "| numpy", np.__version__,
      "| pandas", pd.__version__, "| lightgbm", lgb.__version__)
windows = []
for f in files:
    df = pd.read_csv(f, sep="|").drop(columns="SepsisLabel", errors="ignore")
    for t in range(6, len(df)):
        windows.append(df.iloc[max(0, t - WINDOW + 1):t + 1])
if not windows:
    raise SystemExit("no windows: need patients with at least 7 hourly rows")
reps = max(1, 300 // len(windows) + 1)
feat_ms, pred_ms = [], []
for _ in range(3):                                   # warm-up
    booster.predict(build_features(windows[0]).iloc[[-1]][FEATURE_NAMES].values)
for _ in range(reps):
    for w in windows:
        t0 = time.perf_counter()
        x = build_features(w).iloc[[-1]][FEATURE_NAMES].values
        t1 = time.perf_counter()
        booster.predict(x)
        t2 = time.perf_counter()
        feat_ms.append((t1 - t0) * 1000); pred_ms.append((t2 - t1) * 1000)
tot = np.array(feat_ms) + np.array(pred_ms)
pct = lambda a, q: float(np.percentile(a, q))
print(f"requests: {len(tot)} (single patient, <=24-row window, CPU, one process)")
print(f"feature build : median {statistics.median(feat_ms):6.1f} ms | p95 {pct(feat_ms,95):6.1f} ms")
print(f"model predict : median {statistics.median(pred_ms):6.2f} ms | p95 {pct(pred_ms,95):6.2f} ms")
print(f"end-to-end    : median {statistics.median(tot):6.1f} ms | p95 {pct(tot,95):6.1f} ms | max {tot.max():.1f} ms")