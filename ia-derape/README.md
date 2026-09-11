# IA DÉRAPE 🔥

**L'actu IA sans filtre** — Claude, ChatGPT, Grok… et surtout leurs ratés.

Un site d'actualité 100 % IA qui met en avant les dérapages, pannes, promesses non tenues et polémiques du secteur.

## ✨ Fonctionnalités

- 📰 **Fil d'actu** en cartes, triées par date
- 🔥 **Rubriques** : Dérapages · Claude · ChatGPT · Sécurité · Régulation
- ⚡ **Bandeau défilant** avec les dernières news
- 🏆 **Top 4 des pires dérapages**
- 🔍 **Recherche** plein-texte
- 📖 **Lecteur d'article** (modal) avec lien vers la source
- 🌗 **Thème** sombre / clair
- 📱 **Responsive** mobile

## 🛠️ Structure

```
index.html    → structure + modal
style.css     → design (thème sombre, rouge/cyan)
app.js        → logique (filtres, recherche, modal)
news.json     → ⭐ TOUTES LES ACTUS (à éditer à la main)
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

**Catégories disponibles** : `derape`, `claude`, `chatgpt`, `securite`, `regulation`

## 🚀 Déploiement

Site 100 % statique → GitHub Pages direct :

1. Push les fichiers sur la branche `main`
2. Settings → Pages → Source : `main` / `/ (root)`
3. En ligne sur `https://<user>.github.io/<repo>/`

## ⚠️ Note

Le contenu est informatif. Les articles résument des sources externes, toujours citées avec leur lien.
