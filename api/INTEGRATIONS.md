# Prediction and language integration

## Connected sepsis model

`inference.LightGBMPrediction` loads `models/model_v1.txt` and `models/thresholds_v1.json` once on startup. It imports `src.features.build_features`, `FEATURE_NAMES`, and `FEATURE_VERSION` from the trainer's implementation. The artifact must match all 127 feature names in the exact order. NumPy, pandas, LightGBM, and a working platform OpenMP runtime are required. No network/model API is used.

Set `PREDICTION_PROVIDER=lightgbm` (default). Existing `.env` files with `disconnected` must be updated explicitly. Configure artifact paths and `SEPSIS_ALERT_POLICY` with the settings documented in the root README. Model load failures are logged and exposed as unavailable without fixture fallback. `disconnected` is an explicit developer fixture mode only.

### Data and results

`PredictionRequest` accepts at most 24 records within the latest 24 patient-hours, in ascending order through `as_of_hour`. JSON missing values are `null`. Only original PhysioNet inputs are accepted; labels, names, fictional clinical context, and caregiver notes are excluded. Import permits hourly gaps for displaying history; **model v1 refuses scoring a window with gaps** because its rolling calculations assume consecutive hourly rows. Missing fields inside an existing hourly row stay missing. No new score is generated when there is no row at the selected hour, or when no physiological observation exists in the window.

Startup/import/seek and the background clock call `score_through()`. Batch feature generation is causal and bounded by the requested cutoff. Tests compare this path against the trainer's batch implementation and single 24-hour serving windows. `PredictionRun` stores versioned results; the fingerprint includes model, thresholds, feature code, adapter code, policy, and LightGBM version. Dashboard polling does not trigger inference. Inference failures persist as unavailable with no numeric score; the background processor may retry after 30 seconds. The processor also scores hours skipped by accelerated playback.

The top five absolute SHAP contributions are calculated by LightGBM's `pred_contrib` path. Values are contributions to the **raw model margin (log-odds)**, not probability changes or clinical causes. An unavailable feature value remains null. The UI distinguishes those contributions from measured trends. Aggregate feature-importance values in the trainer's report are not substituted for patient-specific contributions.

### Threshold and alert policy

Default policy: `5pct_false_alert_patients`, threshold `0.09369306785703713`. The 10% and 20% operating points are also configurable. These were selected by the trainer on validation-set non-sepsis patient maxima. They do not establish an individual patient's risk or guarantee a false-alert rate in another population. The model score is not claimed to be calibrated.

The display band is High at/above the selected threshold, Moderate at/above the next lower supplied threshold (if present), and Low below that. Low does not rule out sepsis. A score becoming high creates a saved alert; consecutive high hours do not create repeat alerts. Falling below then crossing again creates another episode. Saved caregiver acknowledgement remains separate from the score and follows the replay cutoff. Alerts and score histories are excluded from family responses. Clinician review priorities remain separate audit events.

Sepsis results return `status=ok`; the combined prediction returns `partial` because the personal-baseline detector is still unavailable. Model v1 has not been independently clinically validated here. `results/eval_v1.json` is the trainer's report. LinuxONE compatibility and acceleration remain unverified; local CPU inference is the tested path.

## Remaining prediction work

Implement `PredictionProvider.score(PredictionRequest) -> PredictionResult` for future adapters while preserving causal inputs and matching preprocessing. Personal-baseline results are separate from sepsis output. Descriptive period comparisons are not a trained anomaly detector. Do not invent baseline scores or threshold values.

Generated schemas are in `templates/contracts/`; disconnected example payloads remain as reference fixtures. Any new adapter must preserve unavailable/null semantics, provenance, feature/model versions, family restrictions, and input-quality explanations.

## Gemini / educational language integration

The official `google-genai` backend adapter supports guidance, chat, and AI handovers. It is off by default. Configure `LANGUAGE_PROVIDER=gemini`, `GEMINI_API_KEY` and `GEMINI_MODEL` in the ignored `api/.env`, then restart. Never put the key in frontend variables, screenshots, commits or logs. Model selection never falls back to a paid model automatically.

This is an educational hackathon simulation, not clinical practice or medical advice. Google’s API terms prohibit clinical-practice use and disallow sensitive/personal information in unpaid services: https://ai.google.dev/gemini-api/terms. Actual free allocation/model access depends on the Google project. Check Google AI Studio before the demo.

### Shared evidence boundary

`language.snapshot()` assembles at most the previous 24 hours, latest values with original observation times, six-hour period means/counts, stored research scores and model contributions, cutoff-appropriate alert status, allowlisted focus/priority, and explicitly approved fictional context. Future measurements and SepsisLabel never enter requests. Model results are evidence; Gemini cannot change them. Context is capped at 48,000 serialized characters. Oversized contexts fail without sending. Request text is capped at 4,000 characters and recent conversation at six messages of 1,200 characters.

