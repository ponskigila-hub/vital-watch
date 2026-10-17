"""Checks that training and serving build identical features and never use the future.
Run:  python src/test_features.py
"""
import glob, random, sys
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
from features import build_features, build_features_many, WINDOW

TOL = dict(rtol=1e-5, atol=1e-4, equal_nan=True)   # rolling std has ~1e-7 float noise
random.seed(1)
files = random.sample(sorted(glob.glob("data/training/training_set*/*.psv")), 150)
P = [pd.read_csv(f, sep="|") for f in files]

many = build_features_many(P)
off, bad = 0, 0
for p in P:
    s = build_features(p)
    m = many.iloc[off:off + len(p)].reset_index(drop=True); off += len(p)
    bad += int(not np.allclose(s.values, m.values, **TOL))
print(f"batch (training) vs single (serving): mismatching patients = {bad} of {len(P)}")

bad = n = 0
for p in P:
    full = build_features(p)
    for t in range(0, len(p), 3):
        w = p.iloc[max(0, t - WINDOW + 1):t + 1]          # what the backend would send
        n += 1
        bad += int(not np.allclose(build_features(w).iloc[-1].values, full.iloc[t].values, **TOL))
print(f"last-24-rows window vs full history: mismatches = {bad} of {n}")

bad = 0
for p in P:
    t = len(p) // 2
    bad += int(not np.allclose(build_features(p.iloc[:t + 1]).iloc[-1].values,
                               build_features(p).iloc[t].values, **TOL))
print(f"adding future rows changes an earlier hour: {bad} of {len(P)}")