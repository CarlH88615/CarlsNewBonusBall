self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Bonus Ball Update', body: 'New result available!' };
  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: '/' }
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
