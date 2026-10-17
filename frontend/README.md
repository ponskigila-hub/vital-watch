# VitalWatch frontend

A local, interactive clinical workspace built with React, TypeScript, Vite, Recharts, Lucide, and GSAP. Geist fonts are bundled locally.

## Run

```sh
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` performs TypeScript checking and creates a production build. `npm run preview` serves that build locally.

## Included

- Ward overview, patient search and priority filters.
- Patient history for all six main vitals together, expandable individual charts, six-hour comparisons per measurement, and an inspectable hourly data table.
- Additional DBP/EtCO2 history and a selector covering all 26 laboratory/recorded-measurement fields, with explicit no-data states.
- A measurement selector for all six main trends in the family preview.
- Hourly replay with pause, seek, speed selection, and a new-session control.
- Example alert acknowledgement, status updates, clinical priority overrides with reasons, notes, and an event timeline.
- Free-text monitoring focus. Respiratory and cardiovascular presets emphasize oxygen saturation and systolic pressure respectively; unsupported focuses remain labels without automated medical guidance.
- Structured editable handovers and text export.
- Explicit approval and withdrawal of updates in a restricted-content family **view preview**.
- Patient chat interface with labelled example conversations and an explicit disconnected state.
- PSV import, connection settings, keyboard-accessible drawers, and reduced-motion support.

## Data and limitations

The bundled `public/data/p000001.psv` is the example PhysioNet Challenge 2019 recording supplied by the user. The label column is excluded by the frontend parser. The other five initial patients use deterministic synthetic readings. All names, identities, known conditions, and medications are fictional.

Source and dataset terms: https://physionet.org/content/challenge-2019/1.0.0/

Scores and alerts are fixed **example outputs**, not computed from patient data. Disable them under Settings to inspect the disconnected state. This frontend provides no medical predictions or treatment recommendations.

Notes, overrides, focuses, drafts, chat messages, and approved updates persist in this browser's local storage. Imported recordings remain in memory for the visit. Original measurement times and missing values are preserved; history stops at the replay hour. Draft handovers are editable snapshots and can be regenerated after playback advances.

This pass intentionally has no backend, secure login, Gemini calls, trained detector, or LinuxONE deployment. The family screen is a role preview, not an authorization boundary. No API key is needed. No patient content is sent to an AI service.

For the later backend, replace the local `data.ts` reading helpers and the care-state operations in `App.tsx` with API calls. Keep real predictions separate from clinician priority overrides and maintain explicit unavailable/insufficient-history states.
