# VitalWatch system architecture

![VitalWatch system architecture](architecture.png)

[SVG version](architecture.svg) · [Editable Mermaid source](architecture.mmd) · [Graphviz rendering source](architecture.dot)

This diagram shows deployment boundaries, components, and communication. The [application workflow](workflow.md) separately explains the clinician's review cycle.

| Component | Location and responsibility |
| --- | --- |
| React application | Runs in the browser. Clinicians use the clinical workspace; assigned family accounts receive a restricted view. |
| Uvicorn / FastAPI | One Python process on LinuxONE. Serves the frontend and APIs, verifies sessions/CSRF/permissions, and handles clinical workflow records. |
| Replay/scoring task | Background task in that same process. Advances the shared clock, enforces the cutoff, and persists scores and alert episodes. |
| LightGBM | Loaded on the LinuxONE CPU with shared causal preprocessing and configured threshold artifacts. Produces research scores and supplied feature contributions. |
| SQLite / SQLAlchemy | VM-local persistent readings, results, alerts, care events, checkpoints, drafts, updates, and language jobs. |
| Language worker | Background task in the same process. Reads queued jobs, builds approved evidence snapshots, calls Gemini, validates output, and saves results. |
| Gemini API | External service reached over outbound HTTPS for optional guidance, chat and drafts. Keys remain in private backend configuration. |
| Operational endpoints | Health, readiness and runtime metrics. The Performance view separately presents offline evaluation artifacts. |

The currently evidenced deployment is a direct Python service on an IBM LinuxONE s390x Ubuntu VM, not a verified container deployment. The deployed browser application uses same-origin HTTP on port 8000. An authorized SSH tunnel is an alternative access path; public HTTPS/reverse-proxy hosting is not assumed by this diagram.

Local development differs: Vite runs on port 5173 and proxies API requests to FastAPI on port 8000. On LinuxONE, FastAPI serves the compiled frontend; a separate Vite development server is unnecessary.

Permissions are enforced by the backend. Family responses exclude internal scores, alerts, clinical notes and handovers. Gemini receives approved, cutoff-bound demo evidence; display identifiers, outcome labels and unapproved free text are excluded. Suggestions need clinician review and cannot change thresholds, set priority, complete tasks or resolve alerts.

Arrows describe logical communication and stored data, not separate servers for every box. The backend uses one process with background tasks, rather than independent worker services or a separate message broker. Monitoring and template handovers continue when Gemini is unavailable.
