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
import { useState } from "react";
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
  workflow?: {version: string | null; owner_id: string | null; owner_name: string | null; due_hour: number | null; follow_up: string; overdue: boolean; due_now: boolean};
  history?: {id: string; hour: number; actorName: string; text: string}[];
};
export type AlertFilter = "Active" | "Follow-up" | "Resolved" | "All";
export type WorkflowOperation = "claim" | "release" | "schedule" | "complete";
type FeedProps = {
  alerts: ClinicalAlert[];
  patients: Patient[];
  hour: number;
  busy: boolean;
  compact?: boolean;
  onPatient: (patient: Patient) => void;
  onStatus: (id: string, status: AlertState["status"]) => void;
  viewerId?: string;
  maxHour?: number;
  onWorkflow?: (alert: ClinicalAlert, operation: WorkflowOperation, dueHour?: number) => void;
};
type CenterProps = FeedProps & {
  patientScope: string | null;
  onPatientScope: (id: string | null) => void;
  filter: AlertFilter;
  onFilter: (filter: AlertFilter) => void;
  scoringAvailable: boolean;
  scoringReason?: string;
};

function AlertFollowUp({alert, hour, busy, viewerId, maxHour, onWorkflow}: {alert: ClinicalAlert; hour: number; busy: boolean; viewerId?: string; maxHour?: number; onWorkflow: NonNullable<FeedProps['onWorkflow']>}) {
  const [due, setDue] = useState('');
  const state = alert.workflow;
  const mine = state?.owner_id === viewerId;
  const pending = state?.follow_up === 'scheduled';
  return <section className={`arc-follow-up ${state?.overdue ? 'arc-follow-up-overdue' : ''}`} aria-label="Alert ownership and follow-up">
    <div className="arc-follow-up-state"><div><span>Review owner</span><strong>{state?.owner_name || 'Unassigned'}</strong></div><div><span>Follow-up</span><strong>{pending ? `${state?.overdue ? 'Overdue' : state?.due_now ? 'Due now' : 'Scheduled'} · hour ${state?.due_hour}` : state?.follow_up === 'completed' ? 'Completed' : 'Not scheduled'}</strong></div></div>
    <div className="arc-follow-up-controls">
      {!state?.owner_id && alert.status !== 'Resolved' && <button className="button secondary" disabled={busy} onClick={() => onWorkflow(alert,'claim')}>Take ownership</button>}
      {mine && <>
        <form onSubmit={e => {e.preventDefault(); onWorkflow(alert,'schedule',Number(due));}}>
          <label>Follow-up at patient hour<input aria-label={`Follow-up hour for ${alert.patientId} alert at hour ${alert.hour}`} type="number" min={hour+1} max={maxHour} required value={due} placeholder={String(hour+1)} onChange={e => setDue(e.target.value)} /></label>
          <button className="button secondary" disabled={busy || !due || Number(due)<=hour || Number(due)>(maxHour ?? Infinity)}>{pending ? 'Reschedule' : 'Schedule'}</button>
        </form>
        {pending ? <button className="button dark" disabled={busy} onClick={() => onWorkflow(alert,'complete')}><CheckCircle size={17}/>Record follow-up done</button> : <button className="text-link" disabled={busy} onClick={() => onWorkflow(alert,'release')}>Release ownership</button>}
      </>}
    </div>
    {mine && <small>Uses patient hours, not wall-clock time. Completion does not resolve the alert.</small>}
  </section>
}

