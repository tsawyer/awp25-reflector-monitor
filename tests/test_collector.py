import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from collector.collector import ReflectorState, Settings, atomic_write_json, recent_logs


def settings(output: Path) -> Settings:
    return Settings(
        log_dir=output.parent,
        log_pattern="P25Reflector*.log",
        status_file=output,
        nodes_file=None,
        reflector_name="AWP25",
        talkgroup="10225",
        nac="927",
        poll_interval=0.1,
        publish_interval=1.0,
        online_timeout=300.0,
        node_timeout=180.0,
        bootstrap_bytes=1024 * 1024,
        log_history=3,
    )


class CollectorTests(unittest.TestCase):
    def test_normalizes_transmission_without_exposing_ip_address(self) -> None:
        state = ReflectorState()
        now = datetime.now().astimezone()
        date = now.strftime("%Y-%m-%d")
        state.log_mtime = now.timestamp()
        state.process_line(
            f"M: {date} 10:00:00 P25, received network transmission from WD6AWP to TG 10225 at 192.0.2.10",
            now.timestamp(),
        )
        state.process_line(
            f"M: {date} 10:00:12 P25, transmission from WD6AWP ended, 12.4 seconds",
            now.timestamp() + 12,
        )
        with tempfile.TemporaryDirectory() as directory:
            snapshot = state.snapshot(settings(Path(directory) / "status.json"), now.timestamp() + 12)
        self.assertEqual(snapshot["activity"][0]["call"], "WD6AWP")
        self.assertEqual(snapshot["activity"][0]["duration"], "00:12")
        self.assertNotIn("192.0.2.10", json.dumps(snapshot))

    def test_tracks_and_expires_connected_nodes(self) -> None:
        state = ReflectorState({"WD6AWP": {"name": "Blue Ridge", "id": "2528"}})
        now = datetime.now().astimezone()
        state.log_mtime = now.timestamp()
        state.process_line(
            f"M: {now:%Y-%m-%d %H:%M:%S} Added gateway WD6AWP at 192.0.2.10",
            now.timestamp(),
        )
        with tempfile.TemporaryDirectory() as directory:
            config = settings(Path(directory) / "status.json")
            current = state.snapshot(config, now.timestamp() + 1)
            expired = state.snapshot(config, now.timestamp() + config.node_timeout + 1)
        self.assertEqual(current["nodes"][0]["name"], "Blue Ridge")
        self.assertEqual(current["stats"]["nodeCount"], 1)
        self.assertEqual(expired["stats"]["nodeCount"], 0)

    def test_tracks_real_reflector_adds_heartbeats_and_removals(self) -> None:
        state = ReflectorState()
        now = datetime.now().astimezone()
        config = settings(Path("/tmp/status.json"))
        state.log_mtime = now.timestamp()

        state.process_line(
            f"M: {now:%Y-%m-%d %H:%M:%S}.044 Adding K6JPS      (192.0.2.10:6820)",
            now.timestamp(),
        )
        state.process_line(
            f"M: {now:%Y-%m-%d %H:%M:%S}.374 Adding WD6AWP     (198.51.100.20:6820)",
            now.timestamp(),
        )
        state.process_line(
            f"D: {now:%Y-%m-%d %H:%M:%S}.044 0000:  F0 4B 36 4A 50 53 20 20 20 20 20  *.K6JPS     *",
            now.timestamp() + config.node_timeout,
        )

        current = state.snapshot(config, now.timestamp() + config.node_timeout + 1)
        self.assertEqual([node["name"] for node in current["nodes"]], ["K6JPS"])

        state.process_line(
            f"M: {now:%Y-%m-%d %H:%M:%S}.500 Removing K6JPS",
            now.timestamp() + config.node_timeout + 2,
        )
        removed = state.snapshot(config, now.timestamp() + config.node_timeout + 2)
        self.assertEqual(removed["nodes"], [])

    def test_publishes_complete_json_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "status.json"
            atomic_write_json(output, {"online": True, "activity": []})
            self.assertEqual(json.loads(output.read_text()), {"online": True, "activity": []})
            self.assertEqual(output.stat().st_mode & 0o777, 0o644)
            self.assertEqual(list(output.parent.glob(".*.tmp")), [])

    def test_reads_only_the_three_most_recent_logs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = settings(root / "status.json")
            for index in range(5):
                log = root / f"P25Reflector-{index}.log"
                log.write_text(f"log {index}")
                timestamp = 1000 + index
                log.touch()
                os.utime(log, (timestamp, timestamp))
            self.assertEqual(
                [item.name for item in recent_logs(config)],
                ["P25Reflector-2.log", "P25Reflector-3.log", "P25Reflector-4.log"],
            )


if __name__ == "__main__":
    unittest.main()
