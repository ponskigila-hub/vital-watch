# VitalWatch project checklist

Reviewed: 18 October 2026. Based on the current source, supplied model artifacts, evaluation report, local automated checks, and browser verification. GitHub was fetched before preparing this update. Training has not been reproduced and the IBM server has not been inspected.

Checked means implemented for the local prototype. Unchecked means incomplete, unverified, or deferred as stated. A working interface or integration contract alone does not count as a connected AI feature.

## 1. Product scope and architecture

- [x] Define clinicians (nurses/doctors) as the primary users.
- [x] Provide a separate restricted patient/family view.
- [x] Choose PhysioNet hourly replay as the hackathon data source.
- [x] Implement React frontend, FastAPI backend, SQLAlchemy, and persistent local SQLite storage.
- [x] Establish request/response contracts for prediction and language services.
- [x] Separate recorded observations, fictional patient context, model outputs, and clinician decisions.
- [x] Choose sepsis as the currently supported prediction task.
- [ ] Complete every originally proposed AI feature; details below.

## 2. Data preparation and patient replay

- [x] Add PSV parsing with column, numeric-value, size, and patient-hour validation.
- [x] Support missing observations without manufacturing recorded measurements.
- [x] Exclude `SepsisLabel` from inference inputs and stored clinical observations.
- [x] Import a recording as a persistent patient; reject byte-identical duplicates.
- [x] Bundle the original recorded patient and seven held-out demo recordings.
- [x] Seed 13 streams: eight recorded and five explicitly synthetic.
- [x] Use fictional display identities and distinguish added clinical context from recorded data.
- [x] Preserve dataset attribution and license notices.
- [x] Implement shared playback, pause, speed selection, seek, and new replay sessions.
- [x] Bound displayed observations and model inputs by the current replay hour.
- [x] Preserve care records and scores across server restarts.
- [ ] Connect physical sensors or a hospital device feed — future scope; the current stream is replay.
- [ ] Add a bulk training-dataset browser — future scope; the app imports individual recordings and displays at most 100 patients per workspace snapshot.

## 3. Model development — teammate's training work

- [x] Include training and feature-building source in the repository.
- [x] Include a 127-feature builder shared by training and serving.
- [x] Include training/validation/test split workflow and a separate dataset-B check.
- [x] Train and supply the LightGBM sepsis model artifact.
- [x] Include a logistic-regression comparison baseline in the training workflow.
- [x] Save validation-selected operating thresholds and the trainer's evaluation report.
- [x] Include model examples with missed cases and false alerts, as well as detections.
- [x] Keep the selected stricter 5% validation operating policy in the app; its review threshold is approximately 0.0937.
- [ ] Independently reproduce and audit the complete training run and reported metrics in this workspace.
- [ ] Evaluate calibration before presenting scores as patient probabilities.
- [ ] Complete independent clinical validation or prospective evaluation — future work.

The trainer's test report contains AUROC 0.8223 and AUPRC 0.1349. These are reported research metrics, not proof of clinical readiness. The 5% policy name describes a validation operating point, not a patient's risk or a guaranteed alert rate elsewhere.

## 4. Model integration and automatic scoring

- [x] Load the trained model once at backend startup for local CPU inference.
- [x] Verify feature names and order against the artifact.
- [x] Score available hourly data on startup, import, seek, and background replay.
- [x] Run background scoring without an open dashboard.
- [x] Save results by patient, replay, hour, and model/feature configuration.
- [x] Display per-hour score history and model status.
- [x] Calculate patient-specific SHAP contributions with source observation hours.
- [x] Expose missing/stale measurement information and unavailable-score states.
- [x] Refuse unsupported scoring windows with missing hourly rows; missing fields within an existing row remain supported.
- [x] Prevent model failures from silently switching to example outputs.
- [ ] Add a trained personal-baseline/anomaly detector — its separate output contract exists, but no detector is connected.

## 5. Clinician dashboard and historical data

