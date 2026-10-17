# VitalWatch

VitalWatch is a hospital monitoring demo that brings patient readings, historical trends, care notes, review priorities, and caregiver handovers into one workspace. Clinicians have a ward-wide view; assigned patients and family members have a separate, limited view of readings and approved updates.

The app includes a React frontend, an authenticated FastAPI backend, and a persistent SQLite database. **The trained LightGBM sepsis predictor is connected for local CPU inference.** It uses the trainer’s shared preprocessing and produces saved, patient-specific scores and threshold-crossing alerts as the replay advances. The personal-baseline detector remains disconnected. Gemini guidance, patient chat, and editable AI handovers are implemented as an opt-in educational demo; a backend API key is required. Explicit fixture mode is available for testing; anything marked **example** is not computed by the model.

## Contents

- [Project progress checklist](PROJECT_CHECKLIST.md)
- [What works now](#what-works-now)
- [Install and run](#install-and-run)
- [Sign in](#sign-in)
- [How to use VitalWatch](#how-to-use-vitalwatch)
- [Import patient recordings](#import-patient-recordings)
- [Data and replay behavior](#data-and-replay-behavior)
- [Configuration](#configuration)
- [Model and Gemini integration](#model-and-gemini-integration)
- [API and project structure](#api-and-project-structure)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Deployment and current limitations](#deployment-and-current-limitations)

## What works now

| Area | Available behavior |
| --- | --- |
| Ward overview | Thirteen seeded patient streams, search, model-band filters, current readings, and trends |
| Patient history | Heart rate, oxygen saturation, systolic pressure, MAP, respiratory rate, and temperature; individual and combined views; period comparisons and hourly measurement tables |
| Additional measurements | DBP, EtCO2, and 26 laboratory/recorded fields, with explicit missing-data states |
| Replay | Shared server-controlled playback, pause, seek, speed selection, and archived replay sessions |
| Care workflow | Persistent notes, manual monitoring focus, clinician review-priority overrides with reasons, model alert acknowledgement and status changes |
| Handover | Structured server-generated drafts, editable saved revisions, conflict detection, and text export |
| Family communication | Explicitly approved updates, immediate withdrawal, and patient assignments enforced by the backend |
| Accounts | Clinician and family roles, session-cookie authentication, password hashing, CSRF protection, and sign-in throttling |
| Sepsis inference | LightGBM v1, shared 127-feature preprocessing, per-hour score history, SHAP contributions, and persisted crossing alerts |
| Language AI | Opt-in Gemini demo guidance, grounded chat, editable AI handovers, and clinician-tracked review steps |

This is a hackathon prototype, not a clinically validated monitoring or diagnostic system. The current live behavior is **replay of stored hourly records**, not a connection to physical sensors.

## Install and run

### Prerequisites

- Python **3.12 or newer**; the backend was tested with Python 3.12.
- Node.js **20 or newer**, including npm.
- Git.
- Two terminal windows for development.

The commands below use macOS/Linux shell syntax. Run backend commands from the repository root so the default database path resolves consistently.

### 1. Clone the repository

```sh
git clone https://github.com/ponskigila-hub/vital-watch.git
cd vital-watch
```

### 2. Prepare the backend

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r api/requirements.txt
cp api/.env.example api/.env
.venv/bin/python -m api.app.cli init
```

Initialization applies database migrations, seeds the demo patients and accounts, and generates private sign-in details. Migrations also run automatically when the server starts. For the exact dependency versions from the tested environment, `api/requirements.lock` is provided as an alternative install file; availability on other platforms must be checked.

If `api/.env` already exists, edit it rather than overwriting your configuration.

### 3. Start the backend

```sh
.venv/bin/python -m uvicorn api.app.main:app --host 127.0.0.1 --port 8000
```

Leave this terminal running. Useful addresses:

| Address | Purpose |
| --- | --- |
| http://127.0.0.1:8000/api/health | Service health |
| http://127.0.0.1:8000/api/ready | Database readiness |
| http://127.0.0.1:8000/api/docs | Interactive API documentation |

### 4. Start the frontend

In the second terminal, open the repository and run:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/**. Vite forwards `/api` requests to the backend on port 8000. Keep both services running. Use the same hostname consistently for sign-in and browsing.

### Run the built app through one server

Build the frontend from the repository root:

```sh
npm ci --prefix frontend
npm run build --prefix frontend
```

Then start, or restart, the backend using the command above and open **http://127.0.0.1:8000/**. The backend serves both the compiled frontend and API. Vite's standalone `npm run preview` does not supply the development API proxy.

To stop either service, press `Ctrl+C` in its terminal. Stopping the backend preserves the database and pauses the replay.

## Sign in

Initialization creates these demo accounts:

| Role | Email | Access |
| --- | --- | --- |
| Clinician | `clinician@vitalwatch.local` | Clinical workspace and care workflows |
| Family | `family@vitalwatch.local` | Assigned patient `p000001`, three shared measurements, and approved updates |

Passwords are randomly generated and saved locally in **`api/.demo-credentials.json`**. Open that file on your own machine, copy the appropriate password, choose the matching role on the sign-in screen, and sign in. The role buttons prefill the email; permissions come from the authenticated backend account.

The credentials file is created with owner-only permissions and excluded from Git. No shared default password is published. Each fresh installation generates its own credentials. Initialization and server restarts do not reset an existing account's password. There is no public registration or password-reset screen in this version.

To assign another imported or existing patient to the existing family account, run locally:

```sh
.venv/bin/python -m api.app.cli assign family@vitalwatch.local PATIENT_ID
```

Replace `PATIENT_ID` with the patient's ID from the clinical record. This adds an assignment; it does not remove previous assignments or create a new account.

## How to use VitalWatch

### 1. Explore the ward

Sign in as the clinician. The overview displays the seeded patients and their latest available observations through the current replay hour. Open **Patients** to search, filter, or import a recording. Open a patient to see their detailed record.

With `PREDICTION_PROVIDER=lightgbm` (the default), scores are calculated from each patient’s physiological observations. The score is an uncalibrated research output, not a diagnosis or a calibrated probability. A patient's **Sepsis review** prioritizes the current signal, unresolved alerts, score trend with the alert threshold, and available changes in recorded vital signs. Raw score values, six-hour score differences, peak scores, SHAP contributions, and model metadata are available under **Model details & supporting evidence**. Unresolved alert status stays separate from the current model signal. Review tools link to measurement history, patient context, and assessment notes; they do not generate treatment instructions.

Example prediction outputs cannot replace the trained model while it is configured. To test the old fixtures deliberately, set `PREDICTION_PROVIDER=disconnected`, restart, then enable **Example prediction outputs** in Settings. A model-load or inference failure never silently switches to examples.

### 2. Replay the patient timeline

Use the bottom playback bar to play, pause, or seek to a patient hour. In **Settings**, select the number of seconds per recorded hour. This speeds up the demonstration; it does not change the original measurement times.

All signed-in viewers follow the same ward replay. Only clinicians can change it. The frontend refreshes server data approximately every two seconds, so another viewer's change may take a moment to appear.

**New session** archives the current replay and starts at hour 1. Prior actions remain stored. Archived session metadata and events are accessible through the clinical API; a full archive browser is not included in the frontend.

### 3. Compare current and historical readings

Open a patient and use **History & comparison**, the time-range selector, or **Compare periods**. Inspect all six primary vital histories together, expand an individual measurement, or open the hourly table. Select additional laboratory fields below the main charts.

Missing observations remain missing. Each latest value identifies its observation hour, which may be earlier than the current replay hour. Different charts retain their own units and scales. The comparison shows changes in recorded observations; it is not the trained personal-baseline detector.

### 4. Record care decisions

- **Add note** saves an observation to the patient timeline with the authenticated caregiver and patient hour.
- **Change focus** stores a manual monitoring focus. Free-text conditions are labels in this version; the app does not generate disease-specific medical guidance.
- **Set clinical review priority** records a clinician override and reason separately from the model score.
- **Alert center** lets clinicians acknowledge or update model-generated alerts and preserve the action history. Alerts are created when a score crosses upward through the selected threshold; sustained high scores do not create another alert every hour. A low score or an empty alert list does not establish absence of sepsis.

The alert center summarizes alerts awaiting acknowledgement, under review, and resolved. Each item prioritizes patient identity, the recorded event hour, current signal availability, and review controls. **Event details** retains the original model output, score, threshold, policy, and model key without placing technical metadata in the main alert heading. Recorded events remain distinct from the patient's current signal. The overview's compact feed always shows unresolved alerts, independently of the alert-center filter.

### 5. Prepare a handover

Open **Handover**, select the patient, and choose **Create structured draft**. The backend builds a snapshot from available measurements, the current sepsis model result, and recorded actions using a local template. It is labelled as a structured draft; no language model is involved.

Edit the text and click **Save draft**. Unsaved edits stay in the current page and can be lost on refresh. **Export** downloads the saved draft; save changes before exporting. **Regenerate** creates a new snapshot from the current replay state, so save or copy any edits you need first. If another clinician saves the same draft, conflicting edits are rejected instead of silently overwriting their work.

### 6. Share a reviewed family update

In **Handover**, write a plain-language update and choose **Approve & share update**. The assigned family account can then see it at the applicable replay hour. **Withdraw update** immediately removes it from family access; seeking backward or forward does not restore a withdrawn update.

Sign out and use the family account to inspect the separate view. It receives only:

- Assigned patient identity, bed, and recorded/synthetic source label.
- Heart rate, oxygen saturation, and systolic pressure, with observation hours and trends.
- Clinician-approved, non-withdrawn updates through the current replay hour.

Clinical notes, diagnoses, medications, labs, scores, ranking, alerts, and internal handovers are excluded from family API responses. The clinician's **Patient & family** page is a preview of this restricted response.

### 7. Try the patient question interface

Open **Ask VitalWatch** on an approved demo patient. With Gemini configured, confirm your question contains fictional/demo content only, then send it. The backend queues a response from the patient snapshot; the conversation displays supporting evidence and the patient hour. Without configuration, it returns an explicit disconnected response. No real personal data should be entered.

## Import patient recordings

Choose **Import patient** or **Import PSV** while signed in as a clinician. Each upload creates one persistent patient record with a generated identity; the file is treated as a recording, not a source of real patient identity.

Supported format:

- UTF-8 text, pipe-delimited (`.psv`).
- Exactly the 40 PhysioNet Challenge 2019 input column names, with optional `SepsisLabel`; column order may vary.
- Numeric values; blank, `NaN`, or `NA` entries represent missing observations.
- Positive, unique, increasing integer `ICULOS` values. Gaps are allowed.
- At most 20,000 hourly rows and a maximum upload read limit of 5 MiB.

After import, available observations through the current replay hour are scored automatically. Future observations are scored as the replay advances.

The parser rejects malformed rows and non-finite numeric values other than the supported missing markers. `SepsisLabel` is excluded from stored clinical readings and model context. Byte-identical recordings are rejected as duplicates. Import validation is atomic: a rejected file does not leave a partial patient.

The bundled `p000001.psv` and seven held-out recordings are already seeded, so importing those files again returns a duplicate warning. Use a different recording to demonstrate import. If a recording begins later than the current replay hour, advance the replay before expecting observations to appear.

The approximately 40,000-file training collection is **not** included or automatically imported. Training data preparation is separate from this one-patient demo import workflow. The clinical workspace snapshot currently displays at most 100 patients; the API has a paginated patient endpoint, but the frontend is not a bulk dataset browser.

## Data and replay behavior

- The seeded ward contains eight recorded PhysioNet streams (`p000001` plus seven held-out demo recordings) and five deterministic synthetic streams. Existing records and care actions are preserved when the additional recordings are added.
- All initial patient identities, diagnoses, medications, and added clinical context are fictional and separate from the recorded measurements.
- Dataset attribution and preserved upstream notices are in [api/demo/README.md](api/demo/README.md) and [PHYSIONET_LICENSE.txt](api/demo/PHYSIONET_LICENSE.txt).
- The initial demo replay starts paused at patient hour 34. New replay sessions begin at hour 1.
- The database persists imported readings, accounts, assignments, care events, handovers, messages, and approved updates across server restarts.
- History, model input, score history, and time-dependent care records are bounded by the replay hour. Moving backward hides later records; it does not delete them.
- Restarting the server restores the saved replay hour **paused**.
- Clinical records are not stored in browser local storage. Old browser-only demo records are not migrated.

The default database is `api/runtime/vitalwatch.db`. For a simple consistent local backup, stop the backend and copy the runtime directory to a private backup location. Do not commit runtime databases or credentials.

### Held-out demo walkthrough

The seven recordings in `api/demo/held_out/` are added automatically on startup when `DEMO_SEED=true` and `DEMO_HELD_OUT=true`. They retain their PhysioNet IDs but use neutral fictional display names. Restarting does not add duplicates or reset existing care records. They are not assigned to the family account automatically.

| Patient ID | Fictional display name | Recorded hours |
| --- | --- | --- |
| p000574 | Avery Morgan | 76 |
| p000679 | Casey Patel | 74 |
| p000185 | Riley Bennett | 65 |
| p000346 | Morgan Ellis | 64 |
| p000021 | Taylor Reed | 57 |
| p000132 | Jamie Park | 56 |
| p000802 | Alex Rivera | 55 |

The trainer's [offline manifest](api/demo/held_out/demo_patients.json) describes early/late detections, quiet recordings, a missed case, and a false alarm. Its timings use **`10pct_false_alert_patients`**, threshold **0.0718975865**. The configured demo retains the stricter **5% validation policy**, so its alert timings differ. To reproduce the supplied walkthrough, set `SEPSIS_ALERT_POLICY=10pct_false_alert_patients` in `api/.env`, restart, and state that operating point in the presentation. Keep the missed case and false alarm in the demonstration rather than presenting only successful detections.

At the manifest's policy, the first threshold crossing occurs at hour 53 for p000802, hour 56 for p000574, hour 59 for p000679 and p000185, and hour 64 for p000346. p000021 and p000132 do not cross. The two quiet recordings end at hours 57 and 56, respectively; advancing beyond an individual recording's end does not invent a new score.

With the selected **5% policy**, first alerts occur at hour **53** for p000802, **57** for p000574, **60** for p000185, and **64** for p000346. p000021, p000132, and p000679 do not cross. Thus p000679's early-detection example at the 10% policy becomes a missed case at 5%; do not present the 10% category as a result of the selected policy. p000574 contains 76 observations spanning patient hours 2–77.

The files' outcome labels and manifest annotations are strictly offline evaluation material. They are not loaded into patient conditions, medication lists, AI prompts, clinical API responses, or inference inputs. See [the demo recording guide](api/demo/held_out/README.md) for provenance and attribution.

## Configuration

Copy `api/.env.example` to `api/.env` and restart the backend after changes.

| Variable | Default / behavior |
| --- | --- |
| `DATABASE_URL` | `sqlite:///api/runtime/vitalwatch.db`; relative to the directory from which the server is launched |
| `COOKIE_SECURE` | `false` for local HTTP; use `true` behind an HTTPS deployment |
| `ALLOWED_ORIGINS` | Exact localhost/127.0.0.1 origins on ports 5173 and 8000; comma-separated |
| `PREDICTION_PROVIDER` | `lightgbm`; use `disconnected` only for explicit fixture testing |
| `SEPSIS_MODEL_PATH` | `models/model_v1.txt`; defaults to the repository artifact when unset |
| `SEPSIS_THRESHOLDS_PATH` | `models/thresholds_v1.json`; validation-selected operating points |
| `SEPSIS_ALERT_POLICY` | `5pct_false_alert_patients`; also accepts `10pct_false_alert_patients` or `20pct_false_alert_patients` |
| `DEMO_HELD_OUT` | `true`; adds the seven bundled held-out recordings idempotently when demo seeding is enabled |
| `DEMO_SEED` | `true`; seeds demo records/accounts when absent |
| `SESSION_HOURS` | `8`; authenticated session lifetime in hours |
| `DEMO_CLINICIAN_PASSWORD` | Optional initial-account password override; otherwise randomly generated |
| `DEMO_FAMILY_PASSWORD` | Optional initial-account password override; otherwise randomly generated |

Password overrides apply when creating the account, not as a reset mechanism. Setting `DEMO_SEED=false` does not remove existing demo data; a fresh empty database still needs initialization before the workspace can be used.

### Enable Gemini for the educational demo

Install the updated backend requirements, then configure the ignored `api/.env` and restart the API:

```dotenv
LANGUAGE_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite
AI_TIMEOUT_SECONDS=20
AI_MIN_INTERVAL_SECONDS=10
AI_MAX_OUTPUT_TOKENS=2048
```

Keep the key on the backend; never use frontend `VITE_` variables or commit it. Google project/model access and free quota are required. There is no automatic paid-model fallback. This is an educational simulation, not medical advice or clinical practice. Only approved bundled public/synthetic demo streams are eligible; new imports remain local.

- Open **Sepsis review → Suggested review steps → Generate guidance**. A newly raised model alert during replay also queues guidance. Startup scoring, backfill and seeks do not.
- Review the explanation, observations, suggested steps, patient hour and expandable sources. Older guidance must be refreshed before accepting new actions.
- **Accept plan** creates a planned task in the care timeline. **Mark completed** is separate. Gemini never changes priorities or resolves alerts.
- Chat requires fictional/demo-content confirmation before transmission to Google. New care notes are excluded unless their author checks the same consent option.
- **Generate AI draft** creates an editable handover. Template drafts remain available, and conflicting edits or failed generation preserve existing drafts.
- The small supplied reference library is developer-selected and not clinically reviewed. Structural evidence checks do not establish factual correctness.

Check configuration without contacting Google:

```bash
.venv/bin/python -m api.smoke_gemini
```

After configuring a key, explicitly run one entirely synthetic live test:

```bash
.venv/bin/python -m api.smoke_gemini --send-demo
```

Quota failures, timeouts and invalid responses are displayed truthfully. Monitoring continues independently. See [integration details](api/INTEGRATIONS.md) for contracts and data boundaries.

## Model and Gemini integration

Read **[api/INTEGRATIONS.md](api/INTEGRATIONS.md)** for the connected sepsis adapter, operating policies, and remaining language/baseline work.

### Enable the pulled model on an existing installation

```sh
.venv/bin/python -m pip install -r api/requirements.txt
```

Edit an existing `api/.env` so `PREDICTION_PROVIDER=lightgbm` (old installations may explicitly contain `disconnected`), then restart the backend. The new prediction-results migration runs automatically and preserves accounts and care records. Check `/api/v1/integrations/status` while signed in, or the app’s Settings page. The expected provider is `lightgbm` with status `connected`.

The model is loaded once, verifies its exact feature names/order, and runs with one inference thread. Results are stored per replay, patient, hour, and model/feature/adapter/policy fingerprint. Startup, import, replay seeking, and the background replay clock calculate missing results. Scoring continues without an open browser. Repeated dashboard refreshes read saved results instead of running inference again. Forward seeks backfill skipped observation hours; moving backward never exposes future scores or alerts.

The default review threshold is **0.0936930679**, the trainer’s `5pct_false_alert_patients` validation operating point. “5%” describes the share of non-sepsis patients with an alert in the validation selection process, not a patient’s sepsis probability or a guaranteed deployment false-alert rate. **High** means the score meets the selected threshold; **Moderate** means it meets the next lower supplied threshold, if one exists; **Low** is below those cutoffs. These are application display bands, not independently trained diagnoses or triage instructions. Clinician priority overrides remain separate.

Missing measured values stay missing. Model v1 requires consecutive hourly rows inside its window; records with hour gaps, no usable physiological observations, or no new row at the selected hour receive an explicit unavailable/insufficient-history state. Short histories may be scored when usable; they are labelled with their available row count. Transient inference failures are saved without a numeric score and may retry after 30 seconds. No fictional profile data or `SepsisLabel` enters inference.

Responsibilities remain separate:

1. **Sepsis predictor (connected):** physiological history → shared feature builder → LightGBM v1 → saved score, factors, and crossing alert.
2. **Personal-baseline detector:** a separate baseline/deviation result; descriptive period comparisons are not a substitute for a validated detector.
3. **Gemini/language provider:** opt-in demo guidance, patient questions and editable AI handovers using supplied evidence and a developer-selected reference library. AI focus selection remains future work.

The current prediction request accepts at most 24 records within the last 24 patient-hours, preserves missing values as `null`, and rejects labels or future observations. Serving imports the same `src/features.py` used during training. Regression tests compare training/batch/window feature vectors and scores, including cutoff and future-mutation checks.

Available handoff files:

| Location | Purpose |
| --- | --- |
| `api/app/schemas.py` | Typed request/result contracts and validation |
| `api/app/providers.py` | Provider interfaces, disconnected/example adapters, prompt construction, and output-reference checks |
| `api/app/inference.py` | Loaded LightGBM adapter, eligibility checks, batch inference, and SHAP output |
| `src/features.py` | Shared training and serving feature implementation |
| `models/model_v1.txt`, `models/thresholds_v1.json` | Trained text artifact and validation thresholds |
| `results/eval_v1.json` | Trainer-supplied evaluation; not independently reproduced here |
| `api/app/services.py` | Replay-bounded inputs, saved results, alert episodes, and score-history retrieval |
| `api/templates/contracts/` | Generated JSON schemas |
| `api/templates/prediction-*.example.json` | Example prediction request and disconnected result |
| `api/templates/prompts/` | Question, explanation, focus, and handover prompt templates |
| `api/templates/references.example.json` | Empty reference registry template; no medical library is supplied yet |

Personal-baseline inference, clinically reviewed reference curation, AI focus selection, and independent clinical evaluation remain future work. No API key is needed for monitoring and template workflows; Gemini requires a separately configured backend key.

## API and project structure

Most application endpoints are under `/api/v1`. Use the running server's [OpenAPI documentation](http://127.0.0.1:8000/api/docs) for exact request and response schemas.

| Routes | Purpose / access |
| --- | --- |
| `/auth/login`, `/auth/me`, `/auth/logout` | Sign-in, current session, and sign-out |
| `/workspace`, `/patients` | Clinical snapshot and paginated patient search; clinician |
| `/patients/import` | Validated recording upload; clinician |
| `/patients/{id}`, `/history`, `/comparisons`, `/evidence` | Patient data; append subpaths to `/patients/{id}`; clinician |
| `/replay`, `/replay/restart`, `/replays` | Shared clock controls and archived session metadata; clinician |
| `/patients/{id}/notes`, `/focus`, `/priority` | Audited care actions; append subpaths to `/patients/{id}`; clinician |
| `/alerts/{id}` | Example alert status; clinician |
| `/patients/{id}/handovers`, `/handovers/{id}`, `/handovers/{id}/export` | Generate, edit, and export drafts; clinician |
| `/patients/{id}/updates`, `/updates/{id}/withdraw` | Approve/withdraw family updates; clinician |
| `/patients/{id}/messages`, `/messages/example` | Saved questions and labelled examples; example subpath under the patient; clinician |
| `/family`, `/family/patients/{id}` | Restricted patient view; assigned family account |
| `/integrations/status`, `/integrations/references` | Disconnected provider/reference status; clinician |

Sign-in returns an HttpOnly session cookie plus a CSRF token. Subsequent authenticated mutations require the cookie and `X-CSRF-Token`. Replay-bound commands also carry `session_id`; playback and draft edits use revisions to detect stale writes. The frontend handles these automatically. API docs do not automatically add the custom CSRF header to every request.

```text
vital-watch/
├── README.md
├── api/
│   ├── app/                 # API, authentication, database models, services, CLI
│   ├── demo/                # Recorded sample and dataset notices
│   ├── migrations/          # Alembic schema initialization
│   ├── templates/           # Future model/language contracts and prompts
│   ├── tests/               # Backend workflow and contract tests
│   ├── .env.example
│   ├── INTEGRATIONS.md
│   ├── requirements.txt
│   └── requirements.lock
└── frontend/
    ├── src/                 # React screens, API client, charts, styles
    ├── public/              # Public interface assets; no patient recordings
    └── package.json
```

Private generated files include `api/.env`, `api/.demo-credentials.json`, `api/runtime/`, and `.venv/`; Git ignores them.

## Tests

From the repository root:

```sh
.venv/bin/python -m pytest api/tests -q
npm run build --prefix frontend
npm test --prefix frontend
```

The backend suite currently contains **26 tests** covering authentication, expiry/throttling, CSRF/origin checks, family field restrictions, historical cutoffs, missing observations, imports, event persistence, replay controls, approved-update withdrawal, handover revisions/export, disconnected providers, model contracts, concurrent clinical writes, real artifact scoring, training/serving parity, SHAP sums, automatic background scoring, imports, model failures/retries, migration preservation, persisted results, and alert deduplication. The frontend build checks TypeScript and produces the compiled application. Six frontend calculation tests verify score changes, missing hours, cutoff handling, persistent review status, and measurement comparisons.

The clinician note → structured handover → approved family update flow has also been checked manually in the local browser. Passing these checks does not establish clinical validity or production readiness.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Frontend reports the workspace is unavailable | Keep the backend running on port 8000 and check `/api/health` and `/api/ready`. |
| Sign-in fails | Read the credentials generated on this installation. Restarting or changing a seed password variable does not reset an existing account. After repeated failures, wait five minutes. |
| Sign-in works but later requests fail | Use one consistent hostname; cookies for `localhost` and `127.0.0.1` are separate. For HTTP development, leave `COOKIE_SECURE=false`. |
| A mutation returns 403 | Check the account role, exact allowed origin, and CSRF header. Normal frontend requests include the token automatically. |
| A mutation returns 409 | Another viewer changed the session/revision, or the recording is a duplicate. Refresh; preserve unsaved draft text before retrying. |
| No readings appear at the selected hour | Seek into the recording's time range. A missing field may never have been recorded; it is not filled with invented values. |
| Family view is empty | Ensure the account has a patient assignment. Approved updates after the selected hour are hidden, and withdrawn updates stay hidden. |
| Replay moves unexpectedly | The clock is shared with every viewer. Check whether another clinician is playing or seeking. |
| Chat gives a disconnected response | Configure LANGUAGE_PROVIDER=gemini and a backend key, then restart. Confirm demo-only text before sending. Template handovers still work without Gemini. |
| Sepsis model is unavailable | Install the updated Python requirements, check `PREDICTION_PROVIDER`, artifact paths, and backend logs. Linux may require an OpenMP runtime such as `libgomp1`; macOS may need `libomp`. No example score replaces a failed inference. |
| Scores still look like fixed examples | Set `PREDICTION_PROVIDER=lightgbm` in an existing `api/.env` and restart. |
| Port 5173 is occupied | Vite may choose another port. Free 5173, or explicitly configure the chosen frontend origin in the backend. |
| Built frontend does not load from port 8000 | Build `frontend/`, then restart the backend so it mounts the assets directory. |
| A second empty workspace appears | Launch backend/CLI commands from the repository root, or use an absolute SQLite path. |

## Deployment and current limitations

The intended hackathon host is IBM LinuxONE. **This repository has been verified locally; it has not yet been deployed or tested on LinuxONE/s390x.** No containerized deployment, accelerator execution, or second AI framework is claimed by this implementation.

For the next deployment step, verify Python/package availability on the provided host, build the frontend, persist the database outside disposable storage, and place the application behind HTTPS. Set secure cookies and exact allowed origins for that deployment. Bind the backend according to the host's network setup rather than exposing the local development server without deployment configuration.

Run **one backend worker / one application instance** for the current shared-clock design. Multiple workers would each start a replay clock; a distributed clock/locking design is not implemented. SQLite is the implemented and tested database configuration. External database drivers and migrations have not been validated.

Further work includes LinuxONE/container deployment, a trained personal-baseline detector, a reviewed medical reference library, live sensor ingestion, production account administration, and broader operational/clinical validation. Application code licensing is not specified by the upstream dataset notices; dataset attribution is retained separately.
