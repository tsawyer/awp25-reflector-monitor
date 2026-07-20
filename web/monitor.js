"use strict";

const POLL_MS = 1000;
const STALE_AFTER_MS = 5000;
const COLLECTOR_STALE_MS = 10000;
let currentStatus = null;
let lastSuccess = 0;

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = String(value);
}

function formatAirtime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

function formatUpdated(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Updated just now";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 2) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds} sec ago`;
  return `Updated ${Math.floor(seconds / 60)} min ago`;
}

function setOnline(online, configured = true) {
  const headerDot = byId("header-dot");
  const reflectorDot = byId("reflector-dot");
  const liveChip = byId("live-chip");
  headerDot.classList.toggle("offline", !online);
  reflectorDot.classList.toggle("offline", !online);
  liveChip.classList.toggle("offline", !online);
  setText("header-status", online ? "All systems operational" : "Telemetry unavailable");
  setText("reflector-state", online ? "Online" : "Offline");
  liveChip.lastChild.textContent = online ? " LIVE" : " OFFLINE";
  if (!configured) setText("updated-label", "Check collector configuration");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderActivity() {
  const list = byId("activity-list");
  const query = byId("activity-search").value.trim().toLowerCase();
  const activity = Array.isArray(currentStatus?.activity) ? currentStatus.activity : [];
  const rows = activity.filter((item) => !query || `${item.call} ${item.name} ${item.source}`.toLowerCase().includes(query));
  list.replaceChildren();

  if (!rows.length) {
    list.append(element("div", "empty-state", query ? `No transmissions match “${query}”.` : "No recent transmissions."));
    return;
  }

  rows.slice(0, 30).forEach((item) => {
    const row = element("div", "activity-row");
    row.append(element("span", "time mono", item.time || "--:--:--"));
    row.append(element("span", "call-badge", String(item.call || "?").slice(0, 1)));
    const operator = element("span", "operator");
    operator.append(element("b", "", item.call || "Unknown"));
    operator.append(element("small", "", item.name || "Operator"));
    row.append(operator);
    const route = element("span", "route");
    route.append(element("i"));
    route.append(document.createTextNode(item.source || "Network"));
    row.append(route);
    row.append(element("span", "duration mono", item.duration || "00:00"));
    list.append(row);
  });
}

function renderNodes() {
  const list = byId("nodes-list");
  const nodes = Array.isArray(currentStatus?.nodes) ? currentStatus.nodes : [];
  list.replaceChildren();
  if (!nodes.length) {
    list.append(element("div", "empty-state compact", "No connected nodes reported."));
    return;
  }

  nodes.slice(0, 20).forEach((node) => {
    const row = element("div", "node-row");
    const tower = element("span", "tower");
    tower.setAttribute("aria-hidden", "true");
    tower.append(element("i"), element("i"), element("i"));
    row.append(tower);
    const name = element("span", "node-name");
    name.append(element("b", "", node.name || "Unknown node"));
    name.append(element("small", "", node.detail || "P25 gateway"));
    row.append(name);
    const meta = element("span", "node-meta");
    meta.append(element("b", "", `#${node.id || "—"}`));
    meta.append(element("small", "", `${node.age || "just now"} ago`));
    row.append(meta);
    const freshness = element("span", "signal");
    freshness.setAttribute("aria-label", `${node.signal || 0} of 4 link freshness`);
    for (let index = 1; index <= 4; index += 1) freshness.append(element("i", index <= Number(node.signal || 0) ? "filled" : ""));
    row.append(freshness);
    list.append(row);
  });
}

function renderBars() {
  const values = Array.isArray(currentStatus?.utilization) ? currentStatus.utilization.slice(-48) : [];
  const chart = byId("bar-chart");
  const waveform = byId("waveform");
  chart.replaceChildren();
  waveform.replaceChildren();
  const normalized = values.length ? values : Array(48).fill(0);
  normalized.forEach((value, index) => {
    const bar = element("i");
    bar.style.height = `${Math.max(2, Math.min(100, Number(value) || 0))}%`;
    bar.title = `${Math.round(Number(value) || 0)}% relative activity`;
    chart.append(bar);
    if (index >= normalized.length - 32) {
      const wave = element("i");
      wave.style.height = `${Math.max(8, Math.min(100, Number(value) || 0))}%`;
      waveform.append(wave);
    }
  });
}

function render(status) {
  currentStatus = status;
  const online = Boolean(status.online);
  const reflectorName = String(status.reflectorName || "Reflector");
  setOnline(online, status.configured !== false);
  setText("reflector-name-copy", reflectorName);
  byId("brand-home").setAttribute("aria-label", `${reflectorName} home`);
  document.title = `${reflectorName} · MMDVM P25 Reflector Monitor`;
  setText("updated-label", status.configured === false ? "Check collector configuration" : formatUpdated(status.updatedAt));
  setText("heartbeat-label", online ? "Live heartbeat" : "Heartbeat stale");
  setText("talkgroup", status.talkgroup || "—");

  const call = status.activeCall;
  setText("active-avatar", call?.call?.slice(0, 1) || reflectorName.slice(0, 1));
  setText("active-label", call ? "NOW TRANSMITTING" : "REFLECTOR STANDBY");
  setText("active-call", call?.call || reflectorName);
  setText("active-source", call ? `${call.name || "Operator"} · ${call.source || "Network"}` : "Listening for the next call");
  setText("active-duration", call?.duration || "00:00");

  const stats = status.stats || {};
  setText("node-total", stats.nodeCount ?? 0);
  setText("node-count", `${stats.nodeCount ?? 0} ONLINE`);
  setText("keyups-total", stats.keyupsToday ?? 0);
  setText("airtime-total", formatAirtime(stats.airtimeSeconds));
  renderActivity();
  renderNodes();
  renderBars();
}

async function poll() {
  try {
    const response = await fetch(`status.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    if (!status || typeof status !== "object" || !status.stats) throw new Error("Invalid status document");
    const generatedAt = Date.parse(status.updatedAt);
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > COLLECTOR_STALE_MS) status.online = false;
    lastSuccess = Date.now();
    render(status);
  } catch {
    if (!lastSuccess || Date.now() - lastSuccess > STALE_AFTER_MS) {
      setOnline(false, currentStatus?.configured !== false);
      setText("updated-label", "Waiting for collector");
    }
  } finally {
    window.setTimeout(poll, document.hidden ? 5000 : POLL_MS);
  }
}

byId("activity-search").addEventListener("input", renderActivity);
byId("clear-search").addEventListener("click", () => {
  byId("activity-search").value = "";
  renderActivity();
});

renderBars();
void poll();
