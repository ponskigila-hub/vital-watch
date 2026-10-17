"""Phase 2 step 1-2: validate every .psv, then make patient-level splits.
Run from repo root:  python src/inventory.py
"""
from pathlib import Path
import pandas as pd
from sklearn.model_selection import train_test_split

RAW = Path("data/training")
OUT = Path("data/splits"); OUT.mkdir(parents=True, exist_ok=True)
SEED = 42

rows, problems = [], []
notna = None
n_rows_total = 0
count = 0

for hosp in ["A", "B"]:
    for f in sorted((RAW / f"training_set{hosp}").glob("*.psv")):
        count += 1
        if count % 2000 == 0:
            print(f"{count} files...", flush=True)
        df = pd.read_csv(f, sep="|")
        if notna is None:
            cols = list(df.columns)
            notna = pd.Series(0, index=cols)
        if list(df.columns) != cols:
            problems.append((f.name, "header differs"))
            continue
        if not df["ICULOS"].is_monotonic_increasing or df["ICULOS"].duplicated().any():
            problems.append((f.name, "ICULOS not strictly increasing"))
        notna += df.notna().sum()
        n_rows_total += len(df)
        lab = df["SepsisLabel"]
        ever = lab.max() == 1
        rows.append(dict(
            patient_id=f.stem,
            hospital=hosp,
            n_hours=len(df),
            ever_sepsis=int(ever),
            first_label_hour=int(df.loc[lab == 1, "ICULOS"].min()) if ever else -1,
        ))

if not rows:
    raise SystemExit(f"Tidak ada file .psv di {RAW.resolve()} - cek path datanya")

inv = pd.DataFrame(rows)

# Patient-level split inside A (stratified by ever_sepsis); B kept as separate hospital check
A = inv[inv.hospital == "A"]
trainval, test = train_test_split(A, test_size=0.15, stratify=A.ever_sepsis, random_state=SEED)
train, val = train_test_split(trainval, test_size=0.1765, stratify=trainval.ever_sepsis, random_state=SEED)

inv["role"] = "b_check"
inv.loc[inv.patient_id.isin(train.patient_id), "role"] = "train"
inv.loc[inv.patient_id.isin(val.patient_id), "role"] = "val"
inv.loc[inv.patient_id.isin(test.patient_id), "role"] = "test"
inv.to_csv(OUT / "patients.csv", index=False)

print(f"\npatients: {len(inv)} | rows: {n_rows_total} | problems: {len(problems)}")
print(inv.groupby("role").agg(
    patients=("patient_id", "size"),
    sepsis_patients=("ever_sepsis", "sum"),
    median_hours=("n_hours", "median"),
))

miss = (1 - notna / n_rows_total).round(3).sort_values(ascending=False)
miss.to_csv(OUT / "missingness.csv", header=["missing_fraction"])
print("\nmost-missing columns:\n", miss.head(10).to_string())

if problems:
    pd.DataFrame(problems, columns=["file", "issue"]).to_csv(OUT / "problems.csv", index=False)
    print("see data/splits/problems.csv")