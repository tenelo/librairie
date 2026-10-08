// Proxy du serveur de développement Angular vers Django.
// La cible se règle avec la variable d'environnement API_PROXY_TARGET (voir .env.example).
// Les préfixes se terminent par « / » : sans cela, « /admin » capterait aussi la route
// Angular « /administration ».
const target = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000';
const wsTarget = target.replace(/^http/, 'ws');

export default {
  '/api/': { target, secure: false },
  '/uploads/': { target, secure: false },
  '/admin/': { target, secure: false },
  '/static/': { target, secure: false },
  '/ws/': { target: wsTarget, secure: false, ws: true },
};
