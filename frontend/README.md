# VitalWatch frontend

React, TypeScript, Vite, Recharts, Lucide, and GSAP clinical workspace with locally bundled Geist fonts. This frontend connects to the authenticated FastAPI backend; follow the [repository setup guide](../README.md) to start both services and obtain the generated demo sign-in details.

```sh
npm install
npm run dev
npm run build
```

Vite proxies `/api` to `http://127.0.0.1:8000`. For a production preview, build this frontend and run the backend, which serves the build and API together. Vite's standalone preview command does not provide the backend proxy.

The clinical workspace includes patient search, all six primary vital histories, DBP/EtCO2 and 26 additional measurement fields, missing-data states, shared replay, notes, manual monitoring focus and review priority, example alerts, structured handovers, approved family updates, and PSV import. Care records and imports persist on the server. Editable handover changes must be saved explicitly.

Family accounts have a separate, server-authorized view containing only assigned patients' heart rate, oxygen saturation, systolic pressure, observation hours, and approved updates. Clinical-only controls and records are excluded from their API responses.

The sepsis predictor, baseline detector, and Gemini are disconnected. Example scores, alerts, and conversations are visibly labelled. See the [integration templates](../api/INTEGRATIONS.md) for the future provider contracts. No API key is required for the current app, and no patient content is sent to a model service.

The PhysioNet sample and its attribution are private backend assets under `api/demo/`. All demo identities and clinical profiles are fictional; the remaining five seeded streams are synthetic. Source labels distinguish recorded and synthetic readings. The clinical parser excludes outcome labels, and history is limited to the shared replay hour.
