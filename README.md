# AWP25 Reflector Monitor

A lightweight, near-real-time public monitor for a P25Reflector server on Debian 12.

The application has no third-party runtime dependencies:

- nginx serves the static dashboard and the latest JSON snapshot.
- A Python 3 collector reads the three newest **P25Reflector application logs**, then follows the active file and processes each new line once.
- Browsers request the small sanitized snapshot every second.

The collector does not read nginx or Apache logs and never publishes client IP addresses or raw log lines.

## Architecture

```text
P25Reflector*.log → collector.py → status.json → nginx → browsers
                         once          small       many
```

Typical display latency is one to two seconds. Visitor count does not increase reflector-log parsing work.

## Test

Debian 12's standard Python 3 is sufficient:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile collector/collector.py
```

To inspect the static interface locally, run `python3 -m http.server 8080 --directory web`. It will show an offline state until a collector publishes `web/status.json`.

## Configuration

Copy `.env.example` to `/etc/awp25-monitor.env`. Most importantly, set `P25_LOG_DIR` to the directory containing the reflector application's `P25Reflector*.log` files. The filename pattern is separately configurable with `P25_LOG_PATTERN`.

Optional node labels can be provided through `P25_NODES_FILE`; see `deploy/nodes.example.json`. Unknown nodes are displayed using the callsign or numeric gateway ID found in the log.

## Debian 12 installation

1. Install the only required packages:

   ```bash
   sudo apt update
   sudo apt install nginx python3
   ```

2. Put the repository at `/opt/awp25-monitor` and create the service account:

   ```bash
   sudo useradd --system --home /opt/awp25-monitor --shell /usr/sbin/nologin awp25-monitor
   ```

3. Grant `awp25-monitor` read-only access to the P25Reflector log directory. Usually this means adding it to the group that owns those logs:

   ```bash
   sudo usermod -aG REFLECTOR_LOG_GROUP awp25-monitor
   ```

4. Install and edit the configuration:

   ```bash
   sudo install -m 0644 .env.example /etc/awp25-monitor.env
   sudo editor /etc/awp25-monitor.env
   ```

5. Install the collector service:

   ```bash
   sudo install -m 0644 deploy/awp25-collector.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now awp25-collector
   ```

6. Adapt `server_name` in `deploy/nginx.conf`, install it, and reload nginx:

   ```bash
   sudo install -m 0644 deploy/nginx.conf /etc/nginx/sites-available/awp25-monitor
   sudo ln -s /etc/nginx/sites-available/awp25-monitor /etc/nginx/sites-enabled/awp25-monitor
   sudo nginx -t
   sudo systemctl reload nginx
   ```

Add TLS using the server's normal certificate workflow before public launch.

## Operations

```bash
systemctl status awp25-collector
journalctl -u awp25-collector -f
curl -s http://127.0.0.1/status.json
```

The collector never rotates, renames, or deletes logs. At startup it reads only the three most recently modified matching files, oldest-to-newest, then follows the newest one. It detects a new filename, inode replacement, or in-place truncation after your own rotation and resumes at the correct position. JSON publication uses an atomic rename, ensuring nginx never serves a partially written document.
