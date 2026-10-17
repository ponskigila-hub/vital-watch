"""Run the SAME command on laptop and on LinuxONE and compare the printed numbers.
Usage:  python src/vm_check.py models/model_v1.txt data/training/training_setA/p000001.psv [more .psv ...]
Prints platform info and the model score at three hours per patient. Scores must match on both machines.
"""
import platform, sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import lightgbm as lgb
sys.path.insert(0, str(Path(__file__).parent))
from features import build_features, FEATURE_NAMES

model_path, files = sys.argv[1], sys.argv[2:]
print("machine:", platform.machine(), "| python", platform.python_version(),
      "| numpy", np.__version__, "| pandas", pd.__version__, "| lightgbm", lgb.__version__)
booster = lgb.Booster(model_file=model_path)
assert booster.num_feature() == len(FEATURE_NAMES), "feature count mismatch"
for f in files:
    df = pd.read_csv(f, sep="|")
    t0 = time.perf_counter()
    X = build_features(df)[FEATURE_NAMES].values
    s = booster.predict(X)
    ms = (time.perf_counter() - t0) * 1000
    n = len(s)
    picks = sorted({0, n // 2, n - 1})
    print(Path(f).stem, f"({n} h):", " ".join(f"h{i+1}={s[i]:.6f}" for i in picks), f"| {ms:.0f} ms for whole stay")