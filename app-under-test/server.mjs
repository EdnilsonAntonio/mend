import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3100;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // Only allow GET and HEAD methods
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = 'Method Not Allowed';
    const bodyLength = Buffer.byteLength(body);
    res.writeHead(405, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': bodyLength,
    });
    if (req.method !== 'HEAD') {
      res.end(body);
    } else {
      res.end();
    }
    return;
  }

  try {
    // Parse the pathname and decode it
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;
    pathname = decodeURIComponent(pathname);

    // Map root to index.html
    if (pathname === '/') {
      pathname = '/index.html';
    }

    // Resolve the file path
    const filePath = path.join(ROOT, pathname);

    // Check if resolved path escapes ROOT (traversal attack)
    const normalizedPath = path.normalize(filePath);
    const normalizedRoot = path.normalize(ROOT);
    if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
      const body = 'Forbidden';
      const bodyLength = Buffer.byteLength(body);
      res.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': bodyLength,
      });
      if (req.method !== 'HEAD') {
        res.end(body);
      } else {
        res.end();
      }
      return;
    }

    // Try to read the file
    const stats = await fs.stat(filePath);

    // Check if it's a directory
    if (stats.isDirectory()) {
      const body = 'Not Found';
      const bodyLength = Buffer.byteLength(body);
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': bodyLength,
      });
      if (req.method !== 'HEAD') {
        res.end(body);
      } else {
        res.end();
      }
      return;
    }

    // Read and serve the file
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypes[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });

    if (req.method !== 'HEAD') {
      res.end(data);
    } else {
      res.end();
    }
  } catch (err) {
    // File not found or other fs error
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      const body = 'Not Found';
      const bodyLength = Buffer.byteLength(body);
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': bodyLength,
      });
      if (req.method !== 'HEAD') {
        res.end(body);
      } else {
        res.end();
      }
    } else {
      const body = 'Internal Server Error';
      const bodyLength = Buffer.byteLength(body);
      res.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': bodyLength,
      });
      if (req.method !== 'HEAD') {
        res.end(body);
      } else {
        res.end();
      }
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('Port 3100 is already in use. Stop the other process and retry.');
    process.exit(1);
  } else {
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('app-under-test listening on http://localhost:3100');
});
