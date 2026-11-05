// HikeJournal service worker.
// 1. Makes the app installable on Android and shows a short message when it is opened without internet.
//    It caches nothing, so every update arrives immediately.
// 2. Streams videos from Google Drive: the player loads "drive-media/<Drive file id>" from the app's own address,
//    and this worker fetches it from Drive with the user's access token, passing the Range header through so the
//    video starts at once and can be seeked (a <video> element cannot send an Authorization header itself).
const DRIVE = 'https://www.googleapis.com/drive/v3/files/';
let token = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  if (e.data && typeof e.data.hjToken === 'string') token = e.data.hjToken;
});

/** Asks an open app window for a fresh token (the app answers through the MessageChannel). */
async function askToken() {
  const wins = await self.clients.matchAll({ type: 'window' });
  for (const w of wins) {
    const ch = new MessageChannel();
    const answer = new Promise((resolve) => {
      ch.port1.onmessage = (e) => resolve(e.data || null);
      setTimeout(() => resolve(null), 8000);
    });
    w.postMessage({ hjNeedToken: true }, [ch.port2]);
    const t = await answer;
    if (t) return t;
  }
  return null;
}

async function driveMedia(request, id) {
  if (!token) token = await askToken();
  const send = () => {
    const headers = { Authorization: 'Bearer ' + token };
    const range = request.headers.get('Range');
    if (range) headers.Range = range;
    return fetch(DRIVE + encodeURIComponent(id) + '?alt=media', { headers });
  };
  let r = await send();
  if (r.status === 401) {
    token = await askToken();
    r = await send();
  }
  return r;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const m = url.origin === self.location.origin && /\/drive-media\/([^/?#]+)$/.exec(url.pathname);
  if (m) {
    e.respondWith(driveMedia(e.request, decodeURIComponent(m[1])));
    return;
  }
  if (e.request.mode !== 'navigate') return; // everything else goes to the network as usual
  e.respondWith(
    fetch(e.request).catch(() => new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>HikeJournal</title><body style="font:17px/1.5 system-ui,sans-serif;margin:20vh 24px;text-align:center">' +
      '<h1 style="font-size:22px">Ni povezave</h1><p>HikeJournal potrebuje internet (Google Drive in zemljevid). Poskusi znova, ko boš povezan.</p>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } })),
  );
});
