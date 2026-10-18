# VitalWatch frontend

React, TypeScript, Vite, Recharts, Feather icons, and GSAP clinical workspace. This frontend connects to the authenticated FastAPI backend; follow the [repository setup guide](../README.md) to start both services and obtain the generated demo sign-in details.

The interface follows the supplied [MediCare+ design guide](design/medicare-DESIGN.md). Its implementation is in `src/medicare.css`, imported after the existing layout styles. Fonts are bundled locally: Figtree headings, Open Sans body text, and IBM Plex Mono for recorded values and IDs. The theme uses medical blue navigation/actions, white surfaces, labelled red/amber clinical statuses, visible focus rings, and at least 44px primary control targets. Body text retains the larger sizes requested for this workspace. This styling is not a claim of a completed WCAG audit.

`src/presentation.css` provides the final shared typography, corner-radius, and shadow tokens. All stylesheets use the same six text sizes: 32px page titles, 24px section headings, 20px subheadings, 16px body text, 14px supporting text, and 40px primary readings. The reference-inspired surface polish uses 24px outer corners, 16px inset corners, rounded controls, and soft shadows without changing page grids or component arrangement.

`src/motion.css` adds hover/press feedback, smooth state colors, toast entry, and disclosure transitions. GSAP handles page/drawer entrances and staggered statistic cards. `src/useInteractionMotion.ts` adds a short spring release when a button is activated by mouse, touch, or keyboard. Animations respect reduced-motion preferences, including preference changes while the app is open; readings and chart traces do not animate between updates.

```sh
npm install
npm run dev
npm run build
```

Vite proxies `/api` to `http://127.0.0.1:8000`. For a production preview, build this frontend and run the backend, which serves the build and API together. Vite's standalone preview command does not provide the backend proxy.

The Alert center supports personal ownership, reassessment scheduling by patient hour, a pending-follow-up filter, due/overdue reminders, and a response timeline. The owner explicitly records completion; acknowledgement and resolution remain separate. A ward reminder links to pending tasks across patients, while patient-page alert links retain that patient's filter. All state is saved through authenticated, version-checked backend operations.

The clinical workspace includes patient search, all six primary vital histories, DBP/EtCO2 and 26 additional measurement fields, missing-data states, shared replay, notes, manual monitoring focus and review priority, model-generated alerts, structured/AI handovers, approved family updates, and PSV import. Care records and imports persist on the server. Editable handover changes must be saved explicitly.

`src/components/SinceLastReview.tsx` shows a clinician's saved checkpoint and subsequent vital, laboratory, alert, score, and care-record changes. **Mark reviewed** saves the current patient/replay cutoff through the authenticated backend; it does not resolve alerts or complete tasks. Outstanding work stays visible. Checkpoints are personal, survive refreshes, and reject stale updates or marking while rewound before the latest review.

`src/components/PatientCharts.tsx` adds the combined systolic/diastolic/MAP chart and interactive measurement-availability heatmap. The heatmap switches between vitals and laboratories, supports selected-cell values and arrow-key navigation, and preserves missing hours. `SepsisInsights.tsx` adds recorded alert-hour markers with links to review status. A light-blue clinician-priority panel uses bold status text and a prominent action button. Chart traces remain static during data refreshes.

Family accounts have a separate, server-authorized view containing only assigned patients' heart rate, oxygen saturation, systolic pressure, observation hours, and approved updates. Clinical-only controls and records are excluded from their API responses.

The LightGBM sepsis predictor is connected through the backend. Scores, threshold bands, SHAP contributions, and score history come from saved model results; the replay clock calculates new results and crossing alerts automatically. The baseline detector remains disconnected. Gemini guidance, chat and editable AI handovers are available after backend configuration; template handovers remain available without a key. Example controls, example chat, preset login shortcuts, repeated demo badges, and Help & resources were removed from the interface; source labels, model limitations, and external-AI consent remain. See the [integration guide](../api/INTEGRATIONS.md). No API key is required for sepsis inference, which runs locally on the backend CPU. Gemini uses a separate backend-only key.

The PhysioNet sample and its attribution are private backend assets under `api/demo/`. All demo identities and clinical profiles are fictional; seven additional held-out recordings are seeded automatically, and five streams remain synthetic. The held-out evaluation manifest stays outside clinical context. Source labels distinguish recorded and synthetic readings. The clinical parser excludes outcome labels, and history is limited to the shared replay hour.


## Educational Gemini features

The sepsis panel includes a separate suggested-review-steps component. It polls durable generation state, preserves earlier successful guidance, displays supplied evidence/reference provenance, and supports explicit planned/completed actions. Chat and handover use the same backend snapshots. The frontend never receives an API key or calls Google directly. Free-text questions require fictional/demo-content confirmation; notes are excluded unless similarly confirmed. Template handovers remain available when Gemini is off. See the root README and api/INTEGRATIONS.md for setup and limitations.

`ChatReply.tsx` safely renders limited Markdown as React paragraphs, headings, bullet/numbered lists, and bold statistics, without executing HTML. It removes internal evidence markers from displayed prose and offers readable sources. Optional charts use only referenced observations or score history from the reply's saved generation snapshot; they preserve zero values, missing hours, the original cutoff, and supplied units. They do not use model-generated chart values or later replay data. `chat.ts` contains formatting and snapshot-chart helpers with regression tests.
