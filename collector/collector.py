#!/usr/bin/env python3
"""Follow P25Reflector logs and publish a sanitized near-real-time JSON snapshot."""

from __future__ import annotations

import glob
import json
import os
import re
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


TIMESTAMP_RE = re.compile(r"(?:[IEMD]:\s*)?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})")
CALLSIGN_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z0-9]{1,4}(?:-[A-Z0-9]{1,2})?)\b")
NUMERIC_ID_RE = re.compile(r"(?:from|adding|removing|gateway)\s+(\d{4,9})\b", re.IGNORECASE)
DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)", re.IGNORECASE)
LINKED_REPEATER_RE = re.compile(
    r"^(?:\.\d+)?\s+([A-Z]{1,2}\d[A-Z0-9]{1,4}(?:-[A-Z0-9]{1,2})?)\s*:\s+\S+:\d+\s+\d+/\d+\s*$",
    re.IGNORECASE,
)


def iso_now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def format_duration(seconds: float) -> str:
    value = max(0, round(seconds))
    return f"{value // 60:02d}:{value % 60:02d}"


def callsign_from(message: str) -> str | None:
    for match in CALLSIGN_RE.findall(message.upper()):
        if match != "P25":
            return match
    numeric = NUMERIC_ID_RE.search(message)
    return f"ID {numeric.group(1)}" if numeric else None


def parse_timestamp(line: str, fallback: datetime | None = None) -> tuple[datetime, str]:
    match = TIMESTAMP_RE.search(line)
    if not match:
        return fallback or datetime.now().astimezone(), line
    try:
        parsed = datetime.fromisoformat(f"{match.group(1)}T{match.group(2)}").astimezone()
    except ValueError:
        parsed = fallback or datetime.now().astimezone()
    return parsed, line[match.end():].strip()


def age_label(seconds: float) -> str:
    value = max(0, int(seconds))
    if value < 60:
        return f"{value} sec"
    if value < 3600:
        return f"{value // 60} min"
    return f"{value // 3600} hr"


@dataclass
class NodeSeen:
    last_seen: float


