import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(200); res.end('Transcriber Gateway');
});
const wss = new WebSocketServer({ server, path: '/v1/stream' });

function connectDeepgram(lang='en-US') {
  const url = new URL('wss://api.deepgram.com/v1/listen');
  url.searchParams.set('model','nova-2-general');
  url.searchParams.set('interim_results','true');
  url.searchParams.set('smart_format','true');
  url.searchParams.set('language', lang);
  url.searchParams.set('utterance_end_ms','800');
  return new WebSocket(url, { headers:{ Authorization:`Token ${process.env.DEEPGRAM_API_KEY}` }});
}

wss.on('connection', (client, req) => {
  const qs = new URL(req.url, 'http://x').searchParams;
  const lang = qs.get('lang') || 'en-US';
  const upstream = connectDeepgram(lang);

  upstream.on('open', () => client.send(JSON.stringify({ type:'ready' })));

  client.on('message', data => {
    if (upstream.readyState === upstream.OPEN) upstream.send(data);
  });

  upstream.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'Results' && msg.channel?.alternatives?.length) {
        const alt = msg.channel.alternatives[0];
        const text = alt.transcript || '';
        if (!text) return;
        const words = alt.words || [];
        const startMs = Math.floor((words[0]?.start || 0) * 1000);
        const endMs   = Math.floor((words.at(-1)?.end || 0) * 1000);
        client.send(JSON.stringify({ type: msg.is_final ? 'final':'partial', text, startMs, endMs }));
      }
    } catch {}
  });

  const close = () => { try { upstream.close(); } catch {} try { client.close(); } catch {} };
  client.on('close', close); upstream.on('close', close);
});

server.listen(PORT, () => console.log('Gateway on :' + PORT));
