"""Local CPU inference using the trainer's versioned, causal feature builder."""
from bisect import bisect_right
import hashlib
import json
import logging
from pathlib import Path
import threading

from .schemas import Factor, PredictionRequest, PredictionResult, SepsisOutput

log = logging.getLogger(__name__)
POLICIES = ("5pct_false_alert_patients", "10pct_false_alert_patients", "20pct_false_alert_patients")
LIMITATIONS = [
    "Uncalibrated research model score, not a probability of diagnosis or a treatment recommendation.",
    "Alert thresholds were selected on the trainer's validation set; they do not guarantee the same false-alert rate for these patients.",
    "Personal-baseline detector and language model are not connected. Synthetic streams are interface demonstrations, not validation data.",
]


def feature_observation_hours(feature, request):
    """Identify measurements used by this feature, without attributing absent data."""
    if feature == "shock_index":
        return sorted(set(feature_observation_hours("HR_last", request) + feature_observation_hours("SBP_last", request)))
    if feature in ("Age", "Gender", "HospAdmTime", "ICULOS"):
        return [request.as_of_hour] if request.history[-1].get(feature) is not None else []
    measurement, suffix = feature.rsplit("_", 1)
    observed = [r for r in request.history if r.get(measurement) is not None]
    if suffix in ("last", "age"):
        return [int(observed[-1]["ICULOS"])] if observed else []
    if suffix == "mean6":
        observed = [r for r in observed if r["ICULOS"] > request.as_of_hour - 6]
    elif suffix == "delta6":
        past = [r for r in observed if r["ICULOS"] <= request.as_of_hour - 6]
        observed = ([observed[-1]] if observed else []) + ([past[-1]] if past else [])
    elif suffix in ("min24", "max24") and observed:
        extreme = (min if suffix == "min24" else max)(r[measurement] for r in observed)
        observed = [r for r in observed if r[measurement] == extreme]
    return sorted(set(int(r["ICULOS"]) for r in observed))


