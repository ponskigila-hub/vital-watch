import {
  Activity,
  ArrowRight,
  Bell,
  CheckCircle,
  ChevronDown,
  Clock,
  Info,
} from "react-feather";
import type { AlertState, Band, Patient } from "../data";
import "./alert-center.css";

export type ClinicalAlert = {
  id: string;
  patientId: string;
  hour: number;
  title: string;
  detail: string;
  band: Band;
  origin: string;
  status: AlertState["status"];
};
export type AlertFilter = "Active" | "Resolved" | "All";
type FeedProps = {
  alerts: ClinicalAlert[];
  patients: Patient[];
  hour: number;
  busy: boolean;
  compact?: boolean;
  onPatient: (patient: Patient) => void;
  onStatus: (id: string, status: AlertState["status"]) => void;
};
type CenterProps = FeedProps & {
  filter: AlertFilter;
  onFilter: (filter: AlertFilter) => void;
  scoringAvailable: boolean;
  scoringReason?: string;
};

function AlertCard({
  alert,
  patient,
  hour,
  busy,
  compact,
  onPatient,
  onStatus,
}: {
  alert: ClinicalAlert;
  patient?: Patient;
  hour: number;
  busy: boolean;
  compact: boolean;
  onPatient: FeedProps["onPatient"];
  onStatus: FeedProps["onStatus"];
}) {
  const name = patient?.name || alert.patientId;
  const resolved = alert.status === "Resolved";
  const statusLabel =
    alert.status === "Open" ? "Awaiting acknowledgement" : alert.status;
  const eventTitle =
    alert.origin === "model" ? "Sepsis threshold crossed" : alert.title;
  const currentBand =
    patient?.prediction.as_of_hour === hour && patient.score != null
      ? patient.band
      : null;
  return (
    <article
      className={`alert-review-card ${compact ? "arc-compact" : ""} ${resolved ? "arc-resolved" : ""}`}
      aria-label={`${name} alert at hour ${alert.hour}`}
    >
      <div className="arc-heading">
        <div className="arc-patient">
          {patient ? (
            <button onClick={() => onPatient(patient)}>
              {name}
              <ArrowRight size={18} />
            </button>
          ) : (
            <strong>{name}</strong>
          )}
          <span>
            {patient ? `Bed ${patient.bed}` : "Patient record not loaded"}
            {!compact && (
              <>
                <span className="arc-meta-dot">·</span>
                <span className="arc-record-id">{alert.patientId}</span>
              </>
            )}
          </span>
        </div>
        <span
          className={`arc-status arc-status--${alert.status === "Open" ? "open" : resolved ? "resolved" : "reviewing"}`}
        >
          <i />
          {compact && alert.status === "Open" ? "Open" : statusLabel}
        </span>
      </div>

      <div className="arc-event">
        <Activity size={20} />
        <h3>{eventTitle}</h3>
        {alert.origin !== "model" && (
          <span className="arc-example">Example</span>
        )}
      </div>
      <div className="arc-context">
        <span>
          <Clock size={16} /> Recorded at hour <b>{alert.hour}</b>
        </span>
        {!compact && (
          <span>
            Current signal: <b>{currentBand || "Not available"}</b>
          </span>
        )}
      </div>

      <div className="arc-actions">
        {!compact && patient && (
          <button
            className="button secondary"
            onClick={() => onPatient(patient)}
          >
            Review patient <ArrowRight size={17} />
          </button>
        )}
        {alert.status === "Open" ? (
          <button
            className="button dark"
            disabled={busy}
            aria-label={`Acknowledge ${name} alert at hour ${alert.hour}`}
            onClick={() => onStatus(alert.id, "Acknowledged")}
          >
            <CheckCircle size={17} /> Acknowledge
          </button>
        ) : (
          <label className="arc-status-control">
            Update status
            <select
              aria-label={`Status for ${name} alert at hour ${alert.hour}`}
              disabled={busy}
              value={alert.status}
              onChange={(event) =>
                onStatus(alert.id, event.target.value as AlertState["status"])
              }
            >
              <option>Acknowledged</option>
              <option>In progress</option>
              <option>Resolved</option>
            </select>
          </label>
        )}
      </div>

      {!compact && (
        <details className="arc-details">
          <summary>
            <span>Event details</span>
            <ChevronDown size={18} />
          </summary>
          <div>
            <p>
              <strong>Recorded event:</strong> {alert.title}
            </p>
            <p>{alert.detail}</p>
            <p className="arc-provenance">
              {alert.origin === "model"
                ? "Saved model output at the time of the alert."
                : "Illustrative output, not a computed patient assessment."}{" "}
              Current readings and scores may differ.
            </p>
          </div>
        </details>
      )}
    </article>
  );
}