function AlertCard({
  alert,
  patient,
  hour,
  busy,
  compact,
  onPatient,
  onStatus,
  viewerId,
  maxHour,
  onWorkflow,
}: {
  alert: ClinicalAlert;
  patient?: Patient;
  hour: number;
  busy: boolean;
  compact: boolean;
  onPatient: FeedProps["onPatient"];
  onStatus: FeedProps["onStatus"];
  viewerId?: string;
  maxHour?: number;
  onWorkflow?: FeedProps['onWorkflow'];
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

      {!compact && onWorkflow && <AlertFollowUp alert={alert} hour={hour} busy={busy} viewerId={viewerId} maxHour={maxHour} onWorkflow={onWorkflow}/>}
      {compact && alert.workflow?.follow_up === 'scheduled' && <section className={`arc-followup-summary ${alert.workflow.overdue ? 'is-overdue' : ''}`} aria-label="Follow-up reminder">
        <div className="arc-followup-summary-heading"><Clock size={20}/><strong>{alert.workflow.overdue ? 'Follow-up overdue' : alert.workflow.due_now ? 'Follow-up due now' : 'Follow-up scheduled'}</strong></div>
        {alert.workflow.overdue && <p className="arc-followup-delay">{hour - alert.workflow.due_hour!} patient {hour - alert.workflow.due_hour! === 1 ? 'hour' : 'hours'} overdue</p>}
        <dl><div><dt>Due at</dt><dd>Hour {alert.workflow.due_hour}</dd></div><div><dt>Review owner</dt><dd>{alert.workflow.owner_name || 'Unassigned'}</dd></div></dl>
      </section>}
      {!compact && !!alert.history?.length && <details className="arc-details"><summary>Response timeline <ChevronDown size={18}/></summary><ol className="arc-response-timeline">{alert.history.map(e => <li key={e.id}><strong>Hour {e.hour} · {e.actorName}</strong><p>{e.text}</p></li>)}</ol></details>}
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
  viewerId,
  maxHour,
  onWorkflow,
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
          viewerId={viewerId}
          maxHour={maxHour}
          onWorkflow={onWorkflow}
        />
      ))}
    </div>
  );
}

export function AlertCenter({
  alerts,
  patients,
  patientScope,
  onPatientScope,
  hour,
  busy,
  filter,
  onFilter,
  onPatient,
  onStatus,
  scoringAvailable,
  scoringReason,
  viewerId,
  maxHour,
  onWorkflow,
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
      (filter === "Follow-up" ? alert.workflow?.follow_up === 'scheduled' : filter === "Resolved"
        ? alert.status === "Resolved"
        : alert.status !== "Resolved"),
  );
  const counts = {
    Active: open + reviewing,
    'Follow-up': alerts.filter(a => a.workflow?.follow_up === 'scheduled').length,
    Resolved: resolved,
    All: alerts.length,
  };
  const emptyTitle =
    !scoringAvailable && !alerts.length
      ? "Scoring is unavailable"
      : filter === "Follow-up" ? "No pending follow-ups" : filter === "Resolved"
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
        : filter === "Follow-up" ? "Scheduled reassessments appear here until recorded as completed." : "There are no alerts in this view. A low score or an empty list does not rule out sepsis.";

  return (
    <div className="alert-workspace">
      <header className="aw-heading">
        <div>
          <h1>Alert center</h1>
          <p>{patientScope ? 'Alerts for the selected patient.' : 'Alerts across all patients.'} Acknowledged alerts remain under review until resolved.</p>
        </div>
        <span>
          <Clock size={18} /> Patient hour <b>{hour}</b>
        </span>
      </header>
      <section className="panel aw-board" aria-label="Patient alert review">
        <div className="aw-patient-scope">
          <label htmlFor="alert-patient-scope">Patient</label>
          <select id="alert-patient-scope" value={patientScope || ''} onChange={e => onPatientScope(e.target.value || null)}>
            <option value="">All patients</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.name} · Bed {p.bed}</option>)}
          </select>
        </div>
        <dl className="aw-summary">
          <div><dt>Follow-up due / overdue</dt><dd className={alerts.some(a => a.workflow?.overdue) ? 'aw-count-open' : ''}>{alerts.filter(a => a.workflow?.overdue || a.workflow?.due_now).length.toString().padStart(2,'0')}</dd></div>
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
            {(["Active", "Follow-up", "Resolved", "All"] as const).map((tab) => (
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
            viewerId={viewerId}
            maxHour={maxHour}
            onWorkflow={onWorkflow}
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
