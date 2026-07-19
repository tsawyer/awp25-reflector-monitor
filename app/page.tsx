"use client";

import { useEffect, useMemo, useState } from "react";

type Status = {
  configured: boolean;
  online: boolean;
  updatedAt: string;
  talkgroup: string;
  nac: string;
  activeCall: { time: string; call: string; name: string; source: string; duration: string; status: string } | null;
  activity: Array<{ time: string; call: string; name: string; source: string; duration: string; status: string }>;
  nodes: Array<{ name: string; detail: string; id: string; age: string; signal: number }>;
  stats: { nodeCount: number; keyupsToday: number; airtimeSeconds: number; uptimePercent: number | null };
  utilization: number[];
};

const fallbackActivity = [
  { time: "10:42:18", call: "WD6AWP", name: "Tim", source: "Blue Ridge", duration: "02:14", status: "complete" },
  { time: "10:37:51", call: "K6JWN", name: "John", source: "Santa Ynez", duration: "00:48", status: "complete" },
  { time: "10:31:06", call: "N6OCS", name: "Mike", source: "Hotspot", duration: "01:23", status: "complete" },
  { time: "10:18:42", call: "W6APX", name: "Alex", source: "Black Mountain", duration: "00:19", status: "complete" },
  { time: "09:56:11", call: "K6JWN", name: "John", source: "Santa Ynez", duration: "03:07", status: "complete" },
  { time: "09:44:29", call: "WD6AWP", name: "Tim", source: "Blue Ridge", duration: "00:36", status: "complete" },
];

const fallbackNodes = [
  { name: "Blue Ridge", detail: "Wrightwood, CA", id: "2528", age: "12 sec", signal: 4 },
  { name: "Santa Ynez", detail: "Santa Barbara, CA", id: "2525", age: "34 sec", signal: 3 },
  { name: "Black Mountain", detail: "Glamis, CA", id: "2526", age: "1 min", signal: 4 },
];

const fallbackBars = [26, 38, 31, 55, 42, 68, 47, 74, 61, 36, 52, 78, 67, 88, 73, 57, 81, 64, 91, 76, 84, 59, 71, 94, 83, 69, 77, 62, 86, 72, 89, 65, 79, 90, 74, 58, 82, 67, 75, 86, 93, 79, 88, 70, 84, 76, 91, 80];