class LightGBMPrediction:
    kind = "lightgbm"

    def __init__(self, model_path: Path, thresholds_path: Path, policy=POLICIES[0]):
        self.ready = False
        self.error = None
        self.key = "lightgbm-unavailable"
        self.policy = policy
        self.lock = threading.Lock()
        try:
            import lightgbm as lgb
            from src.features import FEATURE_NAMES, FEATURE_VERSION, build_features
            if policy not in POLICIES:
                raise ValueError("Unsupported SEPSIS_ALERT_POLICY")
            self.thresholds = json.loads(thresholds_path.read_text())
            if set(self.thresholds) != set(POLICIES) or not all(0 < self.thresholds[p] < 1 for p in POLICIES):
                raise ValueError("Invalid model thresholds")
            if not self.thresholds[POLICIES[0]] > self.thresholds[POLICIES[1]] > self.thresholds[POLICIES[2]]:
                raise ValueError("Model thresholds must be strictly ordered")
            self.threshold = float(self.thresholds[policy])
            lower = [v for v in self.thresholds.values() if v < self.threshold]
            self.watch_threshold = max(lower) if lower else self.threshold
            self.booster = lgb.Booster(model_file=str(model_path))
            if self.booster.feature_name() != FEATURE_NAMES:
                raise ValueError("The model's feature order differs from src/features.py")
            self.feature_names, self.feature_version = FEATURE_NAMES, FEATURE_VERSION
            self.build_features = build_features
            fingerprint = hashlib.sha256(model_path.read_bytes() + thresholds_path.read_bytes() + Path(__file__).resolve().parents[2].joinpath("src/features.py").read_bytes() + Path(__file__).read_bytes() + policy.encode() + lgb.__version__.encode()).hexdigest()
            self.key = "v1-" + fingerprint[:24]
            self.ready = True
        except Exception:
            self.error = "Model could not load. Check dependencies, artifact paths, feature order, and threshold configuration in the backend logs."
            log.exception("Sepsis model initialization failed")

    def status(self):
        return {"provider": self.kind, "status": "connected" if self.ready else "unavailable", "model_version": "v1", "feature_version": "v1", "model_key": self.key, "alert_policy": self.policy, "alert_threshold": self.threshold if self.ready else None, "reason": self.error, "runtime": "CPU · one inference thread", "limitations": LIMITATIONS}

    def unavailable(self, request, reason=None, status="unavailable"):
        return PredictionResult(patient_id=request.patient_id, as_of_hour=request.as_of_hour, status=status, origin="model", model_version="v1", feature_version="v1", sepsis=SepsisOutput(status=status), data_quality={"reason": reason or self.error or "Model unavailable"}, limitations=LIMITATIONS)

    def eligible(self, request):
        if not request.history or request.history[-1]["ICULOS"] != request.as_of_hour:
            return "No new observation exists at this patient hour; no new score was calculated."
        hours = [int(r["ICULOS"]) for r in request.history]
        if hours != list(range(hours[0], request.as_of_hour + 1)):
            return "Model v1 requires consecutive hourly rows. Gaps are displayed in history but are not compressed into adjacent model hours."
        if not any(row.get(k) is not None for row in request.history for k in ("HR", "O2Sat", "Temp", "SBP", "MAP", "DBP", "Resp")):
            return "No physiological observations are available within the model window."
        return None

    def score(self, request):
        if not self.ready:
            return self.unavailable(request)
        return self.score_recording(request.patient_id, request.history, [request.as_of_hour])[request.as_of_hour]

    def score_recording(self, patient_id, rows, hours):
        """Batch causal rows for backfill; one shared feature pass, bounded by max requested hour."""
        import numpy as np
        import pandas as pd
        from .schemas import READING_COLUMNS
        cutoff = max(hours)
        rows = [{k: r.get(k) for k in READING_COLUMNS} for r in rows if r["ICULOS"] <= cutoff]
        row_hours = [r["ICULOS"] for r in rows]
        requests = {hour: PredictionRequest(patient_id=patient_id, as_of_hour=hour, history=rows[bisect_right(row_hours, hour - 24):bisect_right(row_hours, hour)]) for hour in hours}
        results, valid = {}, []
        for hour, request in requests.items():
            reason = self.eligible(request) if self.ready else self.error
            if reason:
                results[hour] = self.unavailable(request, reason, "insufficient_history" if self.ready else "unavailable")
            else:
                valid.append(hour)
        if not valid:
            return results
        try:
            frame = pd.DataFrame(rows).astype(float)
            indexes = {int(row["ICULOS"]): i for i, row in enumerate(rows)}
            features = self.build_features(frame).iloc[[indexes[h] for h in valid]][self.feature_names]
            values = features.to_numpy(dtype=float)
            invalid = np.isinf(values).any(axis=1)
            for index in np.flatnonzero(invalid):
                hour = valid[index]
                results[hour] = self.unavailable(requests[hour], "A derived feature contains infinity; inspect source measurements.")
            valid = [hour for index, hour in enumerate(valid) if not invalid[index]]
            values = values[~invalid]
            if not valid:
                return results
            with self.lock:
                scores = self.booster.predict(values, num_threads=1)
                contributions = self.booster.predict(values, pred_contrib=True, num_threads=1)
            for i, hour in enumerate(valid):
                score = float(scores[i])
                if not np.isfinite(score) or not 0 <= score <= 1 or not np.isfinite(contributions[i]).all():
                    raise ValueError("Non-finite or invalid model output")
                band = "High" if score >= self.threshold else "Moderate" if score >= self.watch_threshold else "Low"
                factors = []
                for index in np.argsort(np.abs(contributions[i][:-1]))[-5:][::-1]:
                    feature, value = self.feature_names[index], values[i][index]
                    observations = feature_observation_hours(feature, requests[hour]) if np.isfinite(value) else []
                    factors.append(Factor(feature=feature, value=float(value) if np.isfinite(value) else None, contribution=float(contributions[i][index]), observation_hours=observations))
                results[hour] = PredictionResult(patient_id=patient_id, as_of_hour=hour, status="partial", origin="model", model_version="v1", feature_version=self.feature_version, sepsis=SepsisOutput(status="ok", score=score, band=band, alert=score >= self.threshold, alert_threshold=self.threshold, alert_policy=self.policy, factors=factors), data_quality={"history_rows": len(requests[hour].history), "model_key": self.key, "watch_threshold": self.watch_threshold, "contribution_units": "SHAP contributions to the raw model margin (log-odds); positive increases the score, negative decreases it. Not causal explanations."}, limitations=LIMITATIONS)
        except Exception:
            log.exception("Sepsis inference failed for patient %s", patient_id)
            for hour in valid:
                results[hour] = self.unavailable(requests[hour], "Inference failed. No replacement score was fabricated; check backend logs.")
        return results