class ReflectorState:
    def __init__(self, node_metadata: dict[str, dict[str, Any]] | None = None) -> None:
        self.node_metadata = node_metadata or {}
        self.activity: deque[dict[str, Any]] = deque(maxlen=50)
        self.nodes: dict[str, NodeSeen] = {}
        self.active_call: dict[str, Any] | None = None
        self.active_started: float | None = None
        self.keyups_today = 0
        self.airtime_seconds = 0.0
        self.utilization_counts = [0] * 48
        self.day = datetime.now().astimezone().date()
        self.log_mtime = 0.0
        self.configured = True

    def reset_day_if_needed(self, when: datetime) -> None:
        if when.date() == self.day:
            return
        self.day = when.date()
        self.keyups_today = 0
        self.airtime_seconds = 0.0
        self.utilization_counts = [0] * 48

    def process_line(self, line: str, received_at: float | None = None) -> bool:
        now = received_at or time.time()
        when, message = parse_timestamp(line, datetime.fromtimestamp(now).astimezone())
        self.reset_day_if_needed(when)
        call = callsign_from(message)
        lowered = message.lower()
        changed = False
        linked_repeater = LINKED_REPEATER_RE.match(message)

        if "currently linked repeaters:" in lowered:
            if self.nodes:
                changed = True
            self.nodes.clear()

        if linked_repeater:
            call = linked_repeater.group(1).upper()
            self.nodes[call] = NodeSeen(last_seen=now)
            changed = True

        is_node_heartbeat = bool(re.search(r"\b0000:\s+F0\b", message, re.IGNORECASE))

        if call and not linked_repeater and (
            re.search(r"add(?:ed|ing)|connected|link(?:ed)? from|poll from", lowered)
            or is_node_heartbeat
        ):
            self.nodes[call] = NodeSeen(last_seen=now)
            changed = True
        if call and re.search(r"remov(?:ed|ing)|disconnected|unlink", lowered):
            self.nodes.pop(call, None)
            changed = True

        if re.search(r"starting p25reflector|no repeaters linked", lowered):
            if self.nodes or self.active_call:
                changed = True
            self.nodes.clear()
            self.active_call = None
            self.active_started = None

        is_end = bool(re.search(r"ended|end of.*transmission|total frames", lowered))
        is_start = (
            bool(re.search(r"received.*(?:voice|transmission)|transmission from|network.*from", lowered))
            and not is_end
        )

        if is_start and call:
            source = "RF gateway" if re.search(r"\brf\b", message, re.IGNORECASE) else "Network"
            self.active_call = {
                "time": when.strftime("%H:%M:%S"),
                "call": call,
                "name": self.node_metadata.get(call, {}).get("operator", "Operator"),
                "source": self.node_metadata.get(call, {}).get("name", source),
                "duration": "00:00",
                "status": "active",
            }
            self.active_started = now
            if when.date() == self.day:
                self.keyups_today += 1
                slot = when.hour * 2 + (1 if when.minute >= 30 else 0)
                self.utilization_counts[slot] += 1
            changed = True

        if is_end:
            ended_call = call or (self.active_call or {}).get("call")
            if ended_call:
                duration_match = DURATION_RE.search(message)
                duration = float(duration_match.group(1)) if duration_match else max(0.0, now - (self.active_started or now))
                self.airtime_seconds += duration
                source = (self.active_call or {}).get("source", "Network")
                name = (self.active_call or {}).get("name", self.node_metadata.get(ended_call, {}).get("operator", "Operator"))
                self.activity.appendleft({
                    "time": when.strftime("%H:%M:%S"),
                    "call": ended_call,
                    "name": name,
                    "source": source,
                    "duration": format_duration(duration),
                    "status": "complete",
                })
                if self.active_call and self.active_call.get("call") == ended_call:
                    self.active_call = None
                    self.active_started = None
                changed = True

        return changed

    def snapshot(self, settings: "Settings", now: float | None = None) -> dict[str, Any]:
        timestamp = now or time.time()
        self.reset_day_if_needed(datetime.fromtimestamp(timestamp).astimezone())
        expired = [call for call, seen in self.nodes.items() if timestamp - seen.last_seen > settings.node_timeout]
        for call in expired:
            self.nodes.pop(call, None)

        active = dict(self.active_call) if self.active_call else None
        if active and self.active_started is not None:
            active["duration"] = format_duration(timestamp - self.active_started)

        maximum = max(max(self.utilization_counts), 1)
        utilization = [round(value / maximum * 94) if value else 0 for value in self.utilization_counts]
        nodes = []
        for index, (call, seen) in enumerate(sorted(self.nodes.items(), key=lambda item: item[1].last_seen, reverse=True)):
            metadata = self.node_metadata.get(call, {})
            age = timestamp - seen.last_seen
            freshness = 4 if age < 30 else 3 if age < 60 else 2 if age < 120 else 1
            nodes.append({
                "name": metadata.get("name", call),
                "detail": metadata.get("detail", "P25 gateway"),
                "id": str(metadata.get("id", index + 1)).zfill(4),
                "age": age_label(age),
                "signal": freshness,
            })

        return {
            "schemaVersion": 1,
            "configured": self.configured,
            "online": bool(self.log_mtime and timestamp - self.log_mtime < settings.online_timeout),
            "updatedAt": iso_now(),
            "reflectorName": settings.reflector_name,
            "talkgroup": settings.talkgroup,
            "nac": settings.nac,
            "activeCall": active,
            "activity": list(self.activity),
            "nodes": nodes,
            "stats": {
                "nodeCount": len(nodes),
                "keyupsToday": self.keyups_today,
                "airtimeSeconds": round(self.airtime_seconds),
                "uptimePercent": None,
            },
            "utilization": utilization,
        }


@dataclass(frozen=True)
class Settings:
    log_dir: Path
    log_pattern: str
    status_file: Path
    nodes_file: Path | None
    reflector_name: str
    talkgroup: str
    nac: str
    poll_interval: float
    publish_interval: float
    online_timeout: float
    node_timeout: float
    bootstrap_bytes: int
    log_history: int

    @classmethod
    def from_environment(cls) -> "Settings":
        nodes = os.environ.get("P25_NODES_FILE")
        return cls(
            log_dir=Path(os.environ.get("P25_LOG_DIR", "/var/log/p25reflector")),
            log_pattern=os.environ.get("P25_LOG_PATTERN", "P25Reflector*.log"),
            status_file=Path(os.environ.get("P25_STATUS_FILE", "/var/lib/awp25-monitor/status.json")),
            nodes_file=Path(nodes) if nodes else None,
            reflector_name=os.environ.get("P25_REFLECTOR_NAME", "AWP25"),
            talkgroup=os.environ.get("P25_TALKGROUP", "10225"),
            nac=os.environ.get("P25_NAC", "927"),
            poll_interval=float(os.environ.get("P25_POLL_INTERVAL", "0.2")),
            publish_interval=float(os.environ.get("P25_PUBLISH_INTERVAL", "1.0")),
            online_timeout=float(os.environ.get("P25_ONLINE_TIMEOUT", "300")),
            node_timeout=float(os.environ.get("P25_NODE_TIMEOUT", "370")),
            bootstrap_bytes=int(os.environ.get("P25_BOOTSTRAP_BYTES", str(16 * 1024 * 1024))),
            log_history=max(1, int(os.environ.get("P25_LOG_HISTORY", "3"))),
        )


