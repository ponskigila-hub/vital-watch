"""Train baseline (logistic regression) + LightGBM, pick thresholds on VAL only, report on val/test/b_check.
Run:  python src/train.py
Needs: pip install lightgbm numpy pandas scikit-learn
"""
import json, sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEAT = Path("data/features")
names = json.load(open(FEAT / "feature_names.json"))["names"]
pat = pd.read_csv("data/splits/patients.csv").set_index("patient_id")
FALSE_ALERT_TARGETS = [0.05, 0.10, 0.20]     # share of non-sepsis patients allowed to get >=1 alert


def load(role):
    X = np.load(FEAT / f"{role}_X.npy")
    y = np.load(FEAT / f"{role}_y.npy")
    meta = pd.read_csv(FEAT / f"{role}_meta.csv")
    return X, y, meta


def operating_point(score, meta, thr):
    """Patient-level view of alerts at a threshold. Sepsis onset = first label hour + 6 (labels are pre-shifted)."""
    d = meta.copy()
    d["alert"] = score >= thr
    d["start"] = d.alert & ~(d.groupby("patient_id").alert.shift(1, fill_value=False))
    g = d.groupby("patient_id", sort=False)
    p = pd.DataFrame({
        "hours": g.size(),
        "any_alert": g.alert.max(),
        "episodes": g.start.sum(),
        "first_alert": d[d.alert].groupby("patient_id").ICULOS.min(),
    }).join(pat[["ever_sepsis", "first_label_hour"]])
    neg, pos = p[p.ever_sepsis == 0], p[p.ever_sepsis == 1].copy()
    pos["onset"] = pos.first_label_hour + 6
    detected = pos.first_alert.notna() & (pos.first_alert <= pos.onset)
    lead = (pos.onset - pos.first_alert)[detected]
    return {
        "threshold": float(thr),
        "sepsis_patients_detected_by_onset": float(detected.mean()),
        "median_lead_hours_before_onset": float(lead.median()) if len(lead) else None,
        "nonsepsis_patients_with_alert": float(neg.any_alert.mean()),
        "alert_episodes_per_100_patient_days_nonsepsis": float(neg.episodes.sum() / (neg.hours.sum() / 24) * 100),
    }


def pick_thresholds(score, meta):
    d = meta.copy(); d["s"] = score
    pmax = d.groupby("patient_id").s.max()
    neg_max = pmax[pat.loc[pmax.index, "ever_sepsis"].values == 0]
    return {f"{int(r * 100)}pct_false_alert_patients": float(np.quantile(neg_max, 1 - r)) for r in FALSE_ALERT_TARGETS}


t0 = time.time()
Xtr, ytr, mtr = load("train"); Xva, yva, mva = load("val")
print(f"train rows {len(ytr)} (pos {ytr.mean():.3%}) | val rows {len(yva)} (pos {yva.mean():.3%})", flush=True)

# 1) simple baseline
lr = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(max_iter=300))
lr.fit(Xtr, ytr)
lr_val = lr.predict_proba(Xva)[:, 1]
print(f"[baseline LR] val AUROC {roc_auc_score(yva, lr_val):.4f}  AUPRC {average_precision_score(yva, lr_val):.4f}  ({time.time()-t0:.0f}s)", flush=True)

# 2) LightGBM (early stopping on VAL; test and B are not touched until the end)
model = lgb.LGBMClassifier(
    n_estimators=800, learning_rate=0.05, num_leaves=31, min_child_samples=200,
    subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=10.0,
    random_state=42, n_jobs=-1, verbose=-1)
model.fit(Xtr, ytr, eval_set=[(Xva, yva)], eval_metric="average_precision",
          callbacks=[lgb.early_stopping(60, verbose=False)], feature_name=names)
va = model.predict_proba(Xva)[:, 1]
print(f"[LightGBM]    val AUROC {roc_auc_score(yva, va):.4f}  AUPRC {average_precision_score(yva, va):.4f}  best_iter {model.best_iteration_}  ({time.time()-t0:.0f}s)", flush=True)

Path("models").mkdir(exist_ok=True); Path("results").mkdir(exist_ok=True)
model.booster_.save_model("models/model_v1.txt")          # text format: portable across architectures

# 3) thresholds chosen on VAL only
thresholds = pick_thresholds(va, mva)
json.dump(thresholds, open("models/thresholds_v1.json", "w"), indent=2)

# 4) final report: val (selection set), test (set A), b_check (set B), same thresholds
report = {"model_version": "v1", "feature_version": json.load(open(FEAT / "feature_names.json"))["feature_version"],
          "best_iteration": int(model.best_iteration_), "thresholds_from_val": thresholds, "splits": {}}
for role in ["val", "test", "b_check"]:
    X, y, meta = load(role)
    s = model.predict_proba(X)[:, 1]
    row = {"rows": int(len(y)), "positive_row_rate": float(y.mean()),
           "AUROC": float(roc_auc_score(y, s)), "AUPRC": float(average_precision_score(y, s)),
           "operating_points": {k: operating_point(s, meta, t) for k, t in thresholds.items()}}
    if role in ("val", "test"):
        row["baseline_LR_AUROC"] = float(roc_auc_score(y, lr.predict_proba(X)[:, 1]))
    report["splits"][role] = row
    print(f"\n== {role}: AUROC {row['AUROC']:.4f} AUPRC {row['AUPRC']:.4f}")
    for k, v in row["operating_points"].items():
        print(f"  {k}: detected by onset {v['sepsis_patients_detected_by_onset']:.1%} | median lead {v['median_lead_hours_before_onset']} h | "
              f"non-sepsis pts alerted {v['nonsepsis_patients_with_alert']:.1%} | episodes/100 pt-days {v['alert_episodes_per_100_patient_days_nonsepsis']:.1f}")

imp = pd.Series(model.booster_.feature_importance("gain"), index=names).sort_values(ascending=False)
report["top_features_by_gain"] = {k: float(v) for k, v in imp.head(20).items()}
json.dump(report, open("results/eval_v1.json", "w"), indent=2)
print("\ntop features:", ", ".join(imp.head(10).index), f"\nsaved models/model_v1.txt, models/thresholds_v1.json, results/eval_v1.json ({time.time()-t0:.0f}s)")