- [x] Implement ward overview, patient list, search, and model-band filtering.
- [x] Display latest heart rate, oxygen saturation, systolic pressure, MAP, respiratory rate, and temperature.
- [x] Show original observation hours for latest values.
- [x] Provide history for all six main vital signs, focused views, and time-range selection.
- [x] Compare recorded observations across previous/current periods.
- [x] Provide an hourly measurement table.
- [x] Display DBP, EtCO2, and 26 lab/recorded fields with missing-data states.
- [x] Make sparse lab results more visible with larger darker points and a reading guide.
- [x] Increase typography size and emphasize important readings/statuses with stronger contrast.
- [x] Apply the supplied MediCare+ design guide: blue/white palette, bundled Figtree/Open Sans/IBM Plex Mono, touch targets, focus indicators, and consistent component styling.
- [x] Replace Lucide UI icons with Feather icons across navigation, patient workflows, sepsis review, and the alert center.
- [x] Standardize font sizes across screens and apply softer shadows/rounded corners from the visual reference while preserving the existing layout.
- [x] Shorten dashboard and patient-view copy, remove promotional filler, and keep statistics, timing, source labels, and clinical caveats explicit.
- [x] Add subtle button/card feedback, navigation color transitions, page/drawer entrances, disclosure/toast motion, and reduced-motion support.
- [x] Redesign sepsis review around current status, alert follow-up, a threshold overlay, and recorded changes; keep raw scores, differences, peaks, and model evidence expandable.
- [x] Show influential model features, their source times, descriptive vital changes, and data-quality context.
- [x] Link review prompts to history, patient context, and assessment notes.
- [x] Make raw model numbers secondary to review status through an expandable model-details section.
- [x] Combine systolic pressure, diastolic pressure, and MAP in one mmHg chart, retaining missing-data gaps and six-hour comparisons.
- [x] Add an interactive measurement-availability heatmap for vitals and all 26 laboratory fields, with cell values and keyboard navigation.
- [x] Mark model alert hours on the sepsis score chart and link to current review status.
- [x] Emphasize clinician priority in a light-blue panel with larger status text and a clear action button.
- [x] Remove repeated demo badges, fixture controls, example chat, preset login shortcuts, Help & resources, and unfinished integration placeholders from the interface; retain truthful source labels and external-AI consent.
- [ ] Add verified measurement-specific lab units throughout — current lab history retains generic 'source units'.

## 6. Alert and care workflow

- [x] Generate a saved alert when the score crosses upward through the review threshold.
- [x] Avoid repeated alerts for every consecutive above-threshold hour.
- [x] Allow a new alert episode after a score falls below and crosses again.
- [x] Show alert counts, a bell indicator, an alert center, and patient-specific review status.
- [x] Redesign the alert center with patient-first cards, workflow counts, clear review controls, filtered empty states, and expandable event evidence.
- [x] Support Open → Acknowledged → In progress → Resolved with caregiver action history.
- [x] Keep unresolved alerts independent of later score changes; the model does not automatically resolve them.
- [x] Save clinician review-priority overrides with reasons.
- [x] Save care notes with patient hour and caregiver identity.
- [x] Provide workflow prompts for review; no treatment recommendation is generated.
- [ ] Pin or escalate patient ranking based on unresolved alerts — current ordering uses clinician overrides and model scores.
- [ ] Add in-app toast notifications for new alerts, if desired.
- [ ] Add sound, desktop/push notifications, or automatic escalation — not currently implemented.
- [ ] Define clinically reviewed escalation/action guidance before adding clinical recommendations.

## 7. Monitoring focus and broader condition support

- [x] Allow a clinician to choose a predefined focus or type a custom condition.
- [x] Save the clinician-confirmed focus as patient context.
- [ ] Provide evidence-based, condition-specific dashboard behavior; the current focus is a manual label, not a separate disease predictor.
- [ ] Suggest monitoring focuses using AI and patient evidence.
- [ ] Explain what available measurements can/cannot support for an arbitrary typed condition.
- [ ] Require confirmation before applying an AI-suggested focus; this requirement is represented in the language contract, but the AI flow is not connected.
- [ ] Supply a reviewed reference library with source citations for those explanations.

## 8. Language AI / Gemini

