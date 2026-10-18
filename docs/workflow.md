# VitalWatch application workflow

![VitalWatch application workflow](workflow.png)

[SVG version](workflow.svg) · [Editable Mermaid source](workflow.mmd) · [Graphviz rendering source](workflow.dot)

The main flow runs from replayed observations to a research sepsis signal, clinician review, follow-up, handover, and an explicitly approved family update. It represents the application workflow, not a clinical treatment protocol.

This is a common review cycle, not a mandatory sequence enforced by the app. Clinicians can prepare handovers and approved family updates while tasks remain open; outstanding work belongs in the handover.

- **LinuxONE:** hosts the FastAPI service, replay/scoring work, LightGBM CPU inference, SQLite persistence, and the served React application.
- **Data:** PhysioNet PSV recordings or validated imports are replayed by patient hour. This is recorded-data replay; physical bedside-device ingestion is not implemented.
- **Scoring:** causal preprocessing uses available history. The model saves scores and creates upward-crossing alert episodes. The 5% policy is a validation operating point, not an individual patient's probability.
- **Clinical review:** clinicians acknowledge, take ownership, set priority, document assessments, schedule follow-up, and explicitly complete work. Resolving an alert is a separate action.
- **Review checkpoints:** “Mark reviewed” saves a personal checkpoint. It does not acknowledge or resolve alerts or complete tasks.
- **Gemini:** optional guidance, patient chat, and AI handovers use approved, cutoff-bound evidence. External requests exclude display identifiers and outcome labels. Responses are validated before display; suggestions need clinician acceptance. A newly raised alert during active replay can queue guidance; startup backfill and timeline jumps do not generate a backlog.
- **Handover and family:** drafts remain editable clinical records. Family accounts see assigned patients' restricted readings and only explicitly published updates; internal scores, alerts, and handovers are excluded.
- **Operations:** the Performance page shows offline evaluation; health, readiness, and runtime metrics describe software operation. They do not establish clinical effectiveness.

If Gemini is disconnected or generation fails, the core monitoring, alert workflow, and local template handover remain available.
