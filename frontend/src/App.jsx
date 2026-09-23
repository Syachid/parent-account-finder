import { useEffect, useState } from "react";

// Always call the backend same-origin via relative /api paths. In production the
// ingress routes /api to the backend; in local dev the Vite proxy forwards /api to
// the backend on :8000. Never hardcode an absolute API URL.

const STATUS_LABEL = {
  is_suggested_parent: "Is the suggested parent",
  already_under_suggested_parent: "Already under suggested parent",
  needs_mapping: "Needs mapping",
};

const STATUS_CLASS = {
  is_suggested_parent: "bg-slate-200 text-slate-700",
  already_under_suggested_parent: "bg-emerald-100 text-emerald-800",
  needs_mapping: "bg-amber-100 text-amber-800",
};

function StatusBadge({ status }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status] || "bg-slate-100 text-slate-600"}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function GroupTable({ group, searchedAccountId, opportunityStage }) {
  // Stage belongs to an Opportunity, not an Account, and an Account can have many
  // Opportunities in different stages — so this column only has a real answer for the
  // one row that's the Account actually looked up (via the Opportunity ID that
  // carried this stage). Other members in the group show "—" rather than a guess.
  const showStageColumn = Boolean(opportunityStage);
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 px-4 py-2">
        <span className="text-sm font-medium text-slate-700">{group.matched_label}</span>
        <span className="text-xs text-slate-500">
          Suggested parent:{" "}
          <span className="font-medium text-slate-700">
            {group.suggested_parent_name || "—"} (ID {group.suggested_parent_id})
          </span>{" "}
          {group.has_existing_parent ? "— already set on an existing member" : "— no member had a parent yet"}
        </span>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-white text-xs uppercase text-slate-400">
          <tr>
            <th className="px-4 py-2">Account ID</th>
            <th className="px-4 py-2">Account Name</th>
            <th className="px-4 py-2">Account Owner</th>
            {showStageColumn && <th className="px-4 py-2">Stage</th>}
            <th className="px-4 py-2">Current Parent</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {group.members.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{m.id}</td>
              <td className="px-4 py-2 text-slate-800">{m.name}</td>
              <td className="px-4 py-2 text-slate-600">{m.owner_name || "—"}</td>
              {showStageColumn && (
                <td className="px-4 py-2 text-slate-600">
                  {m.id === searchedAccountId ? opportunityStage : "—"}
                </td>
              )}
              <td className="px-4 py-2 text-slate-600">
                {m.current_parent_id ? `${m.current_parent_name || "—"} (${m.current_parent_id})` : "—"}
              </td>
              <td className="px-4 py-2">
                <StatusBadge status={m.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SingleResult({ result }) {
  if (!result.resolved) {
    return (
      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not resolve ID {result.input_id} as an Account or an Opportunity
        {result.note === "opportunity_account_not_found" ? " — its Account could not be found." : "."}
      </div>
    );
  }
  return (
    <div className="mt-4">
      {result.input_type === "opportunity" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-800">
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium uppercase text-indigo-700">
            Opportunity ID
          </span>
          <span className="font-mono">{result.input_id}</span>
          <span className="text-indigo-400">→</span>
          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium uppercase text-indigo-700">
            Account ID
          </span>
          <span className="font-mono font-semibold">{result.account_id}</span>
          {result.opportunity_stage && (
            <>
              <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium uppercase text-indigo-700">
                Stage
              </span>
              <span className="font-medium">{result.opportunity_stage}</span>
            </>
          )}
        </div>
      )}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-xs font-medium uppercase text-slate-400">Account</span>
            <div className="text-base font-semibold text-slate-900">
              {result.account_name}{" "}
              <span className="font-mono text-sm font-semibold text-indigo-600">ID {result.account_id}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-600">Owner: {result.account_owner || "—"}</div>
            <button
              onClick={() =>
                downloadCsv(
                  flattenBatchResults([result]),
                  `parent_account_${result.account_id || result.input_id}.csv`,
                )
              }
              className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
            >
              Download CSV
            </button>
          </div>
        </div>
        <div className="mt-1 text-sm text-slate-600">
          Current Parent:{" "}
          {result.current_parent_id
            ? `${result.current_parent_name || "—"} (${result.current_parent_id})`
            : "None set"}
        </div>
        {!result.in_mirror && (
          <div className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Not in the last mirror sync — duplicate detection above may be incomplete. Click "Sync now" for
            complete results.
          </div>
        )}
      </div>
      {result.groups.length === 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No likely duplicates found for this Account.
        </div>
      ) : (
        result.groups.map((group, i) => (
          <GroupTable
            key={i}
            group={group}
            searchedAccountId={result.account_id}
            opportunityStage={result.opportunity_stage}
          />
        ))
      )}
    </div>
  );
}

const INPUT_TYPE_LABEL = { account: "Account", opportunity: "Opportunity" };

function inputTypeLabel(inputType) {
  return INPUT_TYPE_LABEL[inputType] || "";
}

function flattenBatchResults(results) {
  const rows = [];
  for (const r of results) {
    const input_type = inputTypeLabel(r.input_type);
    const opportunity_stage = r.opportunity_stage || "";
    if (!r.resolved) {
      rows.push({
        input_id: r.input_id, input_type, opportunity_stage, account_id: null, account_name: "ID not found",
        account_owner: null, current_parent_id: null, current_parent_name: null, match_type: "Error",
        suggested_parent_id: null, suggested_parent_name: null, status: "not_found",
      });
      continue;
    }
    if (r.groups.length === 0) {
      rows.push({
        input_id: r.input_id, input_type, opportunity_stage, account_id: r.account_id, account_name: r.account_name,
        account_owner: r.account_owner, current_parent_id: r.current_parent_id,
        current_parent_name: r.current_parent_name, match_type: "No duplicates found",
        suggested_parent_id: null, suggested_parent_name: null, status: "no_duplicates",
      });
      continue;
    }
    for (const group of r.groups) {
      for (const m of group.members) {
        rows.push({
          input_id: r.input_id, input_type, opportunity_stage, account_id: m.id, account_name: m.name,
          account_owner: m.owner_name, current_parent_id: m.current_parent_id,
          current_parent_name: m.current_parent_name, match_type: group.matched_label,
          suggested_parent_id: group.suggested_parent_id, suggested_parent_name: group.suggested_parent_name,
          status: m.status,
        });
      }
    }
  }
  return rows;
}

// Column order for the CSV export — mirrors the backend's EXPORT_COLUMNS so the
// client-side CSV and the server-side .xlsx line up.
const CSV_COLUMNS = [
  ["input_id", "Input ID"],
  ["input_type", "Input Type"],
  ["opportunity_stage", "Opportunity Stage"],
  ["account_id", "Account ID"],
  ["account_name", "Account Name"],
  ["account_owner", "Account Owner"],
  ["current_parent_id", "Current Parent ID"],
  ["current_parent_name", "Current Parent Name"],
  ["match_type", "Match Type"],
  ["suggested_parent_id", "Suggested Parent ID"],
  ["suggested_parent_name", "Suggested Parent Name"],
  ["status", "Status"],
];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  const header = CSV_COLUMNS.map(([, label]) => label).join(",");
  const body = rows.map((r) => CSV_COLUMNS.map(([key]) => csvEscape(r[key])).join(","));
  return [header, ...body].join("\r\n");
}

