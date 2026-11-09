#!/usr/bin/env python3
"""DigiComp server agent.

Small service for the extended admin panel. It listens only on a unix socket
(no network port), checks a shared token and runs a FIXED list of commands.
The API never gets a shell or the docker socket: it can only ask the agent
for one of the actions below. Arguments from the API are never passed to a
shell; the only parameters are a bounded number of log lines and an action
name from a closed list.

Standard library only (Python 3.8+). Configuration via environment
(see agent.env.example).
"""

import hmac
import json
import os
import re
import shutil
import socketserver
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

VERSION = "1"


def env(name, default=None):
    value = os.environ.get(name, default)
    return value.strip() if isinstance(value, str) else value


class Config:
    def __init__(self):
        home = os.path.expanduser("~")
        self.token = env("AGENT_TOKEN", "")
        self.socket_path = env("AGENT_SOCKET", "/run/digicomp-agent/agent.sock")
        self.server_dir = env("SERVER_DIR", os.path.join(home, "server"))
        self.backup_dir = env("BACKUP_DIR", os.path.join(home, "backups", "digicomp"))
        self.ha_container = env("HA_CONTAINER", "homeassistant")
        self.api_service = env("API_SERVICE", "api")
        self.db_service = env("DB_SERVICE", "db")
        self.job_timeout = int(env("JOB_TIMEOUT_SECONDS", "1800"))


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# --- commands (argument lists, never a shell) -----------------------------


