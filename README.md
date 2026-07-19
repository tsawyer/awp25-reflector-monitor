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

6. Hand port 80 from the retired Lighttpd service to Apache:

   ```bash
   sudo systemctl disable --now lighttpd
   sudo a2enmod alias headers
   ```

7. Install the Apache virtual host, disable its placeholder site, and start Apache:

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
