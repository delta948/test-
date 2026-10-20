const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, 'build');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const backendUrl = new URL(process.env.BACKEND_URL || 'http://127.0.0.1:8000');

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);

  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    const proxyRequest = http.request({
      hostname: backendUrl.hostname,
      port: backendUrl.port || 80,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: backendUrl.host,
      },
    }, (proxyResponse) => {
      res.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(res);
    });

    proxyRequest.on('error', (error) => {
      console.error(`Backend proxy error: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'Бэкенд недоступен' }));
    });

    req.pipe(proxyRequest);
    return;
  }

  const requested = path.normalize(path.join(root, urlPath));

  if (!requested.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(requested, (error, stats) => {
    if (!error && stats.isFile()) {
      sendFile(res, requested);
      return;
    }

    sendFile(res, path.join(root, 'index.html'));
  });
});

server.listen(port, host, () => {
  console.log(`Frontend server listening at http://${host}:${port}`);
});