function downloadCsv(rows, filename) {
  // Prepend a UTF-8 BOM so Excel opens the file with the right encoding.
  const blob = new Blob(["﻿" + rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Backend sends naive UTC datetime strings, space-separated (e.g. "2026-09-23
// 03:29:04", from Python's str(datetime)) rather than ISO's "T" separator — normalize
// both before parsing as UTC explicitly, otherwise the browser reads them as local
// time and every derived time (the "N minutes ago" math, the formatted display below)
// comes out hours off.
function parseUtc(isoLike) {
  if (!isoLike) return null;
  const normalized = isoLike.includes("T") ? isoLike : isoLike.replace(" ", "T");
  const ms = Date.parse(normalized.endsWith("Z") ? normalized : normalized + "Z");
  return Number.isNaN(ms) ? null : ms;
}

// Renders a backend UTC timestamp in the viewer's own local time/timezone, so "last
// synced" doesn't require mentally converting from UTC.
function formatLocal(isoLike) {
  const ms = parseUtc(isoLike);
  if (ms == null) return null;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function minutesAgoLabel(startedAtIso, nowMs) {
  const startedMs = parseUtc(startedAtIso);
  if (startedMs == null) return null;
  const mins = Math.max(0, Math.floor((nowMs - startedMs) / 60000));
  if (mins < 1) return "just started";
  return `started ${mins} minute${mins === 1 ? "" : "s"} ago`;
}

export default function App() {
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [syncStartedAt, setSyncStartedAt] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [singleId, setSingleId] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleResult, setSingleResult] = useState(null);
  const [singleError, setSingleError] = useState(null);

  const [batchText, setBatchText] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchJobId, setBatchJobId] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchRows, setBatchRows] = useState(null);
  const [batchError, setBatchError] = useState(null);

  const loadSyncStatus = () => {
    fetch("/api/sync/status")
      .then((r) => r.json())
      .then((status) => setLastSyncedAt(status.last_synced_at))
      .catch(() => {});
  };

  // Ticks once a minute while a sync is running so the "started N minutes ago" label
  // stays current without polling the backend any harder than the status loop below.
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [syncing]);

  const pollSyncStatus = async () => {
    for (;;) {
      await sleep(3000);
      const statusResp = await fetch("/api/sync/status");
      const status = await statusResp.json();
      if (status.last_result) setSyncProgress(status.last_result.upserted);
      if (status.current_run_started_at) setSyncStartedAt(status.current_run_started_at);
      if (!status.in_progress) {
        if (status.last_result?.error) setSyncError(`Sync failed: ${status.last_result.error}`);
        break;
      }
    }
  };

  useEffect(() => {
    // Picks up a sync that's already running when the page loads — e.g. someone else
    // clicked "Sync now", or you reloaded mid-sync — instead of showing a stale idle
    // button while a real sync is in flight.
    fetch("/api/sync/status")
      .then((r) => r.json())
      .then((status) => {
        setLastSyncedAt(status.last_synced_at);
        if (status.in_progress) {
          setSyncing(true);
          setSyncStartedAt(status.current_run_started_at);
          pollSyncStatus().finally(() => {
            setSyncing(false);
            setSyncProgress(null);
            setSyncStartedAt(null);
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncProgress(null);
    setSyncStartedAt(null);
    try {
      const startResp = await fetch("/api/sync/crm", { method: "POST" });
      const start = await startResp.json();
      if (start.error) {
        setSyncError(`Sync failed: ${start.error}`);
        return;
      }
      await pollSyncStatus();
      loadSyncStatus();
    } catch {
      setSyncError("Sync failed — could not reach the backend");
    } finally {
      setSyncing(false);
      setSyncProgress(null);
      setSyncStartedAt(null);
    }
  };

  const handleSingleLookup = async (e) => {
    e.preventDefault();
    const trimmed = singleId.trim();
    if (!trimmed) return;
    setSingleLoading(true);
    setSingleError(null);
    setSingleResult(null);
    try {
      const resp = await fetch(`/api/lookup?id=${encodeURIComponent(trimmed)}`);
      if (!resp.ok) throw new Error();
      setSingleResult(await resp.json());
    } catch {
      setSingleError("Lookup failed — check the ID and try again");
    } finally {
      setSingleLoading(false);
    }
  };

  const pollBatchJob = async (jobId) => {
    for (;;) {
      await sleep(1500);
      const statusResp = await fetch(`/api/lookup/batch/${jobId}/status`);
      const status = await statusResp.json();
      setBatchProgress({ processed: status.processed, total: status.total });
      if (status.status === "done") {
        const resultsResp = await fetch(`/api/lookup/batch/${jobId}/results`);
        const { results } = await resultsResp.json();
        setBatchRows(flattenBatchResults(results));
        break;
      }
      if (status.status === "error") {
        setBatchError(status.error || "Batch job failed");
        break;
      }
    }
  };

  const handleBatchRun = async () => {
    const ids = batchText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setBatchLoading(true);
    setBatchError(null);
    setBatchRows(null);
    setBatchJobId(null);
    setBatchProgress(null);
    try {
      const resp = await fetch("/api/lookup/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.detail || "Batch failed to start");
      setBatchJobId(body.job_id);
      await pollBatchJob(body.job_id);
    } catch (err) {
      setBatchError(err.message || "Batch failed to start");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file name
    if (!file) return;
    setBatchLoading(true);
    setBatchError(null);
    setBatchRows(null);
    setBatchJobId(null);
    setBatchProgress(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/upload", { method: "POST", body: formData });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.detail || "Upload failed");
      setBatchJobId(body.job_id);
      await pollBatchJob(body.job_id);
    } catch (err) {
      setBatchError(err.message || "Upload failed");
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Parent Account Finder</h1>
            <p className="mt-1 text-sm text-slate-600">
              Look up an Account ID or Opportunity ID and see whether that Account has likely
              duplicate-name matches that should be grouped under one Parent Account — for review
              and correction manually in CRM. This app never writes back to CRM.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Duplicate detection is based on a mirror last synced:{" "}
              {lastSyncedAt ? formatLocal(lastSyncedAt) : "never — click Sync now"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {syncing ? (syncProgress != null ? `Syncing… (${syncProgress})` : "Syncing…") : "Sync now"}
            </button>
            {syncing && syncStartedAt && (
              <span className="text-xs text-slate-400">{minutesAgoLabel(syncStartedAt, nowTick)}</span>
            )}
            {syncError && <span className="text-xs text-red-600">{syncError}</span>}
          </div>
        </div>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Single lookup</h2>
          <form onSubmit={handleSingleLookup} className="mt-3 flex gap-2">
            <input
              type="text"
              value={singleId}
              onChange={(e) => setSingleId(e.target.value)}
              placeholder="Account ID or Opportunity ID, e.g. 1421275"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={singleLoading}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {singleLoading ? "Finding…" : "Find"}
            </button>
          </form>
          {singleError && <p className="mt-2 text-sm text-red-600">{singleError}</p>}
          {singleResult && <SingleResult result={singleResult} />}
        </section>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Batch lookup</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste one Account/Opportunity ID per line, or upload an .xlsx or .csv file with a single
            column of mixed IDs — the type of each ID is auto-detected.
          </p>
          <textarea
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            rows={6}
            placeholder={"1421275\n908980\n..."}
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={handleBatchRun}
              disabled={batchLoading || batchText.trim() === ""}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {batchLoading ? "Running…" : "Run batch"}
            </button>
            <span className="text-sm text-slate-400">or</span>
            <label className="cursor-pointer rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Upload .xlsx / .csv
              <input type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden" onChange={handleFileUpload} disabled={batchLoading} />
            </label>
            {batchProgress && (
              <span className="text-xs text-slate-500">
                Processed {batchProgress.processed} / {batchProgress.total}
              </span>
            )}
            {batchJobId && batchRows && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => downloadCsv(batchRows, `parent_account_lookup_${batchJobId}.csv`)}
                  className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  Download CSV
                </button>
                <a
                  href={`/api/lookup/batch/${batchJobId}/results.xlsx`}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download Excel
                </a>
              </div>
            )}
          </div>
          {batchError && <p className="mt-2 text-sm text-red-600">{batchError}</p>}

          {batchRows && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Input ID</th>
                    <th className="px-3 py-2">Input Type</th>
                    <th className="px-3 py-2">Opportunity Stage</th>
                    <th className="px-3 py-2">Account ID</th>
                    <th className="px-3 py-2">Account Name</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Current Parent</th>
                    <th className="px-3 py-2">Match Type</th>
                    <th className="px-3 py-2">Suggested Parent</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {batchRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.input_id}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.input_type || "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.opportunity_stage || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.account_id ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-800">{row.account_name}</td>
                      <td className="px-3 py-2 text-slate-600">{row.account_owner || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {row.current_parent_id ? `${row.current_parent_name || "—"} (${row.current_parent_id})` : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.match_type}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {row.suggested_parent_id
                          ? `${row.suggested_parent_name || "—"} (${row.suggested_parent_id})`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
