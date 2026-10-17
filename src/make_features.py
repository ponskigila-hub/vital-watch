"""Build cached feature matrices per split role (train / val / test / b_check).
Run:  python src/make_features.py
Output: data/features/{role}_X.npy (float32), {role}_y.npy, {role}_meta.csv, feature_names.json
"""
import json, sys, time
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
from features import build_features_many, FEATURE_NAMES, FEATURE_VERSION

RAW = Path("data/training")
OUT = Path("data/features"); OUT.mkdir(parents=True, exist_ok=True)
pat = pd.read_csv("data/splits/patients.csv")
CHUNK = 2000   # patients per batch, keeps memory small

t0 = time.time()
for role in ["train", "val", "test", "b_check"]:
    ids = pat[pat.role == role]
    Xs, ys, metas = [], [], []
    for i in range(0, len(ids), CHUNK):
        part = ids.iloc[i:i + CHUNK]
        dfs = [pd.read_csv(RAW / f"training_set{h}" / f"{pid}.psv", sep="|")
               for pid, h in zip(part.patient_id, part.hospital)]
        X = build_features_many(dfs)
        Xs.append(X.values.astype(np.float32))
        ys.append(np.concatenate([d["SepsisLabel"].values for d in dfs]).astype(np.int8))
        metas.append(pd.DataFrame({
            "patient_id": np.concatenate([[pid] * len(d) for pid, d in zip(part.patient_id, dfs)]),
            "ICULOS": np.concatenate([d["ICULOS"].values for d in dfs])}))
        print(f"{role}: {min(i + CHUNK, len(ids))}/{len(ids)} patients ({time.time() - t0:.0f}s)", flush=True)
    np.save(OUT / f"{role}_X.npy", np.vstack(Xs))
    np.save(OUT / f"{role}_y.npy", np.concatenate(ys))
    pd.concat(metas, ignore_index=True).to_csv(OUT / f"{role}_meta.csv", index=False)

json.dump({"feature_version": FEATURE_VERSION, "names": FEATURE_NAMES}, open(OUT / "feature_names.json", "w"))
print("done", f"{time.time() - t0:.0f}s")