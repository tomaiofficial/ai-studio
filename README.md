# IA DÉRAPE 🔥

**L'actu IA sans filtre** — Claude, ChatGPT, Grok… et surtout leurs ratés.

Un site d'actualité 100 % IA qui met en avant les dérapages, pannes et polémiques du secteur.

🌐 **En ligne** : https://tomaiofficial.github.io/ai-studio/

## ✨ Fonctionnalités

- 📰 Fil d'actu en cartes, triées par date
- 🔥 Rubriques : Dérapages · Claude · ChatGPT · Sécurité · Régulation
- ⚡ Bandeau défilant avec les dernières news
- 🏆 Top 4 des pires dérapages
- 🔍 Recherche plein-texte
- 📖 Lecteur d'article (modal) avec lien source
- 🌗 Thème sombre / clair
- 📱 Responsive mobile

## 🛠️ Structure

```
index.html    → structure + modal article
style.css     → design (sombre, rouge/cyan)
app.js        → filtres, recherche, modal
news.json     → ⭐ TOUTES LES ACTUS (à éditer à la main)
_backup-techhelp/ → ancien site TechHelp (sauvegarde)
```

## ✍️ Ajouter une actu

Ouvre `news.json` et copie ce bloc :

```json
{
  "id": "n11",
  "date": "2026-09-12",
  "cat": "derape",
  "hot": true,
  "source": "Nom du média",
  "title": "Titre de l'actu",
  "excerpt": "Résumé court affiché sur la carte.",
  "body": "Texte complet.\n\nNouveau paragraphe après une ligne vide.",
  "url": "https://lien-vers-la-source.com"
}
```

**Catégories** : `derape`, `claude`, `chatgpt`, `securite`, `regulation`

## 🗂️ Sauvegarde

L'ancien site **TechHelp** est conservé dans `_backup-techhelp/`. Pour le restaurer,
il suffit de recopier ses fichiers à la racine.
