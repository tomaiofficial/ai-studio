# 🎙️ Assistant Vocal IA

**Ton assistant vocal sur mobile** — parle-lui naturellement comme avec ChatGPT, avec une vraie voix. Rappels, calendrier, météo, localisation, minuteurs, calculs, notes…

🌐 **En ligne** : https://tomaiofficial.github.io/ai-studio/

## ✨ Fonctionnalités

- 🎙️ **Reconnaissance vocale** en français (gratuite, via le navigateur — Chrome Android recommandé)
- 🤖 **Mode IA (ChatGPT)** : discussion libre et naturelle, l'IA comprend le contexte et agit (rappels, calendrier, météo, position…) via des outils automatiques
- 🗣️ **Vraie voix** : synthèse vocale OpenAI (gpt-4o-mini-tts) — voix naturelles au choix (nova, alloy, echo, fable, onyx, shimmer)
- ⏰ **Rappels** avec notifications + voix (« rappelle-moi de X dans 2 heures »)
- 📅 **Calendrier** (« ajoute un événement réunion demain à 10h »)
- 🌤️ **Météo** en temps réel, aujourd'hui et demain (Open-Meteo, sans clé API)
- 📍 **Localisation GPS** avec carte OpenStreetMap + adresse + partage (« où suis-je »)
- ⏱️ **Minuteur** (« minuteur de 5 minutes »)
- 🧮 **Calculs** (« combien font 15 + 27 ») et **conversions** (« convertir 10 km en miles »)
- 📝 **Notes** vocales (« note que je dois acheter du pain »)
- 🎲 **Pile ou face, dé, choix** (« choisis entre A et B »)
- 🔎 **Recherche web** (« cherche X ») et **ouverture de sites** (« ouvre youtube »)
- ⏰ **Alarme / réveil** (« réveille-moi à 7h »)
- 📱 **PWA installable** : fonctionne hors-ligne, ajoutable à l'écran d'accueil
- 🌗 Thème sombre / clair

## 🤖 Mode IA (optionnel, recommandé)

Sans configuration, l'assistant fonctionne en **mode local** (commandes vocales). Pour discuter **librement comme avec ChatGPT** avec une **vraie voix** :

1. Ouvre les **réglages ⚙️** dans l'app
2. Colle ta **clé API OpenAI** (https://platform.openai.com/api-keys) — elle reste **uniquement sur ton appareil**, jamais envoyée sur le site
3. Choisis ta **voix IA** préférée et teste-la 🔊

En mode IA, tu peux dire n'importe quoi : « rappelle-moi de prendre mes médicaments demain à 8h », « quel temps fait-il ce week-end ? », « ajoute un rendez-vous chez le dentiste vendredi à 15h », « raconte-moi une histoire », « quels sont mes rappels ? »… L'IA utilise automatiquement les bons outils.

> 💡 Sans clé API, l'app reste 100 % fonctionnelle en mode local (gratuit, sans compte).

## 🛠️ Structure

```
index.html            → interface mobile
style.css             → design (sombre, cyan/rouge)
app.js                → voix, IA (ChatGPT + TTS), commandes, rappels, calendrier, météo, notes…
manifest.webmanifest  → installation PWA
sw.js                 → service worker (hors-ligne)
icon-192.png / icon-512.png → icônes
_backup-techhelp/     → ancien site TechHelp (sauvegarde)
```

## 🗣️ Exemples de commandes (mode local)

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