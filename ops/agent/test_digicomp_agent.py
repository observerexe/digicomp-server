"""Tests for the server agent: python3 -m unittest discover ops/agent"""

import http.client
import json
import os
import socket
import tempfile
import threading
import time
import unittest

import digicomp_agent as agent

TOKEN = "t" * 40


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost")
        self.unix_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.unix_path)


class AgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["AGENT_TOKEN"] = TOKEN
        os.environ["AGENT_SOCKET"] = os.path.join(self.tmp.name, "a.sock")
        os.environ["SERVER_DIR"] = "/srv/server"
        os.environ["BACKUP_DIR"] = self.tmp.name
        self.cfg = agent.Config()
        self.ran = []
        self.release = threading.Event()

        def fake_runner(cmd):
            self.ran.append(cmd)
            self.release.wait(5)
            return 0, "line1\nline2\n"

        self.jobs = agent.Jobs(self.cfg, runner=fake_runner)
        self.info = {
            "metrics": lambda cfg: {"cpuPercent": 1.0},
            "containers": lambda cfg: {"items": [{"name": "api", "state": "running"}]},
            "last_backup": agent.last_backup,
            "logs": lambda cfg, n: {"lines": ["x"] * n},
        }
        self.server = agent.make_server(self.cfg, self.jobs, self.info)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, token=TOKEN):
        conn = UnixHTTPConnection(self.cfg.socket_path)
        headers = {"Authorization": "Bearer " + token} if token else {}
        payload = None
        if body is not None:
            payload = json.dumps(body)
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=payload, headers=headers)
        res = conn.getresponse()
        data = json.loads(res.read() or b"{}")
        conn.close()
        return res.status, data

    def test_token_required(self):
        self.assertEqual(self.call("GET", "/v1/health", token=None)[0], 401)
        self.assertEqual(self.call("GET", "/v1/health", token="wrong")[0], 401)
        self.assertEqual(self.call("GET", "/v1/health")[0], 200)

    def test_socket_permissions(self):
        mode = os.stat(self.cfg.socket_path).st_mode & 0o777
        self.assertEqual(mode & 0o007, 0, "others must not access the socket")

    def test_read_endpoints(self):
        self.assertEqual(self.call("GET", "/v1/metrics"), (200, {"cpuPercent": 1.0}))
        status, data = self.call("GET", "/v1/logs?lines=3")
        self.assertEqual((status, len(data["lines"])), (200, 3))
        for bad in ("0", "501", "abc", "-1"):
            self.assertEqual(self.call("GET", "/v1/logs?lines=" + bad)[0], 400)
        self.assertEqual(self.call("GET", "/v1/unknown")[0], 404)

    def test_last_backup(self):
        self.assertEqual(self.call("GET", "/v1/last-backup")[1], {"found": False, "count": 0})
        for name, age in (("db-old.dump", 100), ("db-new.dump", 0), ("note.txt", 0)):
            p = os.path.join(self.tmp.name, name)
            with open(p, "wb") as f:
                f.write(b"x" * 10)
            t = time.time() - age
            os.utime(p, (t, t))
        data = self.call("GET", "/v1/last-backup")[1]
        self.assertEqual((data["found"], data["count"], data["file"]), (True, 2, "db-new.dump"))

    def test_only_known_actions(self):
        for body in ({"action": "rm -rf /"}, {"action": "restart-db"}, {}, ["backup"]):
            self.assertEqual(self.call("POST", "/v1/jobs", body)[0], 400)
        self.assertEqual(self.call("POST", "/v1/other", {"action": "backup"})[0], 404)
        self.assertEqual(self.ran, [])

    def test_fixed_commands(self):
        self.assertEqual(
            agent.job_command(self.cfg, "backup"),
            (["/srv/server/scripts/backup.sh"], "/srv/server"),
        )
        self.assertEqual(
            agent.job_command(self.cfg, "restart-api"),
            (["docker", "compose", "restart", "api"], "/srv/server"),
        )
        self.assertEqual(
            agent.job_command(self.cfg, "restart-ha"),
            (["docker", "restart", "homeassistant"], None),
        )
        self.assertIsNone(agent.job_command(self.cfg, "restart-db"))

    def test_job_lifecycle_one_at_a_time(self):
        status, job = self.call("POST", "/v1/jobs", {"action": "backup"})
        self.assertEqual((status, job["status"], job["action"]), (202, "running", "backup"))
        self.assertEqual(self.call("POST", "/v1/jobs", {"action": "restart-ha"})[0], 409)
        self.release.set()
        for _ in range(50):
            data = self.call("GET", "/v1/jobs/" + job["id"])[1]
            if data["status"] != "running":
                break
            time.sleep(0.05)
        self.assertEqual(data["status"], "succeeded")
        self.assertEqual(data["exitCode"], 0)
        self.assertEqual(data["output"], ["line1", "line2"])
        self.assertEqual(self.call("GET", "/v1/jobs/" + "0" * 32)[0], 404)
        self.assertEqual(self.call("GET", "/v1/jobs/../../etc")[0], 404)

    def test_logs_without_colors(self):
        orig = agent.run
        agent.run = lambda args, cwd=None, timeout=30: (0, "\x1b[32m[Nest]\x1b[39m ok\nsecond\n")
        try:
            self.assertEqual(agent.logs(self.cfg, 5)["lines"], ["[Nest] ok", "second"])
        finally:
            agent.run = orig

    def test_failed_job(self):
        jobs = agent.Jobs(self.cfg, runner=lambda cmd: (2, "boom"))
        job = jobs.start("restore-check")
        for _ in range(50):
            if jobs.get(job["id"])["status"] != "running":
                break
            time.sleep(0.02)
        self.assertEqual(jobs.get(job["id"])["status"], "failed")


if __name__ == "__main__":
    unittest.main()
