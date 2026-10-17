"""Shared feature builder for training AND serving.

Rule: the features of row t use ONLY rows t-23..t (24 hourly rows, oldest first).
Nothing from the future, nothing from before the window.

Rows within one patient are consecutive hours (verified on the dataset).
Many patients can be processed at once: they are separated by PAD NaN rows so
no window / forward-fill can cross from one patient into the next.
"""
import numpy as np
import pandas as pd

FEATURE_VERSION = "v1"
WINDOW = 24            # hourly rows visible to a prediction
PAD = 2 * WINDOW       # NaN rows between patients: forward-fill reaches 23 rows into the pad, shift(6) 6 more -> 48 is safe

VITALS = ["HR", "O2Sat", "Temp", "SBP", "MAP", "DBP", "Resp"]
LABS = ["BaseExcess", "HCO3", "FiO2", "pH", "PaCO2", "SaO2", "AST", "BUN",
        "Alkalinephos", "Calcium", "Chloride", "Creatinine", "Bilirubin_direct",
        "Glucose", "Lactate", "Magnesium", "Phosphate", "Potassium",
        "Bilirubin_total", "TroponinI", "Hct", "Hgb", "PTT", "WBC",
        "Fibrinogen", "Platelets"]
DEMOGRAPHICS = ["Age", "Gender", "HospAdmTime", "ICULOS"]   # Unit1/Unit2 left out on purpose
INPUT_COLUMNS = (VITALS + ["EtCO2"] + LABS + DEMOGRAPHICS + ["Unit1", "Unit2"])  # SepsisLabel is never an input


def _age_and_last(col: pd.Series):
    """last value seen within the window + hours since it was measured (NaN if none in window)."""
    pos = pd.Series(np.arange(len(col), dtype="float64"), index=col.index)
    last_pos = pos.where(col.notna()).ffill()
    age = pos - last_pos
    last = col.ffill(limit=WINDOW - 1)
    age = age.where(age <= WINDOW - 1)
    return last, age


def _compute(d: pd.DataFrame) -> pd.DataFrame:
    out = {}
    for v in VITALS:
        raw = d[v]
        last, age = _age_and_last(raw)
        r24 = raw.rolling(WINDOW, min_periods=1)
        r6 = raw.rolling(6, min_periods=1)
        mean24 = r24.mean()
        out[f"{v}_last"] = last
        out[f"{v}_age"] = age
        out[f"{v}_n24"] = r24.count()
        out[f"{v}_mean6"] = r6.mean()
        out[f"{v}_mean24"] = mean24
        out[f"{v}_min24"] = r24.min()
        out[f"{v}_max24"] = r24.max()
        out[f"{v}_std24"] = r24.std()
        # value 6h ago counts only if its source measurement is still inside t's 24h window
        prev = last.shift(6).where(age.shift(6) <= WINDOW - 1 - 6)
        out[f"{v}_delta6"] = last - prev
        out[f"{v}_dev24"] = last - mean24
    for l in LABS:
        last, age = _age_and_last(d[l])
        out[f"{l}_last"] = last
        out[f"{l}_age"] = age
    out["shock_index"] = out["HR_last"] / out["SBP_last"]
    for c in DEMOGRAPHICS:
        out[c] = d[c]
    return pd.DataFrame(out)


FEATURE_NAMES = list(_compute(pd.DataFrame({c: [np.nan] * 3 for c in INPUT_COLUMNS})).columns)


def build_features(patient: pd.DataFrame) -> pd.DataFrame:
    """One patient, rows oldest->newest. Returns one feature row per input row."""
    d = patient.reset_index(drop=True)
    f = _compute(d.reindex(columns=INPUT_COLUMNS))
    return f[FEATURE_NAMES]


def build_features_many(patients: list) -> pd.DataFrame:
    """Many patients at once (training). Same maths as build_features, separated by PAD NaN rows."""
    pad = pd.DataFrame(np.nan, index=range(PAD), columns=INPUT_COLUMNS)
    parts, keep = [], []
    start = 0
    for p in patients:
        p = p.reindex(columns=INPUT_COLUMNS)
        parts += [pad, p]
        start += PAD
        keep.append(np.arange(start, start + len(p)))
        start += len(p)
    big = pd.concat(parts + [pad], ignore_index=True)
    f = _compute(big)
    idx = np.concatenate(keep)
    return f.iloc[idx][FEATURE_NAMES].reset_index(drop=True)