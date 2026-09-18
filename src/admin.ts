const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const adminRoot = document.querySelector<HTMLElement>('#admin');
const RESOLVED_API_BASE = API_BASE || (['nim-rush.xyz', 'www.nim-rush.xyz', 'sface.site', 'www.sface.site'].includes(window.location.hostname) ? 'https://api.sface.site' : '');
if (!adminRoot) throw new Error('Admin root is missing.');
const root = adminRoot;

let token = '';
let idleTimer: number | null = null;
let streamController: AbortController | null = null;
let pollTimer: number | null = null;

function login(message = ''): void {
  token = '';
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  streamController?.abort();
  streamController = null;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  root.innerHTML = `
    <section class="login">
      <p class="eyebrow">SFACE PANEL</p>
      <h1>Admin access</h1>
      ${message ? `<p>${message}</p>` : ''}
      <form id="login-form">
        <label>Enter admin token<input name="token" type="password" autocomplete="off" required /></label>
        <button>Open diagnostics</button>
      </form>
      <p id="error" role="alert"></p>
    </section>`;
  root.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', submitLogin);
}

async function submitLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const formElement = event.currentTarget as HTMLFormElement;
  const form = new FormData(formElement);
  const candidate = String(form.get('token') ?? '');
  const button = formElement.querySelector<HTMLButtonElement>('button');
  const error = root.querySelector<HTMLElement>('#error');
  if (button) { button.disabled = true; button.textContent = 'Checking...'; }
  if (error) error.textContent = '';
  try {
    const response = await adminFetch('/admin/api/login/check', candidate, { method: 'POST' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      if (error) error.textContent = response.status === 401 ? 'Access denied.' : 'Admin API is unavailable.';
      return;
    }
    token = candidate;
    resetIdleLock();
    await overview();
  } catch {
    if (error) error.textContent = 'Could not reach the admin API.';
  } finally {
    if (button && document.body.contains(button)) { button.disabled = false; button.textContent = 'Open diagnostics'; }
  }
}

