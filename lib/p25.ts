import { promises as fs } from "node:fs";
import path from "node:path";

export type Transmission = {
  time: string;
  call: string;
  name: string;
  source: string;
  duration: string;
  status: "complete" | "active";
};

export type ReflectorStatus = {
  configured: boolean;
  online: boolean;
  updatedAt: string;
  talkgroup: string;
  nac: string;
  reflectorName: string;
  activeCall: Transmission | null;
  activity: Transmission[];
  nodes: Array<{ name: string; detail: string; id: string; age: string; signal: number }>;
  stats: { nodeCount: number; keyupsToday: number; airtimeSeconds: number; uptimePercent: number | null };
  utilization: number[];
};

const CALLSIGN = /\b([A-Z]{1,2}\d[A-Z0-9]{1,4}(?:-[A-Z0-9]{1,2})?)\b/;
const TIMESTAMP = /(?:[IEMD]:\s*)?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

function callsignFrom(message: string) {
  const matches = message.match(new RegExp(CALLSIGN.source, "g")) ?? [];
  return matches.find((candidate) => candidate !== "P25") ?? null;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function ageLabel(date: Date) {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} hr`;
}

async function newestLog(logDir: string) {
  const entries = await fs.readdir(logDir, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && /P25Reflector.*\.log$/i.test(entry.name));
  const files = await Promise.all(candidates.map(async (entry) => {
    const file = path.join(logDir, entry.name);
    return { file, stat: await fs.stat(file) };
  }));
  return files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] ?? null;
}

async function tail(file: string, bytes = 2_000_000) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(bytes, stat.size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

export function parseReflectorLog(contents: string, metadata: { mtime: Date; name?: string } = { mtime: new Date() }): ReflectorStatus {
  const lines = contents.split(/\r?\n/).filter(Boolean);
  const activity: Transmission[] = [];
  const activeNodes = new Map<string, Date>();
  const hourCounts = Array.from({ length: 48 }, () => 0);
  const localNow = new Date();
  const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, "0")}-${String(localNow.getDate()).padStart(2, "0")}`;
  let activeCall: Transmission | null = null;
  let airtimeSeconds = 0;
  let keyupsToday = 0;

  for (const line of lines) {
    const stamp = line.match(TIMESTAMP);
    const when = stamp ? new Date(`${stamp[1]}T${stamp[2]}`) : metadata.mtime;
    const message = stamp ? line.slice((stamp.index ?? 0) + stamp[0].length) : line;
    const call = callsignFrom(message);
    if (!call) continue;

    if (/added|connected|link(?:ed)? from|poll from/i.test(message)) activeNodes.set(call, when);
    if (/removed|disconnected|unlink/i.test(message)) activeNodes.delete(call);

    const isStart = /received.*(?:voice|transmission)|transmission from|network.*from/i.test(message) && !/ended|end of|total frames/i.test(message);
    const isEnd = /ended|end of.*transmission|total frames/i.test(message);
    if (isStart) {
      activeCall = {
        time: stamp?.[2] ?? when.toTimeString().slice(0, 8),
        call,
        name: "Operator",
        source: /RF/i.test(message) ? "RF gateway" : "Network",
        duration: "00:00",
        status: "active",
      };
      if (stamp?.[1] === today) keyupsToday += 1;
      const hour = when.getHours() * 2 + (when.getMinutes() >= 30 ? 1 : 0);
      hourCounts[hour] += 1;
    }
    if (isEnd) {
      const seconds = Number(message.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)/i)?.[1] ?? 0);
      airtimeSeconds += seconds;
      activity.unshift({
        time: stamp?.[2] ?? when.toTimeString().slice(0, 8),
        call,
        name: "Operator",
        source: /RF/i.test(message) ? "RF gateway" : "Network",
        duration: formatDuration(seconds),
        status: "complete",
      });
      if (activeCall?.call === call) activeCall = null;
    }
  }

  const max = Math.max(...hourCounts, 1);
  const utilization = hourCounts.map((value) => Math.round((value / max) * 88) + (value ? 6 : 0));
  const online = Date.now() - metadata.mtime.getTime() < 5 * 60_000;

  return {
    configured: true,
    online,
    updatedAt: metadata.mtime.toISOString(),
    talkgroup: process.env.P25_TALKGROUP ?? "10225",
    nac: process.env.P25_NAC ?? "927",
    reflectorName: process.env.P25_REFLECTOR_NAME ?? metadata.name ?? "AWP25",
    activeCall,
    activity: activity.slice(0, 30),
    nodes: [...activeNodes.entries()].slice(0, 20).map(([call, seen], index) => ({
      name: call,
      detail: "P25 node",
      id: String(index + 1).padStart(4, "0"),
      age: ageLabel(seen),
      signal: 4,
    })),
    stats: { nodeCount: activeNodes.size, keyupsToday, airtimeSeconds: Math.round(airtimeSeconds), uptimePercent: null },
    utilization,
  };
}

export async function getReflectorStatus(): Promise<ReflectorStatus> {
  const statusFile = process.env.P25_STATUS_FILE;
  if (statusFile) {
    const parsed = JSON.parse(await fs.readFile(statusFile, "utf8")) as ReflectorStatus;
    return { ...parsed, configured: true };
  }

  try {
    const found = await newestLog(process.env.P25_LOG_DIR ?? "/var/log/p25reflector");
    if (!found) throw new Error("No P25Reflector log found");
    return parseReflectorLog(await tail(found.file), { mtime: found.stat.mtime, name: process.env.P25_REFLECTOR_NAME });
  } catch {
    if (process.env.NODE_ENV !== "production" || process.env.P25_DEMO_MODE === "1") return demoStatus();
    return {
      ...demoStatus(), configured: false, online: false, activeCall: null, activity: [], nodes: [],
      stats: { nodeCount: 0, keyupsToday: 0, airtimeSeconds: 0, uptimePercent: null }, utilization: Array(48).fill(0),
    };
  }
}

function demoStatus(): ReflectorStatus {
  return {
    configured: true, online: true, updatedAt: new Date().toISOString(), talkgroup: "10225", nac: "927", reflectorName: "AWP25",
    activeCall: { time: "10:42:18", call: "WD6AWP", name: "Tim", source: "Blue Ridge", duration: "01:42", status: "active" },
    activity: [
      { time: "10:42:18", call: "WD6AWP", name: "Tim", source: "Blue Ridge", duration: "02:14", status: "complete" },
      { time: "10:37:51", call: "K6JWN", name: "John", source: "Santa Ynez", duration: "00:48", status: "complete" },
      { time: "10:31:06", call: "N6OCS", name: "Mike", source: "Hotspot", duration: "01:23", status: "complete" },
      { time: "10:18:42", call: "W6APX", name: "Alex", source: "Black Mountain", duration: "00:19", status: "complete" },
    ],
    nodes: [
      { name: "Blue Ridge", detail: "Wrightwood, CA", id: "2528", age: "12 sec", signal: 4 },
      { name: "Santa Ynez", detail: "Santa Barbara, CA", id: "2525", age: "34 sec", signal: 3 },
      { name: "Black Mountain", detail: "Glamis, CA", id: "2526", age: "1 min", signal: 4 },
    ],
    stats: { nodeCount: 12, keyupsToday: 147, airtimeSeconds: 10058, uptimePercent: 99.98 },
    utilization: [26,38,31,55,42,68,47,74,61,36,52,78,67,88,73,57,81,64,91,76,84,59,71,94,83,69,77,62,86,72,89,65,79,90,74,58,82,67,75,86,93,79,88,70,84,76,91,80],
  };
}
