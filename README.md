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
| 2 | Catalogue et kits : articles, codes-barres, kits virtuels et pré-assemblés, import/export Excel, étiquettes | **Livrée** |
| 3 | Stock et achats : dépôts, mouvements, CMP, transferts, assemblage de kits, alertes, fournisseurs, bons de commande, réceptions, suggestions | **Livrée** |
| 4 | Couche hors connexion : base locale Dexie, outbox, `sync/push` et `sync/pull` idempotents, conflits, PIN hors ligne, écrans de synchronisation | **Livrée** |
| 5 | Ventes et caisse | À venir |
| 6 | Inventaires | À venir |
| 7 | Boutique et commandes en ligne | À venir |
| 8 | Notifications | À venir |
| 9 | Statistiques et exports | À venir |
| 10 | Audit complet, durcissement | À venir |
| 11 | Données de démonstration et documentation complète | À venir |

Sous Windows, WeasyPrint (PDF) nécessite les bibliothèques GTK : sans elles, le bouton PDF répond par un
message explicite et la version imprimable HTML reste disponible. L'image Docker les inclut.

Les menus des modules à venir sont déjà présents et protégés par les permissions ; ils affichent la phase
de livraison.

### Ce que contient la phase 4 (mode hors connexion)

- **Base locale IndexedDB (Dexie)** du backoffice : miroirs du catalogue, kits, codes-barres, stocks,
  dépôts, référentiels, paramètres, fournisseurs et bons en attente, plus une table `outbox`.
- **Outbox** : toute opération faite hors ligne (réception, perte/casse, ajustement, événement d'audit…)
  est écrite localement avec un UUID v4 généré sur le terminal, la date client et le code terminal.
  Le stock affiché = dernier stock synchronisé + mouvements locaux non encore envoyés.
- **`POST /api/sync/push/`** : traitement par lot, **idempotent** (une opération rejouée renvoie le
  résultat mémorisé, jamais de doublon), réponse par opération `ok` / `conflict` / `error`.
- **`GET /api/sync/pull/?since=<curseur>`** : toutes les modifications depuis le curseur global
  (`sync_version`), suppressions logiques comprises, paginées sans trou.
- Déclenchement : au démarrage, au retour du réseau, toutes les N minutes (paramètre), bouton
  « Synchroniser » et Background Sync (service worker `librairie-sw.js`) quand le navigateur la propose.
  Réessais avec backoff exponentiel (5 s → 15 min) ; les refus définitifs restent visibles dans
  **Synchronisation › File d'attente** (relance ou abandon).
- **Conflits** sur données modifiables : « dernier écrit gagne » selon `sync_version` et les dates,
  tracés dans **Synchronisation › Conflits** et dans l'audit (les prix et fiches articles restent
  modifiables uniquement en ligne).
- **Authentification hors ligne** : après une connexion en ligne, le profil et les jetons sont gardés
  sur le terminal ; le PIN (vérifié par le serveur, conservé haché PBKDF2) permet de reprendre la main
  hors ligne pendant la durée maximale paramétrée (72 h par défaut) et à plusieurs caissiers de se
  relayer (menu utilisateur › « Changer d'utilisateur »).

**Tester le hors ligne** : ouvrir le backoffice compilé (Docker ou `ng build` + serveur HTTPS/localhost),
se connecter une fois en ligne en saisissant son PIN, puis couper le réseau (DevTools › Network ›
Offline) : enregistrer une perte ou une réception, constater « 1 en attente », rétablir le réseau et
vérifier le mouvement dans **Stock › Mouvements**.

### Ce que contient la phase 3

- **Stock multi-dépôts** (magasin et réserve créés d'office) : le stock n'est jamais saisi en valeur absolue.
  Chaque opération écrit un mouvement signé dans un journal en ajout seul ; le stock = somme des
  mouvements, ce qui permettra à plusieurs caisses hors ligne de vendre sans se contredire. Les lots sont
  convertis en unités de leur article de base ; services et kits virtuels n'ont pas de stock propre.
- **État des stocks** par dépôt (physique, réservé, disponible, valeur au CMP, statut), fiche de stock avec
  solde progressif, journal des mouvements filtrable.
- **Transferts** entre dépôts avec bon de transfert imprimable ; **pertes, casse et ajustements** avec motif
  obligatoire (tracés dans l'audit) ; **assemblage / désassemblage** des kits pré-assemblés.
- Opérations manuelles refusées si le stock du dépôt est insuffisant (les ventes hors ligne, elles, seront
  toujours acceptées puis signalées).
- **Alertes** stock bas / rupture, recalculées à chaque mouvement et toutes les heures (Celery beat).
- **Achats** : fournisseurs, bons de commande (brouillon → envoyé → partiellement reçu → reçu, annulation,
  solde du reliquat), PDF WeasyPrint et version imprimable, réceptions totales ou partielles avec ou sans
  commande (idempotentes), **CMP recalculé** à chaque réception (et coût des kits mis à jour),
  **suggestions de réapprovisionnement** (seuil + ventes pendant le délai fournisseur) transformables en
  bons de commande par fournisseur.
- Un terminal peut être rattaché à un dépôt (proposé par défaut dans les formulaires).

### Ce que contient la phase 2

- **Articles** simples, lots (conditionnements convertis en unités) et services : catégories arborescentes,
  marques, unités, prix détail / gros avec seuil, TVA paramétrable, seuils de stock, photos, visibilité
  boutique. Le code interne est attribué automatiquement.
- **Codes-barres** : plusieurs par article ; EAN-13 fabricant contrôlé (clé), code interne EAN-13
  (préfixe magasin « 20 ») généré à la création ; recherche directe par douchette ; impression
  d'étiquettes (planche A4 de 24 ou rouleau 50 × 30 mm) dessinées en SVG, donc imprimables hors ligne.
- **Prix** modifiables uniquement en ligne et avec la permission « Modifier les prix » ; chaque changement
  est historisé (fiche article) et inscrit au journal d'audit. Le CMP n'est saisi qu'à la création.
- **Kits scolaires** par niveau (CP1 à Terminale, séries A/C/D), établissement et année scolaire :
  composition avec articles facultatifs et équivalents autorisés, prix fixe ou calculé (somme des
  composants moins la remise, arrondi à 5 FCFA, réglable dans les paramètres) avec marge affichée,
  duplication vers un autre niveau/établissement/année. Mode « virtuel » (disponibilité = composant le
  plus limitant) ou « pré-assemblé » (stock propre ; l'assemblage arrive avec la phase stock).
  Le calcul des retraits et substitutions à la vente existe côté serveur et en TypeScript (pour la caisse
  hors ligne), avec les mêmes résultats.
- **Import / export Excel** des articles et des listes de fournitures, avec simulation obligatoire avant
  application, rapport d'erreurs par ligne et modèles vierges.
- Référentiels : niveaux, années scolaires et établissements (aussi accessibles depuis Clients).

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
# Contrôle de cohérence du stock (reconstruit les niveaux depuis le journal) :
python manage.py rebuild_stock_levels
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