async function overview(): Promise<void> {
  const [overviewResponse, logsResponse] = await Promise.all([
    adminFetch('/admin/api/overview', token),
    adminFetch('/admin/api/logs', token),
  ]);
  if (!overviewResponse.ok) {
    login('The session ended. Enter the admin token again.');
    return;
  }
  const data = await overviewResponse.json() as {
    uptimeSeconds: number;
    commit: string | null;
    restartSupported: boolean;
    date: string;
    persistence: { status: string; lastError: string | null };
    capabilities: Record<string, { enabled: boolean; required: boolean }>;
    config: Array<{ key: string; configured: boolean; secret: boolean; restartRequired: boolean }>;
  };
  const logs = logsResponse.ok
    ? await logsResponse.json() as { entries: Array<{ time: number; level: string; event: string; message: string }> }
    : { entries: [] };
  root.innerHTML = `
    <header><div><p class="eyebrow">SFACE PANEL</p><h1>Live diagnostics</h1></div><button id="lock">Lock</button></header>
    <section class="summary">
      <article><span>Persistence</span><strong>${data.persistence.status}</strong><small>${data.persistence.lastError ?? 'No active error'}</small></article>
      <article><span>Uptime</span><strong>${Math.floor(data.uptimeSeconds / 60)} min</strong><small>${data.commit ?? 'Commit not reported'}</small></article>
      <article><span>UTC mission day</span><strong>${data.date}</strong><small>Public health contract</small></article>
    </section>
    <section><h2>Capabilities</h2><div class="ledger">${Object.entries(data.capabilities).map(([name, state]) => `
      <article><span>${name}</span><strong class="${state.enabled ? 'on' : 'off'}">${state.enabled ? 'enabled' : 'disabled'}</strong><small>${state.required ? 'required' : 'optional'}</small></article>`).join('')}</div></section>
    <section><h2>Recent logs</h2><div class="ledger" id="live-logs">${logs.entries.slice(0, 20).map((entry) => `
      <article><span>${new Date(entry.time).toISOString()} | ${entry.level}</span><strong>${entry.event}</strong><small>${entry.message}</small></article>`).join('')}</div></section>
    <section><h2>Audit history</h2><div class="records-controls"><button id="load-audit">Load audit history</button></div><pre id="audit-output">Operator actions are loaded on demand.</pre></section>
    <section><h2>Read-only game records</h2><div class="records-controls"><select id="record-kind"><option>profiles</option><option>scores</option><option>clans</option><option>contests</option><option>challenges</option><option>tips</option><option>ghosts</option><option>chat</option><option>signals</option></select><button id="load-records">Load records</button></div><pre id="records-output">Choose a record set.</pre></section>
    <section><h2>Legacy archive</h2><div class="records-controls"><button id="load-legacy-manifest">Refresh archive metadata</button></div><pre id="legacy-manifest-output">Archive metadata is loaded on demand.</pre><div class="records-controls"><select id="legacy-record-kind"><option>profiles</option><option>scores</option><option>clans</option><option>contests</option><option>challenges</option><option>tips</option><option>ghosts</option><option>chat</option><option>signals</option></select><input id="legacy-page" type="number" min="1" value="1" aria-label="Legacy archive page" /><input id="legacy-page-size" type="number" min="1" max="100" value="50" aria-label="Legacy archive page size" /><button id="load-legacy-records">Load archived records</button></div><pre id="legacy-records-output">Choose an archived record set.</pre></section>
    <section><h2>Replace secret</h2><div class="secret-form"><select id="secret-key"><option>ADMIN_TOKEN</option><option>X_CLIENT_ID</option><option>X_CLIENT_SECRET</option><option>X_BEARER_TOKEN</option><option>XAI_API_KEY</option></select><input id="secret-value" type="password" autocomplete="off" placeholder="New value" /><button id="replace-secret">Stage replacement</button></div><p id="secret-status" role="status">Values are write-only and require restart.</p></section>
    <section><h2>Operations</h2><div class="operations"><button id="backup">Create snapshot backup</button><button id="export-diagnostics">Export diagnostics</button><button id="restart" ${data.restartSupported ? "" : "disabled"}>Restart service</button><p id="operation-status" role="status">No operation running.</p></div></section>
    <section><h2>Backup history</h2><div class="records-controls"><button id="load-backups">Refresh backups</button></div><pre id="backups-output">Backups are loaded on demand.</pre></section>
<section><h2>Configuration</h2><div class="ledger">${data.config.map((entry) => `
      <article><span>${entry.key}</span><strong class="${entry.configured ? 'on' : 'off'}">${entry.configured ? 'configured' : 'missing'}</strong><small>${entry.secret ? 'secret, value hidden' : 'non-secret'}${entry.restartRequired ? ', restart required' : ', runtime metadata'}</small></article>`).join('')}</div><div class="config-form"><select id="config-key">${data.config.filter((entry) => !entry.secret).map((entry) => `<option value="${entry.key}">${entry.key}</option>`).join('')}</select><input id="config-value" type="text" autocomplete="off" placeholder="New non-secret value" /><button id="stage-config">Stage configuration</button></div><p id="config-status" role="status">Changes apply after a restart.</p></section>`;
  root.querySelector<HTMLButtonElement>('#lock')?.addEventListener('click', () => login());
  root.querySelector<HTMLButtonElement>('#backup')?.addEventListener('click', () => void createBackup());
  root.querySelector<HTMLButtonElement>('#load-backups')?.addEventListener('click', () => void loadBackups());
  root.querySelector<HTMLButtonElement>('#export-diagnostics')?.addEventListener('click', () => void exportDiagnostics());
  root.querySelector<HTMLButtonElement>('#restart')?.addEventListener('click', () => void requestRestart());
  root.querySelector<HTMLButtonElement>('#load-records')?.addEventListener('click', () => void loadRecords());
  root.querySelector<HTMLButtonElement>('#load-legacy-manifest')?.addEventListener('click', () => void loadLegacyManifest());
  root.querySelector<HTMLButtonElement>('#load-legacy-records')?.addEventListener('click', () => void loadLegacyRecords());
  root.querySelector<HTMLButtonElement>('#load-audit')?.addEventListener('click', () => void loadAudit());
  root.querySelector<HTMLButtonElement>('#replace-secret')?.addEventListener('click', () => void replaceSecret());
  root.querySelector<HTMLButtonElement>('#stage-config')?.addEventListener('click', () => void stageConfig());
  for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, resetIdleLock, { once: true });
  if (!streamController) void startLogStream();
}