def load_node_metadata(path: Path | None) -> dict[str, dict[str, Any]]:
    if not path:
        return {}
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        return {str(key).upper(): value for key, value in document.items() if isinstance(value, dict)}
    except (OSError, json.JSONDecodeError) as error:
        print(f"warning: could not load node metadata: {error}", file=sys.stderr)
        return {}


def recent_logs(settings: Settings) -> list[Path]:
    matches = [Path(item) for item in glob.glob(str(settings.log_dir / settings.log_pattern))]
    files = [item for item in matches if item.is_file()]
    return sorted(files, key=lambda item: item.stat().st_mtime)[-settings.log_history:]


def newest_log(settings: Settings) -> Path | None:
    logs = recent_logs(settings)
    return logs[-1] if logs else None


def read_tail(path: Path, byte_limit: int) -> list[str]:
    size = path.stat().st_size
    with path.open("rb") as handle:
        handle.seek(max(0, size - byte_limit))
        data = handle.read()
    text = data.decode("utf-8", errors="replace")
    if size > byte_limit:
        text = text.split("\n", 1)[-1]
    return text.splitlines()


def atomic_write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.chmod(0o644)
    os.replace(temporary, path)


def run(settings: Settings) -> None:
    state = ReflectorState(load_node_metadata(settings.nodes_file))
    stopping = False

    def stop(_signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    current_path: Path | None = None
    current_handle: Any = None
    current_inode: int | None = None
    next_publish = 0.0
    bootstrapped = False

    while not stopping:
        candidate = newest_log(settings)
        candidate_inode = candidate.stat().st_ino if candidate else None
        if candidate and not bootstrapped:
            for historical_log in recent_logs(settings):
                historical_mtime = historical_log.stat().st_mtime
                for line in read_tail(historical_log, settings.bootstrap_bytes):
                    state.process_line(line, historical_mtime)
            bootstrapped = True
            current_path = candidate
            current_inode = candidate_inode
            state.log_mtime = candidate.stat().st_mtime
            current_handle = candidate.open("r", encoding="utf-8", errors="replace")
            current_handle.seek(0, os.SEEK_END)
            print(f"following {candidate} (bootstrapped from {len(recent_logs(settings))} log files)", flush=True)
        elif candidate and (candidate != current_path or candidate_inode != current_inode):
            if current_handle:
                current_handle.close()
            current_path = candidate
            current_inode = candidate_inode
            state.log_mtime = candidate.stat().st_mtime
            current_handle = candidate.open("r", encoding="utf-8", errors="replace")
            print(f"following {candidate}", flush=True)

        changed = False
        if current_handle:
            if current_path:
                try:
                    if current_handle.tell() > current_path.stat().st_size:
                        current_handle.close()
                        current_handle = current_path.open("r", encoding="utf-8", errors="replace")
                        print(f"log truncated; resumed at start of {current_path}", flush=True)
                except FileNotFoundError:
                    pass
            while True:
                line = current_handle.readline()
                if not line:
                    break
                changed = state.process_line(line) or changed
            if current_path:
                try:
                    state.log_mtime = current_path.stat().st_mtime
                except FileNotFoundError:
                    pass

        now = time.time()
        if changed or now >= next_publish:
            atomic_write_json(settings.status_file, state.snapshot(settings, now))
            next_publish = now + settings.publish_interval
        time.sleep(settings.poll_interval)

    if current_handle:
        current_handle.close()


def main() -> int:
    settings = Settings.from_environment()
    try:
        run(settings)
    except PermissionError as error:
        print(f"fatal: permission denied: {error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"fatal: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
