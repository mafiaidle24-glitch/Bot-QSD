// Service worker mínimo: permite instalar o painel como app. Não guarda nada em cache
// (o painel sempre carrega a versão mais nova e os dados sempre vêm do servidor).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
