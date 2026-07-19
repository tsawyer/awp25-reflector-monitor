# AWP25 Reflector Monitor

A lightweight, near-real-time public monitor for a P25Reflector server on Debian 12.

The application has no third-party runtime dependencies:

- Apache serves the static dashboard and the latest JSON snapshot.
- A Python 3 collector reads the three newest **P25Reflector application logs**, then follows the active file and processes each new line once.
- Browsers request the small sanitized snapshot every second.

The collector does not read Apache logs and never publishes client IP addresses or raw log lines.

## Architecture

```text
P25Reflector*.log → collector.py → status.json → Apache → browsers
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

1. Install Python 3 and Apache if they are not already present:

   ```bash
   sudo apt update
   sudo apt install python3 apache2
   ```

2. From the repository checkout, install only the production runtime files under `/opt`:

   ```bash
   sudo install -d -o root -g root -m 0755 \
     /opt/awp25-monitor/collector \
     /opt/awp25-monitor/web

   sudo install -o root -g root -m 0644 \
     collector/collector.py \
     /opt/awp25-monitor/collector/

   sudo install -o root -g root -m 0644 \
     web/index.html web/styles.css web/monitor.js web/favicon.svg \
     /opt/awp25-monitor/web/
   ```

3. Create the dedicated service account:

   ```bash
   id awp25-monitor >/dev/null 2>&1 || \
     sudo useradd --system --user-group --home /opt/awp25-monitor --shell /usr/sbin/nologin awp25-monitor
   ```

4. Grant `awp25-monitor` read-only access to the P25Reflector log directory.


   ```bash
   sudo usermod -aG mmdvm awp25-monitor
   ```

5. Install and edit the configuration:

   Likely only `P25_LOG_DIR=/var/log/...` needs attention. 

   ```bash
   sudo install -m 0644 .env.example /etc/awp25-monitor.env
   sudo editor /etc/awp25-monitor.env
   ```

7. Install the collector service:

   ```bash
   sudo install -m 0644 deploy/awp25-collector.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now awp25-collector
   ```

8. Install the Apache virtual host, disable its placeholder site, and start Apache:

   ```bash
   sudo install -m 0644 deploy/apache.conf /etc/apache2/sites-available/awp25-monitor.conf
   sudo a2ensite awp25-monitor.conf
   sudo a2dissite 000-default.conf
   sudo apache2ctl configtest
   sudo systemctl enable --now apache2
   ```

Set `ServerName` in `deploy/apache.conf` before installing it if the monitor has a DNS name. The dashboard will be available at `http://YOUR-SERVER/`. Add TLS using the server's normal certificate workflow before public launch.

## Operations

```bash
systemctl status awp25-collector
journalctl -u awp25-collector -f
curl -s http://127.0.0.1/status.json
```

The collector never rotates, renames, or deletes logs. At startup it reads only the three most recently modified matching files, oldest-to-newest, then follows the newest one. It detects a new filename, inode replacement, or in-place truncation after your own rotation and resumes at the correct position. JSON publication uses an atomic rename, ensuring Apache never serves a partially written document.

Connected nodes refresh from the reflector's approximately five-second heartbeat records. A node disappears after 20 seconds without a heartbeat by default (about four missed intervals); adjust `P25_NODE_TIMEOUT` in `/etc/awp25-monitor.env` if needed.
