# Cassette

Cassette est un client Apple Music pour elementary OS. Il affiche `music.apple.com` dans une fenêtre qui suit le style d'elementary : barre d'en-tête framboise, police Inter, palette claire et sombre du système. Cassette fait partie de l'ensemble Boomerang, qui la propose dans son onglet « Services Apple ».

Cassette part de [Sidra](https://github.com/wimpysworld/sidra) 1.1.2, de Martin Wimpress. Le code propre à macOS et Windows, Discord, Last.fm, la navigation à la manette, les thèmes de Sidra, Nix et la mise à jour par GitHub ont été retirés. Cassette ne suit plus Sidra.

## Ce que fait Cassette

- Lecture d'Apple Music et d'Apple Music Classical, avec le Widevine de CastLabs Electron pour les titres protégés.
- Barre d'en-tête elementary avec retour, avance, lecture en cours et réglages. La barre de lecture flottante d'Apple est masquée.
- Panneau latéral de Cassette, ouvert depuis la barre d'en-tête : paroles synchronisées qui suivent le morceau, file d'attente (un clic lance le morceau choisi) et recherche dans Apple Music (un morceau se lance, un album, un artiste ou une playlist s'ouvre dans la fenêtre).
- Mini-lecteur : le bouton à côté des réglages réduit la fenêtre à sa barre d'en-tête (pochette, morceau, position, commandes de lecture). Le même bouton rend la fenêtre complète.
- Commandes multimédia du système par MPRIS (`org.mpris.MediaPlayer2.cassette`) : touches du clavier, indicateur son du panneau, raccourcis du lanceur (lecture/pause, suivant, précédent, arrêt).
- Une notification par morceau, avec la pochette et des boutons lecture/pause, précédent et suivant. Le son des notifications est coupé au premier lancement ; le réglage se trouve dans Paramètres système > Notifications.
- Liens `itms://` ouverts dans Cassette.
- Molette sur le réglage de volume, zoom, page de démarrage au choix, fermeture dans la zone de notification.

## Installer

Cassette est livrée en paquet `.deb`. Boomerang peut l'installer depuis son onglet « Services Apple ». Pour construire le paquet soi-même :

```bash
npm install
npx tsc
npx electron-builder --linux deb --publish never
sudo apt install ./release/cassette_*_amd64.deb
```

Les réglages et la session Apple Music sont rangés dans `~/.config/Cassette/`, les pochettes en cache dans `~/.cache/cassette/`.

## Développer

```bash
npm install
just run            # compile puis lance
just test           # tests Vitest
just lint           # vérification TypeScript de l'appli et des tests
```

`CASSETTE_DEVTOOLS=1` ouvre les outils de développement. Pour vérifier un rendu sans afficher de fenêtre : `CASSETTE_DEV_PROBE=/chemin/capture.png npx electron . --no-sandbox` capture la page dans un PNG ; `CASSETTE_DEV_DARK=1` force le thème sombre. Les notes techniques sont dans [`AGENTS.md`](AGENTS.md).

## Crédits

- **Sidra**, de Martin Wimpress ([wimpysworld/sidra](https://github.com/wimpysworld/sidra)), licence Blue Oak Model License 1.0.0. Cassette est un fork de la version 1.1.2, avec le travail de Martin Wimpress et de tous les contributeurs de Sidra (voir [leur historique](https://github.com/wimpysworld/sidra/graphs/contributors)) : l'intégration MPRIS, les notifications, le pont avec MusicKit et la plus grande partie du code viennent de Sidra.
- **CastLabs Electron** ([castlabs/electron-releases](https://github.com/castlabs/electron-releases)), licence MIT, qui intègre Widevine à Electron. Le module Widevine lui-même appartient à Google : il n'est pas dans le paquet, CastLabs Electron le télécharge depuis les serveurs de Google au premier lancement.
- **Electron** ([electron/electron](https://github.com/electron/electron), MIT, OpenJS Foundation) et **Chromium** (BSD-3-Clause et autres licences, liste complète dans `/opt/Cassette/LICENSES.chromium.html` une fois le paquet installé), sur lesquels CastLabs Electron est construit.
- **Apple Music** et **MusicKit JS** d'Apple, chargés depuis `music.apple.com`. Apple, Apple Music, Apple Music Classical, iTunes et le logo Apple sont des marques d'Apple Inc., déposées aux États-Unis et dans d'autres pays. Cassette n'est ni affiliée à Apple ni approuvée par Apple.
- **elementary OS** ([elementary.io](https://elementary.io)) : les couleurs de la palette reprennent celles de sa feuille de style ([elementary/stylesheet](https://github.com/elementary/stylesheet), GPL-3.0, valeurs de couleur seulement) et l'interface suit ses conventions de barre d'en-tête.
- **Inter**, de Rasmus Andersson ([rsms/inter](https://github.com/rsms/inter), SIL Open Font License), police d'interface d'elementary. Cassette l'utilise si elle est installée et ne l'embarque pas.
- **Font Awesome Free** ([fontawesome.com](https://fontawesome.com/license/free), icônes sous CC BY 4.0) pour les icônes du menu de la zone de notification, héritées de Sidra.
- Bibliothèques : [@holusion/dbus-next](https://github.com/Holusion/node-dbus-next) (MIT) pour D-Bus, [electron-conf](https://github.com/alex8088/electron-conf) (MIT) pour les réglages, [electron-log](https://github.com/megahertz/electron-log) (MIT) pour le journal, [electron-builder](https://github.com/electron-userland/electron-builder) (MIT) pour le paquet, [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0) et [Vitest](https://github.com/vitest-dev/vitest) (MIT). Leurs dépendances livrées dans le paquet (MIT, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0) sont énumérées dans [`packaging/copyright`](packaging/copyright).

## Licence

Cassette garde la licence de Sidra, la [Blue Oak Model License 1.0.0](LICENSE). Copyright Martin Wimpress pour Sidra, melvincouwez-alt pour les modifications de Cassette. Le paquet installe ce texte et le détail des licences dans `/usr/share/doc/cassette/`.