Only exact bundled demo streams are eligible. New imports are not approved by ID/name. Existing bundled streams are verified against local source files/deterministic fixtures before migration approval; legacy free-text profiles stay excluded. Editing a profile revokes context approval. New caregiver notes are omitted unless the author checks the fictional/demo-content option. Chat requires that confirmation for each new question; recent confirmed chat is bounded and scoped to the same user, patient, replay, and cutoff. Known patient display names and email patterns are redacted, but this is not a clinical de-identification service. Never enter real personal data.

### Persistence and execution

Migration 003 adds durable language jobs, provenance fields, and suggested-action state. A separate worker runs one external request at a time without holding a database transaction across the network. Default minimum interval is 10 seconds, timeout 20 seconds, output budget 2,048 tokens. An SDK request still finishing after timeout blocks another external call. Quota errors establish a 60-second cooldown, with explicit retry rather than repeated attempts. API failures expose sanitized messages, not raw errors or credentials.

The live replay clock enqueues guidance only for newly raised model alerts in its forward transition. Startup scoring, historical backfill, paused seeks, and GET requests do not generate a backlog. Manual generation works at the current selected hour. Jobs reuse an operation/snapshot/question/user/model/version cache key. Interrupted running jobs become unavailable on restart and need explicit retry; queued jobs remain durable. Archived replay jobs are not processed. The backend must still run with one application worker.

### HTTP interfaces

- `POST /api/v1/patients/{id}/guidance`: `{session_id, retry?: boolean}`; 202 with generation ID/status.
- `GET /api/v1/patients/{id}/guidance`: latest job, last successful guidance, earlier flag, eligibility, and earlier planned tasks through the replay cutoff.
- `GET /api/v1/language/jobs/{id}`: clinician-only result/evidence; questions additionally require the originating user.
- `POST /api/v1/guidance/{id}/actions/{action_id}`: `{session_id, status: accepted|dismissed|completed}`. Acceptance is a planned action; completion is separate. Older guidance cannot accept new actions, and duplicate planned catalogue tasks are blocked.
- Existing messages endpoint: `{session_id, text, demo_content_confirmed:true}` queues a user-scoped response when Gemini is enabled. The workspace supplies completed messages and pending job state.
- Existing handover endpoint: `{session_id, mode:template|gemini}`; template is the backward-compatible default. Gemini returns a generation job, with the eventual editable draft in workspace handovers. Edited/newer drafts are protected against an in-flight result replacing them. Generation failure never substitutes a template silently or overwrites existing prose.
- AI handovers use the versioned `doctor-handover-v3` prompt in `api/templates/prompts/handover.txt`: current situation, relevant background, latest measurements/trends, sepsis signal/alerts, recorded actions, outstanding follow-up, and data gaps/review. Evidence IDs remain in structured sources rather than prose; observation times remain visible. Planned actions remain distinct from completed actions. New generations use a new cache version; edited drafts are preserved.
- Integration status reports configured/disconnected/unavailable/quota state and reference-library availability. Configuration is not proof of a successful external request.

All write endpoints require existing clinician authentication, CSRF, and replay ownership checks. Family APIs never include jobs, scores, internal actions, chat, or handovers. Family publication remains an explicit separate clinician action.

### Evidence, references and scope

`references.demo.json` is a small versioned developer-selected educational library. It includes an original short paraphrase of SCCM screening context and the project's own demo workflow. Entries are labelled **not clinically reviewed**. This is a fixed supplied library, not web search or a validated medical knowledge base. Missing/invalid libraries yield factual summaries only, with no recommended actions.

Gemini returns structured JSON validated by Pydantic plus allowlisted evidence/citation IDs, clinician-confirmation checks, action IDs, and limited scope checks. Action labels come from the server catalogue, never model prose. Schema and lexical checks cannot prove factual correctness or clinical safety; this integration must remain a demonstration. No diagnosis, medication, dose, treatment order, or inferred completed care is authorized. Model explanations are not causal explanations.

### Verification

Run `.venv/bin/python -m pytest api/tests -q`, `npm test --prefix frontend`, and `npm run build --prefix frontend`.

Run `.venv/bin/python -m api.smoke_gemini` to check configuration without making requests. After configuring the key, explicitly run `.venv/bin/python -m api.smoke_gemini --send-demo` for one entirely synthetic, schema-validated live request. A missing key, quota, model-access failure or invalid response must remain visible as a failure. Never claim a live test passed based on mocked tests.


### Explicit model fallbacks

Use `GEMINI_MODEL=gemini-3.5-flash-lite` with `GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite`. Both currently have free-tier-eligible standard text generation, subject to project allocation. The allowlist intentionally excludes paid-only models; availability of a free tier does not override the project's billing configuration. Fallback is disabled when its environment list is empty.

Only model-not-found/retired (404/410), temporary server failures (500/502/503/504), and network timeouts can advance to the next configured model. Authentication, depleted credits, quota, blocked responses, malformed output, and evidence-validation errors stop immediately. Every attempt uses identical evidence, the same output/scope validation, no SDK retries, and a shared 20-second deadline. Google requires a minimum 10-second per-request timeout; no next attempt starts without that remaining budget. The successful model is persisted on each generation and shown with its supporting evidence. Configuration/cache keys include the fallback list.
