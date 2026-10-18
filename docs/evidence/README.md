# LinuxONE evidence provenance

Collected on 18 October 2026 from the supplied IBM LinuxONE VM and its hosted VitalWatch application. The raw SSH/HTTP collection began at **12:55:38 UTC**. Browser screenshots were taken shortly afterwards.

| Artifact | Source |
| --- | --- |
| `linuxone-verification.json` | Actual JSON export collected through SSH: host architecture, OS, kernel, CPU count, deployed commit, listening process, container-runtime availability, and HTTP responses from that host's loopback service |
| `linuxone-host.txt` | Readable export of the same collection; this is a report, not a terminal screenshot |
| `api-health.json`, `api-ready.json`, `api-metrics.json` | Response bodies extracted from the raw collection; HTTP statuses are preserved in `linuxone-verification.json` |
| `linuxone-app.png` | Unedited browser screenshot of `http://148.100.108.67:8000/` after clinician sign-in; replayed records and fictional display identities |
| `linuxone-metrics.png` | Unedited browser screenshot of `http://148.100.108.67:8000/api/metrics` with the browser's Pretty-print option enabled |

The inspected checkout was `4b0d7a3eadeb539e66b3b67dc0ee7b97aaf787d6`. The service was a direct Uvicorn Python process, not a container. Neither `podman` nor `docker` was available in the SSH user's PATH. Container configuration in the repository is not proof of container execution.

Uptime, request counts, and last-request latency are point-in-time process observations; screenshot counters naturally differ from the earlier SSH capture. Inference latency was `null`, so this evidence does not establish an inference benchmark. No hardware accelerator, second running AI framework, clinical validation, or improved patient outcome is demonstrated by these files.

Credentials, cookies, private configuration, database contents, and unreviewed server logs are excluded. No replay position, patient record, alert, or model setting was changed to collect this evidence.