async function replaceSecret(): Promise<void> {
  const key = root.querySelector<HTMLSelectElement>('#secret-key')?.value ?? '';
  const input = root.querySelector<HTMLInputElement>('#secret-value');
  const value = input?.value ?? '';
  const status = root.querySelector<HTMLElement>('#secret-status');
  if (input) input.value = '';
  const nonceResponse = await adminFetch(`/admin/api/operations/nonce?operation=${encodeURIComponent(`secret.replace:${key}`)}`, token);
  if (!nonceResponse.ok) {
    if (status) status.textContent = 'Could not authorize secret replacement.';
    return;
  }
  const { nonce } = await nonceResponse.json() as { nonce: string };
  const response = await adminFetch(`/admin/api/secrets/${encodeURIComponent(key)}/replace`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, value }),
  });
  if (status) status.textContent = response.ok ? 'Replacement staged. Restart required.' : 'Replacement refused.';
}

async function stageConfig(): Promise<void> {
  const key = root.querySelector<HTMLSelectElement>('#config-key')?.value ?? '';
  const input = root.querySelector<HTMLInputElement>('#config-value');
  const value = input?.value ?? '';
  const status = root.querySelector<HTMLElement>('#config-status');
  if (input) input.value = '';
  const nonceResponse = await adminFetch(`/admin/api/operations/nonce?operation=${encodeURIComponent(`config.change:${key}`)}`, token);
  if (!nonceResponse.ok) { if (status) status.textContent = 'Could not authorize configuration change.'; return; }
  const { nonce } = await nonceResponse.json() as { nonce: string };
  const response = await adminFetch('/admin/api/config', token, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce, key, value }) });
  if (status) status.textContent = response.ok ? 'Configuration staged. Restart required.' : 'Configuration change refused.';
}
async function loadAudit(): Promise<void> {
  const output = root.querySelector<HTMLElement>('#audit-output');
  const response = await adminFetch('/admin/api/audit', token);
  if (!response.ok) {
    if (output) output.textContent = 'Could not load audit history.';
    return;
  }
  const body = await response.json() as { entries: unknown[] };
  if (output) output.textContent = JSON.stringify(body.entries, null, 2);
}

async function loadRecords(): Promise<void> {
  const kind = root.querySelector<HTMLSelectElement>('#record-kind')?.value ?? '';
  const output = root.querySelector<HTMLElement>('#records-output');
  if (output) output.textContent = 'Loading...';
  const response = await adminFetch(`/admin/api/records/${encodeURIComponent(kind)}`, token);
  if (!response.ok) {
    if (output) output.textContent = 'Could not load records.';
    return;
  }
  const body = await response.json() as { records: unknown };
  if (output) output.textContent = JSON.stringify(body.records, null, 2);
}

async function loadLegacyManifest(): Promise<void> {
  const output = root.querySelector<HTMLElement>('#legacy-manifest-output');
  if (output) output.textContent = 'Loading...';
  const response = await adminFetch('/admin/api/legacy/manifest', token);
  if (!response.ok) {
    if (output) output.textContent = 'Could not load the legacy archive metadata.';
    return;
  }
  const body = await response.json() as {
    sourcePath: string;
    snapshotVersion: number;
    byteLength: number;
    sha256: string;
    backupCount: number;
    lastVerifiedAt: number | null;
    recordCounts: Record<string, number>;
  };
  if (output) {
    output.textContent = [
      `Original path: ${body.sourcePath}`,
      `Snapshot version: ${body.snapshotVersion}`,
      `Byte size: ${body.byteLength}`,
      `SHA-256: ${body.sha256}`,
      `Backup count: ${body.backupCount}`,
      `Last verified: ${body.lastVerifiedAt === null ? 'not verified' : new Date(body.lastVerifiedAt).toISOString()}`,
      `Record counts: ${JSON.stringify(body.recordCounts)}`,
    ].join('\n');
  }
}

async function loadLegacyRecords(): Promise<void> {
  const kind = root.querySelector<HTMLSelectElement>('#legacy-record-kind')?.value ?? '';
  const page = root.querySelector<HTMLInputElement>('#legacy-page')?.value ?? '1';
  const pageSize = root.querySelector<HTMLInputElement>('#legacy-page-size')?.value ?? '50';
  const output = root.querySelector<HTMLElement>('#legacy-records-output');
  if (output) output.textContent = 'Loading...';
  const response = await adminFetch(`/admin/api/legacy/records/${encodeURIComponent(kind)}?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`, token);
  if (!response.ok) {
    if (output) output.textContent = 'Could not load archived records.';
    return;
  }
  const body = await response.json() as { records: unknown; page: number; pageSize: number; totalRecords: number; totalPages: number };
  if (output) output.textContent = JSON.stringify(body, null, 2);
}