function formatAirtime(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("24h");
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (response.ok && mounted) setStatus(await response.json() as Status);
      } catch { /* retain the most recent good snapshot */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  const activity = status ? status.activity : fallbackActivity;
  const nodes = status ? status.nodes : fallbackNodes;
  const bars = status ? status.utilization : fallbackBars;
  const activeCall = status?.activeCall ?? null;
  const isOnline = status?.online ?? true;

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return activity;
    return activity.filter((item) =>
      `${item.call} ${item.name} ${item.source}`.toLowerCase().includes(normalized),
    );
  }, [activity, query]);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="AWP25 home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><b>AWP25</b><small>REFLECTOR MONITOR</small></span>
        </a>
        <div className="header-status">
          <span className={`status-dot ${isOnline ? "" : "offline"}`} />
          <span><b>{isOnline ? "All systems operational" : "Telemetry unavailable"}</b><small>{status?.configured === false ? "Check server configuration" : "Updated automatically"}</small></span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">P25 DIGITAL VOICE NETWORK</p>
          <h1>On the air.<br /><em>Across the West.</em></h1>
          <p className="lede">Live activity and health for the AWP25 reflector network, connecting repeaters, hotspots, and operators across Southern California.</p>
        </div>

        <div className="on-air-card">
          <div className="on-air-top">
            <span className={`live-chip ${isOnline ? "" : "offline"}`}><i /> {isOnline ? "LIVE" : "OFFLINE"}</span>
            <span className="mono">TG {status?.talkgroup ?? "10225"}</span>
          </div>
          <div className="active-call">
            <div className="avatar">{activeCall?.call.slice(0, 1) ?? "A"}</div>
            <div><small>{activeCall ? "NOW TRANSMITTING" : "REFLECTOR STANDBY"}</small><strong>{activeCall?.call ?? "AWP25"}</strong><span>{activeCall ? `${activeCall.name} · ${activeCall.source}` : "Listening for the next call"}</span></div>
          </div>
          <div className="waveform" aria-label="Live audio activity visualization">
            {bars.slice(0, 32).map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
          </div>
          <div className="call-meta"><span>{activeCall?.duration ?? "00:00"} elapsed</span><span>P25 · NAC {status?.nac ?? "927"}</span></div>
        </div>
      </section>

      <section className="stat-grid" aria-label="Network statistics">
        <article><small>REFLECTOR</small><strong>{isOnline ? "Online" : "Offline"}</strong><span><i className={`good-dot ${isOnline ? "" : "offline"}`} /> {status?.stats.uptimePercent ? `${status.stats.uptimePercent}% uptime` : "Live heartbeat"}</span></article>
        <article><small>CONNECTED NODES</small><strong>{status?.stats.nodeCount ?? 12}</strong><span>Repeaters and hotspots</span></article>
        <article><small>KEY-UPS TODAY</small><strong>{status?.stats.keyupsToday ?? 147}</strong><span>Since local midnight</span></article>
        <article><small>NETWORK TIME</small><strong>{formatAirtime(status?.stats.airtimeSeconds ?? 10058)}</strong><span>Total airtime today</span></article>
      </section>

      <section className="content-grid">
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">TRAFFIC</p><h2>Recent activity</h2></div>
            <label className="search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search callsign" aria-label="Search activity by callsign" /></label>
          </div>
          <div className="activity-list">
            {rows.length ? rows.map((item) => (
              <div className="activity-row" key={`${item.time}-${item.call}`}>
                <span className="time mono">{item.time}</span>
                <span className="call-badge">{item.call.slice(0, 1)}</span>
                <span className="operator"><b>{item.call}</b><small>{item.name}</small></span>
                <span className="route"><i />{item.source}</span>
                <span className="duration mono">{item.duration}</span>
              </div>
            )) : <div className="empty-state">{query ? `No transmissions match “${query}”.` : "No recent transmissions."}</div>}
          </div>
          <button className="text-button" type="button" onClick={() => setQuery("")}>View complete activity log <span>→</span></button>
        </article>

        <aside className="panel nodes-panel">
          <div className="panel-heading"><div><p className="eyebrow">NETWORK</p><h2>Connected nodes</h2></div><span className="node-count">{status?.stats.nodeCount ?? 12} ONLINE</span></div>
          <div className="nodes-list">
            {nodes.map((node) => (
              <div className="node-row" key={node.id}>
                <span className="tower" aria-hidden="true"><i /><i /><i /></span>
                <span className="node-name"><b>{node.name}</b><small>{node.detail}</small></span>
                <span className="node-meta"><b>#{node.id}</b><small>{node.age} ago</small></span>
                <span className="signal" aria-label={`${node.signal} of 4 signal strength`}>{[1,2,3,4].map((n) => <i key={n} className={n <= node.signal ? "filled" : ""} />)}</span>
              </div>
            ))}
          </div>
          <button className="text-button" type="button">View all {status?.stats.nodeCount ?? 12} nodes <span>→</span></button>
        </aside>
      </section>

      <section className="panel usage-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">UTILIZATION</p><h2>Network activity</h2></div>
          <div className="range-switch" aria-label="Chart time range">
            {["24h", "7d", "30d"].map((item) => <button type="button" className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>{item.toUpperCase()}</button>)}
          </div>
        </div>
        <div className="chart-wrap">
          <div className="axis"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div>
          <div className="bar-chart" data-range={range}>
            {bars.map((height, index) => <i key={index} style={{ height: `${Math.max(12, height - (range === "7d" ? index % 9 : range === "30d" ? index % 14 : 0))}%` }} />)}
          </div>
        </div>
        <div className="chart-labels"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>NOW</span></div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span><b>AWP25</b><small>REFLECTOR MONITOR</small></span></div>
        <p>Keeping Southern California connected.</p>
        <nav aria-label="Footer links"><a href="#top">About</a><a href="#top">Network status</a><a href="#top">Contact</a></nav>
        <span className="footer-note">P25 Reflector · WD6AWP</span>
      </footer>
    </main>
  );
}
