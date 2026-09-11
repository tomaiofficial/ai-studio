# 🎙️ Assistant Vocal IA

**Ton assistant vocal sur mobile** — rappels, calendrier, météo, localisation, minuteurs, calculs, notes… Parle, il s'occupe du reste.

🌐 **En ligne** : https://tomaiofficial.github.io/ai-studio/

## ✨ Fonctionnalités

- 🎙️ **Reconnaissance vocale** en français (gratuite, via le navigateur — Chrome Android recommandé)
- ⏰ **Rappels** avec notifications + voix (« rappelle-moi de X dans 2 heures »)
- 📅 **Calendrier** (« ajoute un événement réunion demain à 10h »)
- 🌤️ **Météo** en temps réel, aujourd'hui et demain (Open-Meteo, sans clé API)
- 📍 **Localisation GPS** avec carte OpenStreetMap + partage (« où suis-je »)
- ⏱️ **Minuteur** (« minuteur de 5 minutes »)
- 🧮 **Calculs** (« combien font 15 + 27 ») et **conversions** (« convertir 10 km en miles »)
- 📝 **Notes** vocales (« note que je dois acheter du pain »)
- 🎲 **Pile ou face, dé, choix** (« choisis entre A et B »)
- 🔎 **Recherche web** (« cherche X ») et **ouverture de sites** (« ouvre youtube »)
- ⏰ **Alarme / réveil** (« réveille-moi à 7h »)
- 🗣️ **Voix naturelle** : choix de la voix française dans les réglages + test
- 📱 **PWA installable** : fonctionne hors-ligne, ajoutable à l'écran d'accueil
- 🌗 Thème sombre / clair

## 🛠️ Structure

```
index.html            → interface mobile
style.css             → design (sombre, cyan/rouge)
app.js                → voix, commandes, rappels, calendrier, météo, notes…
manifest.webmanifest  → installation PWA
sw.js                 → service worker (hors-ligne)
icon-192.png / icon-512.png → icônes
_backup-techhelp/     → ancien site TechHelp (sauvegarde)
```

## 🗣️ Exemples de commandes

| Tu dis… | Il fait… |
|---|---|
| « Rappelle-moi d'arroser les plantes dans 2 heures » | ⏰ Rappel + notification |
| « Ajoute un événement réunion demain à 10h » | 📅 Événement au calendrier |
| « Quel temps fait-il ? » / « Demain il fait quel temps ? » | 🌤️ Météo |
| « Où suis-je ? » | 📍 Position + carte |
| « Minuteur de 5 minutes » | ⏱️ Minuteur |
| « Combien font 15 + 27 ? » | 🧮 Calcul |
| « Convertir 10 km en miles » | 🔄 Conversion |
| « Note que je dois acheter du pain » | 📝 Note |
| « Pile ou face » / « Lance un dé » / « Choisis entre A et B » | 🎲 Hasard |
| « Réveille-moi à 7h » | ⏰ Alarme |
| « Cherche recette de crêpes » / « Ouvre youtube » | 🔎 Web |
| « Quelle heure est-il ? » / « Quel jour sommes-nous ? » | 🕐 Heure/date |
| « Aide » | ❓ Liste des commandes |

## 📱 Installer sur ton téléphone

1. Ouvre https://tomaiofficial.github.io/ai-studio/ dans **Chrome** (Android)
2. Menu ⋮ → **« Ajouter à l'écran d'accueil »** (ou « Installer l'application »)
3. Autorise le **micro** et les **notifications** à la première utilisation

> ⚠️ Les notifications ne s'affichent que si l'app est ouverte (ou récemment utilisée). Pour des rappels fiables en arrière-plan, il faudrait un serveur de push (hors scope de cette version).

## 🗂️ Sauvegarde

L'ancien site **TechHelp** est conservé dans `_backup-techhelp/`.