// HikeJournal service worker: makes the app installable on Android and shows a short message when the
// app is opened without internet. It caches nothing, so every update arrives immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // everything else goes to the network as usual
  e.respondWith(
    fetch(e.request).catch(() => new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>HikeJournal</title><body style="font:17px/1.5 system-ui,sans-serif;margin:20vh 24px;text-align:center">' +
      '<h1 style="font-size:22px">Ni povezave</h1><p>HikeJournal potrebuje internet (Google Drive in zemljevid). Poskusi znova, ko boš povezan.</p>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } })),
  );
});
