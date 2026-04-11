# Wayfinding Bâtiment — PWA

Ce dossier contient votre application *Navigation intérieure* prête à être installée comme **PWA** (Progressive Web App).

## ✅ Ce que j’ai ajouté sans toucher à votre logique
- `manifest.webmanifest` (nom, icônes, couleurs, démarrage plein écran)
- `service-worker.js` (cache des fichiers pour **usage hors-ligne**)
- Liens PWA dans `index.html` (balises `<meta>` et enregistrement du SW)
- Icônes d’application (`assets/icons/`)
- Un fichier `data/plan_graph.json` **vierge** (pour permettre le offline)
- Un `assets/plan.png` **factice** à remplacer par votre plan réel

> Votre code existant (`css/style.css` et `js/app.js`) est inchangé.

---

## 🧪 Tester en local (sans store)
1. Ouvrez un terminal dans ce dossier.
2. Lancez un petit serveur local :
   - Avec Python : `python -m http.server 8080`
3. Ouvrez http://localhost:8080 dans votre navigateur.

### Installer sur téléphone
> L’installation d’une PWA exige **HTTPS** (ou `localhost`). Pour un test rapide sur téléphone, publiez avec GitHub Pages.

- **Android (Chrome/Edge)** : ouvrez l’URL → bannière *Installer* ou menu `⋮` → *Ajouter à l’écran d’accueil*.
- **iOS (Safari)** : bouton *Partager* → *Ajouter à l’écran d’accueil*.

---

## 🚀 Publication gratuite (HTTPS) — GitHub Pages
1. Créez un dépôt GitHub (par ex. `wayfinding`).
2. Glissez tout le contenu de ce dossier à la racine du dépôt.
3. `Settings` → `Pages` → `Source: Deploy from a branch` → Branch: `main` → Folder: `/root` → `Save`.
4. Attendez ~1 minute. L’app est disponible sur `https://<votre-pseudo>.github.io/wayfinding/`.

---

## 🔧 Conseils d’exploitation
- **Mise à jour**: quand vous modifiez des fichiers, incrémentez `CACHE_NAME` dans `service-worker.js` (ex: `v1` → `v2`), puis republiez.
- **Données**: remplacez `data/plan_graph.json` par votre fichier exporté depuis l’app (*Exporter JSON*).
- **Plan**: remplacez `assets/plan.png` par votre plan (même nom de fichier).
- **Firefox Desktop**: ne propose pas l’installation PWA, mais permet de tester l’app web.

---

## 📁 Structure
```
/ (racine)
  index.html
  manifest.webmanifest
  service-worker.js
  /css/style.css
  /js/app.js
  /assets/plan.png
  /assets/icons/icon-180.png, icon-192.png, icon-512.png
  /data/plan_graph.json
```

---

## ❓FAQ rapide
- **Hors-ligne ?** Oui : les fichiers principaux sont pré-cachés, et les données JSON sont en *stale-while-revalidate*.
- **iOS ?** Oui via *Ajouter à l’écran d’accueil* (icône et mode plein écran inclus).
- **Stores ?** Pas nécessaire au départ (on pourra emballer en APK/IPA plus tard via Capacitor).
