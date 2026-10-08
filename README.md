# Librairie — gestion de librairie (Angular PWA + Django)

Application de gestion de librairie pensée pour la Côte d'Ivoire (interface en français, locale `fr-CI`,
fuseau `Africa/Abidjan`, montants en FCFA sans décimales) :

- **backoffice** : PWA du personnel (caisse, stock, commandes en ligne, inventaires, statistiques, audit),
  conçue pour fonctionner en ligne et hors connexion ;
- **boutique** : PWA client (catalogue, kits scolaires, commande et retrait en librairie) ;
- **backend** : API Django REST, WebSocket (Channels), tâches Celery.

L'arborescence complète et le schéma des modèles de données sont décrits dans
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Socle : dépôt, Docker, settings, `SyncModel`, comptes, rôles, JWT, workspace Angular, PWA, layout, menus, authentification | **Livrée** |
| 2 | Catalogue et kits | À venir |
| 3 | Stock et achats | À venir |
| 4 | Couche hors connexion (Dexie, outbox, sync) | À venir |
| 5 | Ventes et caisse | À venir |
| 6 | Inventaires | À venir |
| 7 | Boutique et commandes en ligne | À venir |
| 8 | Notifications | À venir |
| 9 | Statistiques et exports | À venir |
| 10 | Audit complet, durcissement | À venir |
| 11 | Données de démonstration et documentation complète | À venir |

Les menus des modules à venir sont déjà présents et protégés par les permissions ; ils affichent la phase
de livraison.

### Ce que contient la phase 1

**Backend**
- `SyncModel` (app `core`) : UUID fourni par le client, `created_at`, `updated_at`, `sync_version` alimenté
  par un compteur global monotone (curseur unique pour le futur `sync/pull`), `is_deleted` (suppression
  logique), `device`, `client_timestamp`.
- Comptes : utilisateur à clé UUID, connexion par identifiant **ou téléphone**, 7 rôles
  (Administrateur, Gérant, Caissier, Magasinier, Préparateur, Inventoriste, Client) et 39 permissions
  par action ; la matrice par défaut est créée par migration et reste modifiable par l'administrateur.
- JWT (`simplejwt`) avec rotation et liste noire des jetons de rafraîchissement, limitation de débit sur
  les endpoints d'authentification, PIN par utilisateur (haché), terminaux (`Device`) avec code unique.
- Journal d'audit en lecture seule (connexions, échecs, PIN, changements de rôles, paramètres…), avec
  terminal, IP, date serveur et date client.
- Paramètres de la librairie (en-tête de reçu, NCC, durée max hors ligne, etc.).
- OpenAPI / Swagger sur `/api/docs/`, sonde `/api/health/`, WebSocket authentifié `/ws/status/`.

**Frontend**
- Workspace Angular 20 (composants standalone, signals, `@if`/`@for`), Angular Material 3 avec thème
  clair/sombre, bibliothèque partagée `@librairie/shared`.
- PWA configurées (`ngsw-config.json`) : app shell et polices pré-chargées, images produits en cache,
  stratégie `freshness` pour les API de lecture, bannière « Nouvelle version disponible ».
- Backoffice : écran de connexion, layout responsive avec les 12 menus filtrés par permissions,
  indicateurs permanents (réseau, opérations en attente, dernière synchronisation), tableau de bord,
  profil (mot de passe, PIN), administration des utilisateurs, matrice rôles × permissions, terminaux,
  paramètres, journal d'audit et connexions.
- Boutique : accueil, inscription et connexion client par téléphone, compte.

## Installation locale (sans Docker)

Prérequis : Python 3.12 (3.11 fonctionne aussi), Node.js 20+ et npm, Google Chrome (tests Angular).
Sans `DATABASE_URL`, le backend utilise SQLite ; sans `REDIS_URL`, il utilise un cache et une couche
Channels en mémoire et exécute les tâches Celery immédiatement.

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows ; sous Linux/macOS : source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py migrate
python manage.py ensure_admin --username admin --password "Admin-Librairie-2026"
python manage.py runserver
```

L'API répond sur http://127.0.0.1:8000/api/ et la documentation sur http://127.0.0.1:8000/api/docs/.

### Frontend

```bash
cd frontend
npm install
npm run start:backoffice        # http://localhost:4200
npm run start:boutique          # http://localhost:4300
```

Le serveur de développement relaie `/api`, `/ws`, `/uploads` et `/admin` vers Django
(`proxy.conf.mjs`, cible réglable par `API_PROXY_TARGET`). Le service worker n'est actif que sur un build
de production : pour tester l'installation PWA en local, utilisez Docker ou `ng build` puis un serveur
statique.

### Tests

```bash
cd backend && python -m pytest          # pytest + pytest-django
cd frontend && npm test                 # Jasmine/Karma, Chrome headless (shared, backoffice, boutique)
```

## Démarrage avec Docker

```bash
cp .env.example .env
cp backend/.env.example backend/.env    # puis modifier DJANGO_SECRET_KEY et ADMIN_PASSWORD
docker compose up -d --build
```

Services : `postgres` (16), `redis` (7), `backend` (Gunicorn + workers Uvicorn, ASGI : HTTP et WebSocket),
`celery_worker`, `celery_beat`, `frontend` (les deux PWA compilées, servies par nginx) et `nginx`
(reverse proxy). Au démarrage, le backend applique les migrations, collecte les fichiers statiques et
crée l'administrateur défini par `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