- [x] Create language request/response schemas and a provider interface.
- [x] Create prompt templates for patient questions, explanations, focus suggestions, and handover.
- [x] Assemble patient context with observation cutoffs and separate evidence categories.
- [x] Add structural response checks for allowed citation IDs, observation references, and clinician confirmation.
- [x] Provide chat UI, saved conversations, supporting sources, and explicit disconnected/error responses. Example chat is no longer offered in the interface.
- [x] Configure a private backend key and validate a live synthetic response with Gemini 3.5 Flash-Lite; no real patient data used.
- [x] Implement the official Google GenAI provider and opt-in external requests.
- [x] Implement timeout, quota cooldown, output/context bounds, snapshot deduplication, durable jobs and unavailable states.
- [ ] Populate the reviewed medical reference registry and implement retrieval.
- [x] Implement evidence-linked guidance/chat and clinician-tracked suggested steps; validated with a live synthetic smoke test.
- [ ] Verify citation support and unsupported-claim behavior beyond the existing structural checks.
- [x] Test cutoffs, explicit demo-text confirmation, citation/evidence rejection and clinician action boundaries with mocked responses.
- [x] Render chat headings, bullets, numbered steps, and bold statistics safely; remove internal evidence tags from displayed prose.
- [x] Offer readable chat sources and optional charts derived from the reply's saved, cutoff-bound evidence, preserving missing values.
- [x] Animate shared sidebar dismissal by close button, Escape, and backdrop click, with immediate dismissal for reduced-motion preferences.
- [x] Remove the standalone Reading provenance card and give the clinical profile the available width; keep source metadata in evidence and patient labels.

Gemini is off by default. Set LANGUAGE_PROVIDER=gemini and the backend GEMINI_API_KEY, then restart. A live synthetic smoke test passed on 2026-10-17 using Gemini 3.5 Flash-Lite. Quota remains project-dependent. Gemini 3.1 Flash-Lite is an explicitly configured backup for eligible model failures. Developer-selected demo references are supplied; they are not clinically reviewed.

## 9. Handover and family communication

- [x] Generate a structured handover snapshot from observations, available sepsis results, and care events.
- [x] Support editing, saving revisions, conflict detection, regeneration, and text export.
- [x] Label handover wording as generated from a local template.
- [x] Implement queued Gemini handovers with editing/export, explicit origin, conflict preservation and template fallback; validated with a live synthetic smoke test.
- [x] Add a doctor-to-doctor template covering situation, background, measurements/trends, sepsis/alerts, actions, pending follow-up, and data gaps.
- [x] Keep evidence IDs out of handover prose and exports; retain structured sources separately and use readable action names.
- [x] Correct reference/evidence ID classification and verify a previously failed handover generates successfully with live Gemini.
- [x] Let clinicians explicitly approve and share a plain-language family update.
- [x] Allow immediate withdrawal of shared updates.
- [x] Restrict family accounts to assigned patients.
- [x] Share only the implemented family fields: identity/source, three vital histories, and approved updates.
- [x] Exclude internal rankings, model scores, alerts, labs, notes, and handovers from family responses.
- [x] Provide a clinician preview of that restricted view.
- [ ] Verify remote access for family and remote clinical staff after hosted deployment.

## 10. Backend, accounts, and verification

- [x] Implement persistent database models and migrations, including saved prediction runs.
- [x] Implement clinician/family authorization and patient assignment checks.
- [x] Implement session-cookie authentication, password hashing, CSRF/origin checks, and sign-in throttling.
- [x] Generate private local demo credentials and keep credentials/runtime databases out of Git.
- [x] Provide API health/readiness routes and interactive API documentation.
- [x] Provide a CLI to initialize the database and assign patients to a family account.
- [x] Pass all 58 backend tests covering permissions, replay, imports, care persistence, inference, alerts, Gemini jobs, grounding, fallback, and handover handling.
- [x] Pass nine frontend tests for score history, comparisons, persistent review status, chat formatting, and evidence-bound charts.
- [x] Successfully build the frontend with the new patient charts and priority styling.
- [x] Manually check local clinician, handover, family, and sepsis-insight flows in the browser.
- [x] Verify heatmap recorded/missing cells, laboratory switching, arrow-key navigation, and a sepsis alert marker at hour 64; restore replay to its original hour afterward.
- [ ] Run a final end-to-end verification on the deployed IBM host.
- [ ] Add account invitation/administration and password-reset workflows — future work; public signup is not required for the current hospital demo.
- [ ] Validate multi-instance operation — current replay design requires one backend worker/instance.
- [ ] Add production backup/recovery and broader operational/clinical validation — future work.

These software checks do not establish clinical accuracy or LinuxONE deployment compatibility. Automated suites were rerun for this repository update.

## 11. IBM LinuxONE / z17 and hackathon evidence

