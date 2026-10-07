// Serves the mock popup in a normal tab (UI review / screenshots):
//   npm run preview:ui  →  builds to build-mock/, serves http://localhost:4178/popup.html
// Always the mock build: a normal page can't call the Shifter API (no CORS
// headers); only the installed extension can, via host_permissions.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../build-mock/chrome-mv3/', import.meta.url));
const shim = await readFile(fileURLToPath(new URL('./preview-shim.js', import.meta.url)), 'utf8');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const port = Number(process.env.PORT ?? 4178);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    let body = await readFile(join(root, path === '/' ? 'popup.html' : path));
    if (path.endsWith('.html')) {
      // Frame the 380x600 popup in the middle of the page and load the shim first.
      body = body.toString()
        .replace('<head>', `<head><script>${shim}</script><style>html{background:#05070d!important;width:100%!important;height:auto!important;min-height:100vh;overflow:auto!important;display:grid;place-items:center}#root{box-shadow:0 30px 80px -20px #000}</style>`);
    }
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Popup preview → http://localhost:${port}/popup.html`));
