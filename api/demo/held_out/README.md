# Held-out demo patient recordings

These seven original PSV recordings and the accompanying manifest were supplied by the model trainer from the PhysioNet/CinC Challenge 2019 set A test split. The split assignment and selection method are trainer-supplied metadata, not independently audited here.

The backend seeds the recordings with neutral fictional display names. Existing patient records and care events are retained. The default family assignment remains p000001; these additional patients are not automatically shared with a family account.

The raw files retain their original label column for offline evaluation. The backend parser excludes `SepsisLabel` from clinical readings and inference. **`demo_patients.json` contains future outcomes/onset timings and is an offline evaluation guide only.** It is not loaded into clinical profiles, prompts, alerts, or model features. No files in this directory are served as public frontend assets.

The manifest's alert timings use `10pct_false_alert_patients` (exact model threshold 0.07189758650592362). The app retains the user-selected stricter 5% policy, threshold 0.09369306785703713. At that policy first crossings are p000802:53, p000574:57, p000185:60, p000346:64; p000021, p000132, and p000679 do not cross. Do not present the manifest's 10% categories/timings as 5% results. p000574 has 76 observations spanning hours 2–77. Do not select policies based on making held-out examples look better. The manifest intentionally includes a missed case and a false alarm.

| Recording | Fictional display name | Hours |
| --- | --- | --- |
| p000574 | Avery Morgan | 76 |
| p000679 | Casey Patel | 74 |
| p000185 | Riley Bennett | 65 |
| p000346 | Morgan Ellis | 64 |
| p000021 | Taylor Reed | 57 |
| p000132 | Jamie Park | 56 |
| p000802 | Alex Rivera | 55 |

Set `DEMO_HELD_OUT=false` to omit automatic additions on a fresh database. It does not delete previously added patients. `DEMO_SEED=false` disables startup seeding entirely. Startup is idempotent and detects recordings already imported by their content hash.

See [parent dataset attribution](../README.md), the preserved `PHYSIONET_LICENSE.txt`, and [PhysioNet source](https://physionet.org/content/challenge-2019/1.0.0/). The trainer's original README.txt and manifest are retained unchanged.