async function requestRestart(): Promise<void> {
  const status = root.querySelector<HTMLElement>('#operation-status');
  if (!window.confirm('Restart the service gracefully? The dashboard will disconnect and require the token again.')) return;
  if (status) status.textContent = 'Authorizing restart...';
  const nonceResponse = await adminFetch('/admin/api/operations/nonce?operation=restart.request', token);
  if (!nonceResponse.ok) { if (status) status.textContent = 'Restart is not enabled or authorization failed.'; return; }
  const { nonce } = await nonceResponse.json() as { nonce: string };
  const response = await adminFetch('/admin/api/restart', token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce }) });
  if (status) status.textContent = response.ok ? 'Restart requested. Reconnect after the supervisor brings the service back.' : 'Restart refused.';
  if (response.ok) window.setTimeout(() => login('Service restarted. Enter the admin token again.'), 2_000);
}
async function loadBackups(): Promise<void> {
  const output = root.querySelector<HTMLElement>('#backups-output');
  if (output) output.textContent = 'Loading...';
  const response = await adminFetch('/admin/api/backups', token);
  if (!response.ok) { if (output) output.textContent = 'Could not load backup history.'; return; }
  const body = await response.json() as { backups: Array<{ name: string; sizeBytes: number; modifiedAt: number }> };
  if (output) output.textContent = body.backups.length === 0 ? 'No backups found.' : JSON.stringify(body.backups, null, 2);
}
async function exportDiagnostics(): Promise<void> {
  const status = root.querySelector<HTMLElement>('#operation-status');
  if (status) status.textContent = 'Preparing diagnostics...';
  const nonceResponse = await adminFetch('/admin/api/operations/nonce?operation=diagnostics.export', token);
  if (!nonceResponse.ok) {
    if (status) status.textContent = 'Could not authorize the export.';
    return;
  }
  const { nonce } = await nonceResponse.json() as { nonce: string };
  const response = await adminFetch('/admin/api/diagnostics/export', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  if (!response.ok) {
    if (status) status.textContent = 'Diagnostics export failed.';
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sface-diagnostics.json';
  link.click();
  URL.revokeObjectURL(url);
  if (status) status.textContent = 'Diagnostics downloaded.';
}

async function createBackup(): Promise<void> {
  const status = root.querySelector<HTMLElement>('#operation-status');
  if (status) status.textContent = 'Creating backup...';
  const nonceResponse = await adminFetch('/admin/api/operations/nonce?operation=backup.create', token);
  if (!nonceResponse.ok) {
    if (status) status.textContent = 'Could not authorize the operation.';
    return;
  }
  const { nonce } = await nonceResponse.json() as { nonce: string };
  const response = await adminFetch('/admin/api/backups', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  if (status) status.textContent = response.ok ? 'Backup created.' : 'Backup failed. Check the logs.';
}

async function startLogStream(): Promise<void> {
  streamController = new AbortController();
  try {
    const response = await adminFetch('/admin/api/logs/stream', token, { signal: streamController.signal });
    if (!response.ok || !response.body) throw new Error('stream unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (token) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('stream ended');
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
        if (!data) continue;
        const entry = JSON.parse(data) as { time: number; level: string; event: string; message: string };
        prependLog(entry);
      }
    }
  } catch {
    if (!token) return;
    streamController = null;
    if (pollTimer === null) pollTimer = window.setInterval(() => void overview(), 30_000);
  }
}

function prependLog(entry: { time: number; level: string; event: string; message: string }): void {
  const ledger = root.querySelector<HTMLElement>('#live-logs');
  if (!ledger) return;
  const article = document.createElement('article');
  const meta = document.createElement('span');
  const eventName = document.createElement('strong');
  const message = document.createElement('small');
  meta.textContent = `${new Date(entry.time).toISOString()} | ${entry.level}`;
  eventName.textContent = entry.event;
  message.textContent = entry.message;
  article.append(meta, eventName, message);
  ledger.prepend(article);
  while (ledger.children.length > 20) ledger.lastElementChild?.remove();
}

function resetIdleLock(): void {
  if (!token) return;
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => login('Locked after 15 minutes without activity.'), 15 * 60_000);
}

function adminFetch(path: string, bearer: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${RESOLVED_API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, authorization: `Bearer ${bearer}` },
  });
}

login();