def run(args, cwd=None, timeout=30):
    """Runs a command and returns (exit code, combined output)."""
    proc = subprocess.run(
        args,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace")


def job_command(cfg, action):
    """Fixed command for each allowed action."""
    compose = ["docker", "compose"]
    commands = {
        "backup": ([os.path.join(cfg.server_dir, "scripts", "backup.sh")], cfg.server_dir),
        "restore-check": (
            [os.path.join(cfg.server_dir, "scripts", "restore-check.sh")],
            cfg.server_dir,
        ),
        "restart-api": (compose + ["restart", cfg.api_service], cfg.server_dir),
        "restart-ha": (["docker", "restart", cfg.ha_container], None),
    }
    return commands.get(action)


ACTIONS = ("backup", "restore-check", "restart-api", "restart-ha")


# --- read-only information -------------------------------------------------


def read_cpu_times():
    with open("/proc/stat", encoding="ascii") as f:
        parts = f.readline().split()[1:]
    values = [int(x) for x in parts]
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    return idle, sum(values)


def cpu_percent(sample=0.5):
    idle1, total1 = read_cpu_times()
    time.sleep(sample)
    idle2, total2 = read_cpu_times()
    total = total2 - total1
    if total <= 0:
        return 0.0
    return round(100.0 * (1 - (idle2 - idle1) / total), 1)


def memory():
    info = {}
    with open("/proc/meminfo", encoding="ascii") as f:
        for line in f:
            key, rest = line.split(":", 1)
            info[key] = int(rest.split()[0]) * 1024
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", 0)
    return {"totalBytes": total, "usedBytes": total - available, "availableBytes": available}


def disk(path):
    try:
        u = shutil.disk_usage(path)
    except OSError:
        return None
    return {"path": path, "totalBytes": u.total, "usedBytes": u.used, "freeBytes": u.free}


def metrics(cfg):
    with open("/proc/uptime", encoding="ascii") as f:
        uptime = float(f.read().split()[0])
    load = os.getloadavg()
    disks = [d for d in (disk("/"), disk(cfg.backup_dir)) if d]
    return {
        "cpuPercent": cpu_percent(),
        "cpuCount": os.cpu_count(),
        "load": [round(x, 2) for x in load],
        "memory": memory(),
        "disks": disks,
        "uptimeSeconds": int(uptime),
        "collectedAt": now_iso(),
    }


def containers(cfg):
    """State of the API, the database and Home Assistant."""
    items = []
    code, out = run(
        ["docker", "compose", "ps", "--all", "--format", "json"], cwd=cfg.server_dir
    )
    rows = []
    if code == 0:
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except ValueError:
                continue
            rows.extend(data if isinstance(data, list) else [data])
    by_service = {r.get("Service"): r for r in rows}
    for service in (cfg.api_service, cfg.db_service):
        r = by_service.get(service)
        items.append(
            {
                "name": service,
                "state": (r or {}).get("State", "missing"),
                "health": (r or {}).get("Health") or None,
                "status": (r or {}).get("Status", ""),
            }
        )
    code, out = run(["docker", "inspect", "--format", "{{json .State}}", cfg.ha_container])
    state = {}
    if code == 0:
        try:
            state = json.loads(out)
        except ValueError:
            state = {}
    health = (state.get("Health") or {}).get("Status")
    items.append(
        {
            "name": "homeassistant",
            "state": state.get("Status", "missing"),
            "health": health,
            "status": "since " + state["StartedAt"] if state.get("StartedAt") else "",
        }
    )
    return {"items": items}


def logs(cfg, lines):
    code, out = run(
        ["docker", "compose", "logs", "--no-color", "--no-log-prefix", "--tail", str(lines), cfg.api_service],
        cwd=cfg.server_dir,
    )
    clean = ANSI_RE.sub("", out)
    return {"lines": clean.splitlines()[-lines:], "ok": code == 0}


ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
BACKUP_RE = re.compile(r"^db-.*\.dump$")


def last_backup(cfg):
    try:
        names = [n for n in os.listdir(cfg.backup_dir) if BACKUP_RE.match(n)]
    except OSError:
        return {"found": False, "count": 0}
    if not names:
        return {"found": False, "count": 0}
    paths = [os.path.join(cfg.backup_dir, n) for n in names]
    newest = max(paths, key=os.path.getmtime)
    st = os.stat(newest)
    return {
        "found": True,
        "count": len(names),
        "file": os.path.basename(newest),
        "sizeBytes": st.st_size,
        "at": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
    }


# --- background jobs ---------------------------------------------------------


class Jobs:
    """One action at a time; the last 20 results are kept in memory."""

    KEEP = 20

    def __init__(self, cfg, runner=None):
        self.cfg = cfg
        self.lock = threading.Lock()
        self.jobs = {}
        self.order = []
        self.runner = runner or self._run

    def running(self):
        return any(j["status"] == "running" for j in self.jobs.values())

    def start(self, action):
        cmd = job_command(self.cfg, action)
        if cmd is None:
            raise KeyError(action)
        with self.lock:
            if self.running():
                return None
            job = {
                "id": uuid.uuid4().hex,
                "action": action,
                "status": "running",
                "startedAt": now_iso(),
                "finishedAt": None,
                "exitCode": None,
                "output": [],
            }
            self.jobs[job["id"]] = job
            self.order.append(job["id"])
            while len(self.order) > self.KEEP:
                self.jobs.pop(self.order.pop(0), None)
        thread = threading.Thread(target=self._wrap, args=(job, cmd), daemon=True)
        thread.start()
        return dict(job)

    def _wrap(self, job, cmd):
        # Give the HTTP answer time to leave before a restart of the API.
        if job["action"] == "restart-api":
            time.sleep(1)
        try:
            code, out = self.runner(cmd)
        except Exception as e:  # noqa: BLE001 - report any failure as job output
            code, out = -1, "agent error: %s" % e
        with self.lock:
            job["exitCode"] = code
            job["status"] = "succeeded" if code == 0 else "failed"
            job["finishedAt"] = now_iso()
            job["output"] = out.splitlines()[-100:]

    def _run(self, cmd):
        args, cwd = cmd
        try:
            return run(args, cwd=cwd, timeout=self.cfg.job_timeout)
        except subprocess.TimeoutExpired:
            return -1, "timeout after %s s" % self.cfg.job_timeout

    def get(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None


# --- HTTP over a unix socket -----------------------------------------------

JOB_ID_RE = re.compile(r"^[a-f0-9]{32}$")
MAX_BODY = 4096


class Handler(BaseHTTPRequestHandler):
    server_version = "digicomp-agent/" + VERSION
    cfg = None  # set by make_server
    jobs = None
    info = None  # overridable read functions (tests)

    def log_message(self, fmt, *args):  # journal gets one short line per request
        print("%s %s" % (self.command, fmt % args), flush=True)

    def reply(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        header = self.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        expected = self.cfg.token
        return bool(expected) and hmac.compare_digest(token.encode(), expected.encode())

    def do_GET(self):
        if not self.authorized():
            return self.reply(401, {"error": "unauthorized"})
        url = urlparse(self.path)
        try:
            if url.path == "/v1/health":
                return self.reply(200, {"ok": True, "version": VERSION})
            if url.path == "/v1/metrics":
                return self.reply(200, self.info["metrics"](self.cfg))
            if url.path == "/v1/containers":
                return self.reply(200, self.info["containers"](self.cfg))
            if url.path == "/v1/last-backup":
                return self.reply(200, self.info["last_backup"](self.cfg))
            if url.path == "/v1/logs":
                raw = parse_qs(url.query).get("lines", ["200"])[0]
                if not raw.isdigit() or not 1 <= int(raw) <= 500:
                    return self.reply(400, {"error": "lines must be 1..500"})
                return self.reply(200, self.info["logs"](self.cfg, int(raw)))
            if url.path.startswith("/v1/jobs/"):
                job_id = url.path[len("/v1/jobs/"):]
                if not JOB_ID_RE.match(job_id):
                    return self.reply(404, {"error": "not found"})
                job = self.jobs.get(job_id)
                return self.reply(200, job) if job else self.reply(404, {"error": "not found"})
        except subprocess.TimeoutExpired:
            return self.reply(504, {"error": "timeout"})
        return self.reply(404, {"error": "not found"})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {"error": "unauthorized"})
        if urlparse(self.path).path != "/v1/jobs":
            return self.reply(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.reply(400, {"error": "bad body"})
        try:
            data = json.loads(self.rfile.read(length))
        except ValueError:
            return self.reply(400, {"error": "bad json"})
        action = data.get("action") if isinstance(data, dict) else None
        if action not in ACTIONS:
            return self.reply(400, {"error": "unknown action"})
        job = self.jobs.start(action)
        if job is None:
            return self.reply(409, {"error": "another action is running"})
        return self.reply(202, job)


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        request, _ = super().get_request()
        # BaseHTTPRequestHandler expects a (host, port)-like address.
        return request, ("unix", 0)


DEFAULT_INFO = {
    "metrics": metrics,
    "containers": containers,
    "last_backup": last_backup,
    "logs": logs,
}


def make_server(cfg, jobs=None, info=None):
    if os.path.exists(cfg.socket_path):
        os.unlink(cfg.socket_path)
    handler = type(
        "BoundHandler",
        (Handler,),
        {"cfg": cfg, "jobs": jobs or Jobs(cfg), "info": info or DEFAULT_INFO},
    )
    old = os.umask(0o117)  # socket: rw for owner and group only
    try:
        server = UnixServer(cfg.socket_path, handler)
    finally:
        os.umask(old)
    return server


def main():
    cfg = Config()
    if len(cfg.token) < 32:
        raise SystemExit("AGENT_TOKEN must be set (at least 32 characters)")
    server = make_server(cfg)
    print("digicomp-agent listening on %s" % cfg.socket_path, flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            os.unlink(cfg.socket_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
