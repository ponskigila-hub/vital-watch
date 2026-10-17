# Integration templates — not live models

The application is functional without external AI. `providers.py` supplies `DisconnectedPrediction`, `ExamplePrediction`, `DisconnectedLanguage`, and `ExampleLanguage`. Examples are fixed interface fixtures, never computed clinical predictions. The environment values for prediction/Gemini are reserved for future integration; setting an API key alone does not enable calls.

## Prediction contract

Implement `PredictionProvider.score(PredictionRequest) -> PredictionResult`. The application supplies **at most 24 records within the latest 24 patient-hours**, in ascending order through `as_of_hour`. Gaps in complete hourly rows are permitted, not fabricated. Columns use the original 40 PhysioNet names; missing values are JSON `null`. Labels and fictional clinical context are excluded. The schema rejects future, duplicate, out-of-order, and out-of-window records.

See `templates/prediction-request.example.json`, `templates/prediction-response.example.json`, and the generated JSON schemas in `templates/contracts/`.

Return sepsis and personal-baseline results separately. Unavailable scores, bands, and alert decisions remain null. A zero score must mean an actual numeric output, not failure. Include model/feature versions, observation hours, input quality, and contributing factors where supported. Measurement direction and model contribution are separate fields; neither implies causation or treatment priority. Do not label an uncalibrated score as a clinical probability.

Your model's feature preparation must be **the same versioned implementation in training and serving**, using exactly the agreed history window and missing-data policy. The application does not yet implement the trained model's preprocessing. Deliver model/runtime artifacts, feature order and implementation, validation-derived thresholds, compatibility requirements, and held-out evaluation results before connecting the adapter. PhysioNet 2019 sepsis labels are already shifted; handle target/lead-time definitions correctly during training.

The future adapter connects at `services.prediction()`. Clinician priority overrides remain separate audit events. Running a real model and supporting the target LinuxONE runtime are later steps.

## Gemini / language contract

Implement `LanguageProvider.respond(LanguageRequest) -> LanguageResult`. Four operations have prompt templates: `question`, `explanation`, `focus`, and `handover`. Inputs separate physiological observations, fictional/clinical context, notes, supplied predictions, and reviewed reference passages. The backend assembles only patient-appropriate evidence through the replay cutoff.

`build_prompt()` places evidence under an explicit untrusted-data boundary. `validate_language_result()` rejects invented source IDs, unsupported observation references, and bypassed clinician confirmation. It validates reference structure, not medical truth or whether the cited passage actually supports each claim; evaluate that separately before enabling a real provider.

Populate `templates/references.example.json` with permitted, reviewed medical reference passages and provenance before claiming medical reference grounding. The current empty registry is deliberately not a medical knowledge base. Prompts must not invent diagnoses, scores, treatments, actions, or citations. Focus recommendations are suggestions requiring clinician confirmation.

The future Gemini adapter must read its key only on the backend and implement the configured timeout, output limits, context/token budgeting, quota handling, caching, and truthful unavailable states. Do not call Gemini on each measurement. Source and data-use permissions must be suitable for the supplied content before enabling transmission. No Gemini SDK or external requests are included now.

Structured handovers are generated locally on the server and labelled `structured_template`; keep them distinct from future Gemini-generated drafts. Publishing updates to family remains an explicit clinician action independent of any model response.

## Acceptance before replacing fixtures

Run the provider contract tests and demonstrate equal training/serving feature vectors for identical causal histories. Verify real examples, missing data, short histories, out-of-window prior labs, failures/timeouts, citation support, calibration claims, and a recorded CPU/runtime environment. Preserve the family's response allowlist and confirm no new model fields reach family endpoints.