- [x] Obtain access to the supplied Ubuntu LinuxONE server (user-reported: 3 vCPUs, 8 GB RAM, 50 GB disk).
- [x] Add host, inference benchmark, and Snap ML compatibility-check scripts to the repository.
- [ ] Verify the actual server architecture, access method, and installed dependencies.
- [ ] Confirm the application's Python/LightGBM dependency availability on that host.
- [ ] Add and verify Docker/Podman deployment files.
- [ ] Deploy frontend, backend, database storage, and model inference to LinuxONE.
- [ ] Configure a reachable URL, HTTPS, exact allowed origins, and secure cookies.
- [ ] Verify the single-worker replay/scoring service and persistent storage after a restart.
- [ ] Let the teammate test the hosted app from another network.
- [ ] Capture live workload and interactive app evidence on LinuxONE for the submission.
- [ ] Demonstrate the recommended two AI frameworks in the target environment. LightGBM and a scikit-learn training baseline exist in source; a second running LinuxONE AI workload has not been verified.
- [x] Connect the local hybrid experience: LightGBM scores with Gemini guidance, patient chat, and editable AI handover.
- [ ] Demonstrate that hybrid workflow on the deployed LinuxONE host.
- [ ] Verify any IBM-specific security or hardware-acceleration claim before including it in the pitch.

LinuxONE access is established by the user's report; deployment and acceleration are not established by the server flavor name. Current verified inference runs locally on CPU.

## 12. Repository, documentation, and submission

- [x] Create the GitHub project and previously push the frontend/backend foundation.
- [x] Pull the teammate's trained model, thresholds, source, and evaluation artifacts.
- [x] Document setup, credentials, usage, model integration, data provenance, and limitations in the local README/integration guide.
- [x] Create this progress checklist.
- [x] Prepare the current model/Gemini integration, patient setup, interface changes, charts, and documentation for this repository update.
- [x] Commit and push this update to GitHub; verify the remote revision after pushing.
- [ ] Verify public repository access and a fresh install from the pushed revision.
- [ ] Choose a short demo sequence that accurately reflects the selected 5% policy, including a false alert or missed case.
- [ ] Prepare final submission answers: problem, solution architecture, IBM use, and beneficiaries/value.
- [ ] Prepare a readable pitch-deck PDF under 5 MB.
- [ ] Record and publish an accessible demo video of at most three minutes.
- [ ] Include team contributions, supported features, actual model results, and remaining limitations in the pitch.
- [ ] Provide direct open-source/dataset links and confirm application code licensing.
- [ ] Provide a solution flowchart/architecture document if submitting the optional supporting material.
- [ ] Check all submission links and submit the form.

## 13. Optional future workflow: another disease model

This expansion was discussed, but no additional disease or implementation was selected. It is not required to finish the sepsis demo.

- [ ] Select one additional condition and define the prediction outcome and time window.
- [ ] Find a permitted dataset with reliable labels for that outcome.
- [ ] Check whether the required measurements are also available for VitalWatch patients; plan additional ingestion if needed.
- [ ] Prepare patient-level splits, causal preprocessing, and quality checks.
- [ ] Train and evaluate the additional model on unseen patients and relevant subgroups.
- [ ] Choose review thresholds and document missed cases, false alerts, and limitations.
- [ ] Add a versioned model adapter and condition-specific result contract.
- [ ] Display each model's availability, evidence, timestamp, and review state separately.
- [ ] Test combined operation; never join unrelated datasets as though their records describe the same patient.

## 14. Newly proposed enhancements — not implemented

- [ ] “Since your last review”: highlight new readings, alerts, and completed work since a clinician last checked.
- [ ] Assign alert review tasks to a clinician with follow-up times and visible ownership.
- [ ] Compare successive handovers and highlight newly added information.
- [ ] Add a compact reliability summary alongside the existing measurement-availability heatmap.
- [ ] Display actual held-out model evaluation results in a dedicated performance view.
- [ ] Show measured LinuxONE uptime, inference latency, and service health after deployment.

## Recommended next sequence

1. Commit and push the working local integration and documentation so both teammates have the same baseline.
2. Verify the IBM host and package support, then prepare and deploy the single-instance application with persistent storage.
3. Recheck Gemini project access and quotas on the hosted backend; local live generation is verified. AI focus selection remains future work.
4. Verify alert → clinician review → saved handover → approved family update on the hosted app.
5. Finish the deck, three-minute video, evidence links, and submission answers.
6. Schedule personal-baseline detection and additional disease models as separately evaluated follow-up work.
