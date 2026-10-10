// Service worker: riceve le notifiche push e apre la pagina giusta al tocco.
// Non mette in cache nulla: il sito resta sempre quello appena pubblicato.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Settimo Milanese';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) return c.navigate(url);
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
