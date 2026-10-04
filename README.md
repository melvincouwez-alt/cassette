# Cassette

Cassette est un client Apple Music pour elementary OS. Il affiche `music.apple.com` dans une fenêtre qui suit le style d'elementary : barre d'en-tête framboise, police Inter, palette claire et sombre du système. Cassette fait partie de l'ensemble Boomerang, qui la propose dans son onglet « Services Apple ».

Cassette part de [Sidra](https://github.com/wimpysworld/sidra) 1.1.2, de Martin Wimpress. Le code propre à macOS et Windows, Discord, les thèmes de Sidra, Nix et la mise à jour par GitHub ont été retirés. Cassette ne suit plus Sidra.

## Ce que fait Cassette

- Lecture d'Apple Music et d'Apple Music Classical, avec le Widevine de CastLabs Electron pour les titres protégés.
- Barre d'en-tête elementary avec retour, avance, lecture en cours et réglages. La barre de lecture flottante d'Apple est masquée.
- Commandes multimédia du système par MPRIS (`org.mpris.MediaPlayer2.cassette`) : touches du clavier, indicateur son du panneau, raccourcis du lanceur (lecture/pause, suivant, précédent, arrêt).
- Une notification par morceau, avec la pochette et des boutons lecture/pause, précédent et suivant. Le son des notifications est coupé au premier lancement ; le réglage se trouve dans Paramètres système > Notifications.
- Scrobbling Last.fm, désactivé tant qu'aucun compte n'est connecté.
- Liens `itms://` ouverts dans Cassette.
- Molette sur le réglage de volume, navigation à la manette, zoom, page de démarrage au choix, fermeture dans la zone de notification.

## Installer

Cassette est livrée en paquet `.deb`. Boomerang peut l'installer depuis son onglet « Services Apple ». Pour construire le paquet soi-même :

```bash
npm install
npx tsc
npx electron-builder --linux deb --publish never
sudo apt install ./release/cassette_*_amd64.deb
```

Les réglages et la session Apple Music sont rangés dans `~/.config/Cassette/`, les pochettes en cache dans `~/.cache/cassette/`.

## Last.fm

Rien n'est envoyé à Last.fm avant la connexion d'un compte. Dans les Réglages, choisir **Se connecter à Last.fm…** puis valider dans le navigateur. Cassette envoie le morceau en cours au début de la lecture, puis le scrobble après la moitié de sa durée ou quatre minutes. Les morceaux de 30 secondes ou moins ne sont jamais scrobblés.

La clé de session et le nom d'utilisateur sont stockés en clair dans `~/.config/Cassette/config.json`. Une clé Last.fm n'expire pas : **Déconnecter** efface la copie locale, mais seul Last.fm peut l'invalider, depuis [les applications de ses réglages](https://www.last.fm/settings/applications). Le détail de ce qui est envoyé est dans [`docs/LASTFM-PRIVACY.md`](docs/LASTFM-PRIVACY.md).

Une construction locale n'a pas de clé d'API Last.fm, et les réglages cachent alors la fonction. Pour l'activer, créer un compte d'API sur [last.fm/api/account/create](https://www.last.fm/api/account/create) puis exporter la clé avant de construire :

```bash
export CASSETTE_LASTFM_API_KEY=votre-clé
export CASSETTE_LASTFM_API_SECRET=votre-secret
just build
```

Le fichier `assets/lastfm-credentials.json` produit par la construction est ignoré par git. Le secret ne doit jamais être commité.

## Développer

```bash
npm install
just run            # compile puis lance
just test           # tests Vitest
just lint           # vérification TypeScript de l'appli et des tests
```

`CASSETTE_DEVTOOLS=1` ouvre les outils de développement. Pour vérifier un rendu sans afficher de fenêtre : `CASSETTE_DEV_PROBE=/chemin/capture.png npx electron . --no-sandbox` capture la page dans un PNG ; `CASSETTE_DEV_DARK=1` force le thème sombre. Les notes techniques sont dans [`AGENTS.md`](AGENTS.md).

## Crédits

- **Sidra**, de Martin Wimpress ([wimpysworld/sidra](https://github.com/wimpysworld/sidra)), licence Blue Oak Model License 1.0.0. Cassette est un fork de la version 1.1.2, avec le travail de Martin Wimpress et de tous les contributeurs de Sidra (voir [leur historique](https://github.com/wimpysworld/sidra/graphs/contributors)) : l'intégration MPRIS, les notifications, Last.fm, le pont avec MusicKit, la navigation à la manette et la plus grande partie du code viennent de Sidra.
- **CastLabs Electron** ([castlabs/electron-releases](https://github.com/castlabs/electron-releases)), licence MIT, qui intègre Widevine à Electron. Le module Widevine lui-même appartient à Google : il n'est pas dans le paquet, CastLabs Electron le télécharge depuis les serveurs de Google au premier lancement.
- **Electron** ([electron/electron](https://github.com/electron/electron), MIT, OpenJS Foundation) et **Chromium** (BSD-3-Clause et autres licences, liste complète dans `/opt/Cassette/LICENSES.chromium.html` une fois le paquet installé), sur lesquels CastLabs Electron est construit.
- **Apple Music** et **MusicKit JS** d'Apple, chargés depuis `music.apple.com`. Apple, Apple Music, Apple Music Classical, iTunes et le logo Apple sont des marques d'Apple Inc., déposées aux États-Unis et dans d'autres pays. Cassette n'est ni affiliée à Apple ni approuvée par Apple.
- **elementary OS** ([elementary.io](https://elementary.io)) : les couleurs de la palette reprennent celles de sa feuille de style ([elementary/stylesheet](https://github.com/elementary/stylesheet), GPL-3.0, valeurs de couleur seulement) et l'interface suit ses conventions de barre d'en-tête.
- **Inter**, de Rasmus Andersson ([rsms/inter](https://github.com/rsms/inter), SIL Open Font License), police d'interface d'elementary. Cassette l'utilise si elle est installée et ne l'embarque pas.
- **Font Awesome Free** ([fontawesome.com](https://fontawesome.com/license/free), icônes sous CC BY 4.0) pour les icônes du menu de la zone de notification, héritées de Sidra.
- **Last.fm** et son [API](https://www.last.fm/api) pour le scrobbling.
- Bibliothèques : [@holusion/dbus-next](https://github.com/Holusion/node-dbus-next) (MIT) pour D-Bus, [electron-conf](https://github.com/alex8088/electron-conf) (MIT) pour les réglages, [electron-log](https://github.com/megahertz/electron-log) (MIT) pour le journal, [electron-builder](https://github.com/electron-userland/electron-builder) (MIT) pour le paquet, [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0) et [Vitest](https://github.com/vitest-dev/vitest) (MIT). Leurs dépendances livrées dans le paquet (MIT, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0) sont énumérées dans [`packaging/copyright`](packaging/copyright).

## Licence

Cassette garde la licence de Sidra, la [Blue Oak Model License 1.0.0](LICENSE). Copyright Martin Wimpress pour Sidra, melvincouwez-alt pour les modifications de Cassette. Le paquet installe ce texte et le détail des licences dans `/usr/share/doc/cassette/`.
