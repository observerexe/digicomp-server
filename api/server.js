const http = require("http");

http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", time: new Date().toISOString() }));
  })
  .listen(3000, "0.0.0.0");
