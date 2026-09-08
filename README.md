# Astra Clim Pro 2.0

Application de gestion terrain pour une entreprise de climatisation. Elle fonctionne immédiatement sur un téléphone, une tablette ou un ordinateur, y compris sans connexion : les données sont stockées dans le navigateur puis peuvent être synchronisées avec l’espace équipe.

## Fonctions livrées

- Tableau de bord et planning hebdomadaire.
- Clients, parc des installations et historique d’intervention.
- Bouton **Waze** sur chaque client et intervention : ouvre l’itinéraire vers l’adresse enregistrée, dans Waze sur mobile lorsqu’il est installé.
- Interventions avec technicien, compte rendu, mesures, photos optimisées et signature à l’écran.
- Rapport d’intervention imprimable ; dans la boîte d’impression choisir **Enregistrer au format PDF**.
- Devis et factures à lignes, numérotation, statut et impression/PDF.
- Stock avec seuils d’alerte.
- Sauvegarde JSON exportable/importable (photos et signatures comprises).
- PWA installable et utilisable hors connexion après la première ouverture.
- Espace équipe : comptes protégés par mot de passe, base SQLite, authentification signée et synchronisation du parc partagé.

## Lancer localement

Prérequis : **Node.js 24 ou plus récent**. Aucun `npm install` n’est nécessaire.

1. Ouvrir un terminal dans ce dossier.
2. Définir une clé longue et aléatoire, puis démarrer :

   ```powershell
   $env:ASTRA_TOKEN_SECRET = "remplacez-par-une-cle-secrete-longue-et-aleatoire"
   node server.mjs
   ```

3. Ouvrir `http://localhost:8787`.
4. À la première utilisation, choisir soit **Sur cet appareil**, soit **Espace équipe**. La création de l’espace équipe crée le premier compte administrateur.

`start.cmd` lance aussi l’application, mais une clé `ASTRA_TOKEN_SECRET` forte est impérative avant toute publication.

Les données serveur sont créées automatiquement dans `data/astra-clim.sqlite`. Ce dossier est volontairement exclu de Git : sauvegardez-le dans votre stratégie de backup serveur.

## Installer comme application

Ouvrir l’URL via Chrome ou Edge, puis utiliser l’option **Installer l’application** du navigateur. Une première visite connectée est nécessaire afin que le navigateur mette les fichiers en cache ; les saisies restent ensuite possibles hors connexion.

## Déploiement équipe / cloud

Déployez l’intégralité de ce dossier sur un serveur Node.js 24+ qui possède un volume persistant pour `data/`, configurez au minimum :

```text
PORT=8787
ASTRA_TOKEN_SECRET=<valeur-aleatoire-longue-et-secrete>
```

Placez-le derrière HTTPS (Nginx, Caddy, Cloudflare Tunnel, etc.) et ouvrez l’URL HTTPS dans l’application, onglet **Espace équipe**. Les appareils partagent alors le même espace et le même instantané métier. Le mécanisme détecte une révision distante inattendue au lieu d’écraser silencieusement les données locales.

## Cadre de production important

Cette livraison est une application opérationnelle autonome, mais avant une utilisation commerciale à grande échelle il faut aussi organiser l’exploitation :

- HTTPS, clé de jeton secrète, sauvegardes chiffrées du volume `data/` et mises à jour du serveur.
- Hébergement conforme à vos obligations (RGPD, durée de conservation, accès et sous-traitance).
- Les photos sont incluses dans l’instantané synchronisé : la limite est actuellement de 14 Mo par synchronisation. Pour un très grand volume, remplacer ce stockage par un vrai stockage objet (S3/Blob) est l’évolution recommandée.
- Les notifications incluses sont des rappels locaux lorsque l’application est ouverte. Les alertes push lorsque l’application est fermée nécessitent un service de push et ses clés propres.
- Les comptes sont réellement gérés par le serveur ; l’écran « techniciens » sert au planning. L’administration détaillée des rôles et une comptabilité/calendrier externe restent à choisir selon vos outils (Sage, Pennylane, Google/Microsoft Calendar, etc.).

## Vérifications réalisées

- Vérification de syntaxe du serveur et de l’application.
- Parcours API vérifié : création d’espace, authentification, lecture et écriture d’un instantané SQLite.
- Vérification navigateur : création d’un espace local, enregistrement d’un client, rendu desktop et mobile, sans erreur console.
