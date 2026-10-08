/*
 * Service worker du backoffice : celui d'Angular (cache de l'application, des polices, des images
 * et des API de lecture) complété par la Background Sync. Quand le navigateur signale le retour
 * du réseau (événement « sync »), les fenêtres ouvertes de l'application sont prévenues et
 * lancent la synchronisation de leur outbox (les jetons et la base locale restent côté page).
 */
importScripts('./ngsw-worker.js');

self.addEventListener('sync', (event) => {
  if (event.tag !== 'librairie-sync') {
    return;
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'librairie-sync' }))),
  );
});
