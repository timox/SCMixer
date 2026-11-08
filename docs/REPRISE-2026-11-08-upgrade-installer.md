# Reprise — mise à niveau de l’installeur SCMixer

## Demande en cours

L’utilisateur veut un installeur propre qui **mette à niveau SCMixer déjà installé**, sans demander une désinstallation manuelle. Le setup `0.1.1` refuse le dossier d’installation existant. Ne pas présenter la désinstallation manuelle comme la solution finale.

## État vérifié

- Dépôt : `C:\Users\timo\Documents\GitHub\SCMixer`, branche `fix/scsynth-sans-audio`.
- Dernier commit : `e20c512 fix(desktop): read current TimoxVasio routes`, poussé sur `origin`.
- L’installation Windows enregistrée est SCMixer `0.0.2`, dans `C:\Program Files\SCMixer`.
- `installer/config/config.xml` cible lui aussi `@ApplicationsDirX64@/SCMixer`.
- L’installeur local `installer/dist/SCMixer-0.1.1-Setup.exe` existe (145 203 050 octets).
- `installer/build-installer.ps1` termine actuellement avec `binarycreator --offline-only`.
- L’installation de la 0.1.1 n’a pas été confirmée. L’interaction UI du précédent tour a été bloquée par le contrôle automatique (« Computer Use was not approved to use 1-setup »). L’utilisateur a ensuite signalé le refus de dossier.
- Le seul élément non suivi observé dans le dépôt était `build_sc_catalogue/`, un build local à conserver hors commit.

## Diagnostic à conserver

Le conflit de cible est confirmé : l’ancienne installation est toujours enregistrée dans le dossier où le nouvel installeur veut s’installer. Qt Installer Framework identifie ce dossier comme une installation existante. La cause la plus probable est que le nouveau setup est lancé comme une nouvelle installation au même `TargetDir`, au lieu de mettre à jour l’installation enregistrée.

Le setup actuel est construit `--offline-only`. La documentation officielle IFW indique qu’un installeur hors ligne standard installe un outil de maintenance qui permet la désinstallation ; les mises à jour par Maintenance Tool nécessitent un installeur `--hybrid` et des dépôts configurés. Références :

- https://doc.qt.io/qtinstallerframework/ifw-offline-installers.html
- https://doc.qt.io/qtinstallerframework/ifw-use-cases-cli.html
- https://doc.qt.io/qtinstallerframework/noninteractive.html (inclut `TargetDirectoryInUse`)

## Travail précédent pertinent

- Le client SCMixer lit maintenant `configuredRoutes` et les endpoints `virtual:TimoxVasio:app:scsynth.exe:...`, même lorsque le moteur SCMixer est arrêté.
- Le chemin d’hôte vérifié sur la machine est `C:\Program Files\TimoxVasio\resources\backend\TimoxVirtualAsioEngine.exe` ; le défaut SCMixer et les documents ont été corrigés.
- La cible native Release a compilé pendant la génération de l’installeur.
- Ces corrections sont dans les commits poussés `2cbe1da` et `e20c512`.

## Prochaine étape

Étudier le mécanisme IFW qui permet réellement au setup livré de reconnaître et mettre à niveau cette installation existante. Distinguer :

1. la voie native de mise à jour via Maintenance Tool et un dépôt hybride ;
2. la transition depuis l’installation `0.0.2`, créée en mode hors ligne ;
3. la préservation des données de session sous `%LOCALAPPDATA%\SCMixer`.

Puis implémenter la voie la plus simple qui évite à l’utilisateur une désinstallation manuelle, reconstruire un installeur local et faire valider par l’utilisateur. Ne pas supprimer l’ancienne installation ou ses données à l’aveugle.

## Contraintes de travail

- L’utilisateur ne veut pas de suites de tests opaques ou disproportionnées. Ne pas lancer les suites de tests sans demande ; une compilation de production est acceptable.
- Ne pas toucher au moteur audio physique pour ce travail.
- Ne pas automatiser à nouveau la fenêtre `1-setup` : l’outil Computer Use a refusé son contrôle. L’utilisateur peut fournir le message exact ou poursuivre manuellement si nécessaire.
- Ne pas confondre « build de l’installeur réussi » avec « mise à niveau installée et vérifiée ».