- Backoffice : http://localhost (port `BACKOFFICE_PORT`)
- Boutique : http://localhost:8081 (port `BOUTIQUE_PORT`)
- Admin Django : http://localhost/admin/

## Variables d'environnement

| Fichier | Rôle |
|---|---|
| `.env` (racine) | Variables de `docker compose` : identifiants PostgreSQL, ports publiés |
| `backend/.env` | Django : clé secrète, hôtes, base, Redis, administrateur initial, JWT, VAPID, e-mail |
| `frontend/.env` | Cible du proxy de développement (`API_PROXY_TARGET`) |

Les modèles commentés sont dans les fichiers `.env.example` correspondants.

## Clés VAPID (Web Push)

Les notifications push (phase 8) utilisent des clés VAPID. Pour les générer :

```bash
cd backend
.venv/Scripts/vapid --gen          # crée private_key.pem et public_key.pem
.venv/Scripts/vapid --applicationServerKey
```

Reportez la clé « Application Server Key » dans `VAPID_PUBLIC_KEY` et le contenu de `private_key.pem`
(ou sa version base64url) dans `VAPID_PRIVATE_KEY`, puis supprimez les fichiers `.pem` du dépôt.

## Déploiement HTTPS sur un VPS (Certbot)

Une PWA ne s'installe et n'active son service worker qu'en HTTPS. Exemple avec deux sous-domaines
`gestion.ma-librairie.ci` (backoffice) et `boutique.ma-librairie.ci` (boutique) pointant vers le VPS :

1. Installer Docker et le plugin Compose sur le VPS, cloner le dépôt, préparer `.env` et `backend/.env`
   (`DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` avec les domaines en `https://`,
   `SECURE_SSL_REDIRECT=True`, `SECURE_HSTS_SECONDS=31536000`, `SECURE_COOKIES=True`).
2. Démarrer une première fois en HTTP : `docker compose up -d --build`.
3. Obtenir les certificats par la méthode webroot (le dossier est monté dans nginx) :

   ```bash
   docker run --rm -v "$PWD/nginx/certbot/conf:/etc/letsencrypt" \
     -v "$PWD/nginx/certbot/www:/var/www/certbot" certbot/certbot certonly --webroot \
     -w /var/www/certbot -d gestion.ma-librairie.ci -d boutique.ma-librairie.ci \
     --email admin@ma-librairie.ci --agree-tos --no-eff-email
   ```

   Pour que le défi ACME réussisse dès cette étape, ajoutez temporairement au bloc `server` du port 80 de
   `nginx/conf.d/librairie.conf` la règle `location /.well-known/acme-challenge/ { root /var/www/certbot; }`.
4. Remplacer `nginx/conf.d/librairie.conf` par `nginx/https.conf.example` (domaines adaptés) puis
   `docker compose restart nginx`.
5. Renouvellement automatique (crontab du VPS) :

   ```bash
   0 3 * * * cd /opt/librairie && docker run --rm -v "$PWD/nginx/certbot/conf:/etc/letsencrypt" -v "$PWD/nginx/certbot/www:/var/www/certbot" certbot/certbot renew --quiet && docker compose exec nginx nginx -s reload
   ```

## Enregistrement d'un terminal

Chaque poste (caisse, tablette) doit être associé à un terminal : son code préfixe les numéros de reçus
émis hors ligne (`C02-20261008-0047`).

1. Un administrateur ouvre **Administration › Terminaux**, saisit un code unique (2 à 10 caractères,
   ex. `C02`), un nom et un type, puis enregistre.
2. Sur le poste concerné, connecté avec un compte administrateur, il clique sur
   **« Utiliser sur ce poste »**. Le code est mémorisé localement et envoyé avec chaque requête
   (en-tête `X-Device-Code`) ; il apparaît dans la barre supérieure et dans le journal d'audit.
3. Un terminal ne se supprime pas (ses reçus portent son code) : il se désactive.

## Rôles par défaut

| Rôle | Accès principal |
|---|---|
| Administrateur | Tout, dont utilisateurs, rôles, terminaux et paramètres |
| Gérant | Supervision, prix, autorisations, validation d'inventaire, statistiques, audit |
| Caissier | Ventes, retours (avec autorisation), caisse, clients, remise des commandes |
| Magasinier | Stock, transferts, assemblage de kits, réceptions |
| Préparateur | Préparation des commandes en ligne |
| Inventoriste | Comptages d'inventaire |
| Client | Boutique en ligne uniquement |

La commande `python manage.py sync_roles` ajoute les permissions manquantes après une mise à jour ;
`--reset` rétablit la matrice par défaut.