export function AlertFeed({
  alerts,
  patients,
  hour,
  busy,
  compact = false,
  onPatient,
  onStatus,
}: FeedProps) {
  return (
    <div
      className={
        compact ? "alert-review-feed arf-compact" : "alert-review-feed"
      }
    >
      {(compact ? alerts.slice(0, 2) : alerts).map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          patient={patients.find((patient) => patient.id === alert.patientId)}
          hour={hour}
          busy={busy}
          compact={compact}
          onPatient={onPatient}
          onStatus={onStatus}
        />
      ))}
    </div>
  );
}

export function AlertCenter({
  alerts,
  patients,
  hour,
  busy,
  filter,
  onFilter,
  onPatient,
  onStatus,
  scoringAvailable,
  scoringReason,
}: CenterProps) {
  const open = alerts.filter((alert) => alert.status === "Open").length;
  const reviewing = alerts.filter(
    (alert) =>
      alert.status === "Acknowledged" || alert.status === "In progress",
  ).length;
  const resolved = alerts.filter((alert) => alert.status === "Resolved").length;
  const visible = alerts.filter(
    (alert) =>
      filter === "All" ||
      (filter === "Resolved"
        ? alert.status === "Resolved"
        : alert.status !== "Resolved"),
  );
  const counts = {
    Active: open + reviewing,
    Resolved: resolved,
    All: alerts.length,
  };
  const emptyTitle =
    !scoringAvailable && !alerts.length
      ? "Scoring is unavailable"
      : filter === "Resolved"
        ? "No resolved alerts yet"
        : filter === "Active"
          ? "No active alerts through this hour"
          : "No alerts through this hour";
  const emptyText =
    !scoringAvailable && !alerts.length
      ? scoringReason ||
        "Check the prediction connection in workspace settings."
      : filter === "Resolved"
        ? "Alerts appear here after a clinician marks them as resolved."
        : "There are no alerts in this view. A low score or an empty list does not rule out sepsis.";

  return (
    <div className="alert-workspace">
      <header className="aw-heading">
        <div>
          <h1>Alert center</h1>
          <p>Review and update patient alerts.</p>
        </div>
        <span>
          <Clock size={18} /> Patient hour <b>{hour}</b>
        </span>
      </header>
      <section className="panel aw-board" aria-label="Patient alert review">
        <dl className="aw-summary">
          <div>
            <dt>Awaiting acknowledgement</dt>
            <dd className={open ? "aw-count-open" : ""}>
              {open.toString().padStart(2, "0")}
            </dd>
          </div>
          <div>
            <dt>Under review</dt>
            <dd>{reviewing.toString().padStart(2, "0")}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{resolved.toString().padStart(2, "0")}</dd>
          </div>
        </dl>
        <div className="aw-toolbar">
          <div aria-label="Filter alerts">
            {(["Active", "Resolved", "All"] as const).map((tab) => (
              <button
                key={tab}
                aria-pressed={filter === tab}
                className={filter === tab ? "aw-filter-active" : ""}
                onClick={() => onFilter(tab)}
              >
                {tab}
                <span>{counts[tab]}</span>
              </button>
            ))}
          </div>
          <span>Newest first</span>
        </div>
        {visible.length > 0 ? (
          <AlertFeed
            alerts={visible}
            patients={patients}
            hour={hour}
            busy={busy}
            onPatient={onPatient}
            onStatus={onStatus}
          />
        ) : (
          <div className="aw-empty">
            <Bell size={28} />
            <h2>{emptyTitle}</h2>
            <p>{emptyText}</p>
          </div>
        )}
      </section>
      <div className="aw-explainer">
        <Info size={19} />
        <p>
          Research alerts, not diagnoses. Clinicians review and resolve alerts;
          scores never auto-resolve them.
        </p>
      </div>
    </div>
  );
}
