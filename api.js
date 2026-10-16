// Simple endpoint for Astra self-improvement — receives new feature text
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'POST' && req.url === '/add-feature') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const feature = data.feature || data.text || '';
        const file = path.join(__dirname, 'features.json');
        let list = [];
        try { list = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch(e){}
        list.push({ time: Date.now(), feature: feature, source: 'astra_auto' });
        fs.writeFileSync(file, JSON.stringify(list, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: feature }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Astra feature endpoint on port ' + PORT));
