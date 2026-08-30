# Gestion des secrets — Système Hospitalier du Mali

## L'état actuel du projet

Une vérification du code montre qu'**aucun secret sensible n'est actuellement codé en dur** dans le
frontend ou le dépôt de code : pas de clé Stripe, pas de clé d'API tierce, pas de mot de passe de
service.

**Une clarification importante sur la clé Firebase visible dans `src/firebase.js`** : cette clé
(`apiKey`) n'est PAS un secret au sens classique. Les clés d'API Firebase sont conçues pour être
publiques dans le code frontend — c'est documenté explicitement par Google. La sécurité réelle de
Firebase repose entièrement sur les règles Firestore (`firestore.rules`) et sur les vérifications
côté serveur dans les Cloud Functions, pas sur le secret de cette clé. Il n'y a donc rien à corriger
ici.

## Ce qui va vraiment devenir un secret à protéger

Au fur et à mesure que ce projet évolue, certaines valeurs futures seront de VRAIS secrets à ne
jamais mettre dans le code frontend ni dans le dépôt Git :

- La clé secrète reCAPTCHA (différente de la clé de site publique déjà utilisée dans App Check)
- Toute clé d'API d'un service tiers payant (SMS, email transactionnel, paiement)
- Toute clé de chiffrement personnalisée
- Les identifiants de connexion à un service externe (base de données, stockage cloud tiers)

## Comment stocker un vrai secret correctement

**Ne jamais faire** : coder une clé secrète directement dans un fichier `.js` du dossier
`functions/` ou `src/`, même "temporairement pour tester" — ces fichiers finissent presque toujours
par être commités dans Git.

**À faire à la place** — Firebase Functions dispose d'un gestionnaire de secrets intégré, séparé du
code source :

```powershell
firebase functions:secrets:set NOM_DU_SECRET
```

Cette commande demande la valeur de manière interactive (elle n'apparaît jamais dans l'historique du
terminal ni dans un fichier). Le secret est alors stocké dans Google Secret Manager, chiffré, et
accessible uniquement aux Cloud Functions qui le déclarent explicitement :

```javascript
const { defineSecret } = require("firebase-functions/params");
const monSecret = defineSecret("NOM_DU_SECRET");

exports.maFonction = onCall({ secrets: [monSecret] }, async (request) => {
  const valeur = monSecret.value();
  // ...
});
```

Seule cette fonction précise (et les personnes ayant le rôle IAM approprié dans Google Cloud
Console) peut lire cette valeur — jamais le frontend, jamais un autre développeur consultant le
code source.

## Liste de vérification avant chaque déploiement

- [ ] Aucune clé, mot de passe ou jeton n'apparaît en clair dans un fichier `.js` ajouté ou modifié
- [ ] Tout nouveau secret passe par `firebase functions:secrets:set`, jamais par une variable codée en dur
- [ ] Le fichier `.gitignore` du projet exclut bien `node_modules`, les fichiers `.env`, et tout fichier de configuration local contenant des identifiants
- [ ] Si un secret a été accidentellement commité dans Git (même une seule fois), il doit être considéré comme compromis et **régénéré immédiatement** — le simple fait de le supprimer d'un commit ultérieur ne suffit pas, il reste dans l'historique Git

## Qui a accès à quoi, aujourd'hui

- **Clé Firebase (`apiKey`)** : publique par conception, visible dans le code frontend — normal et sans risque
- **Compte de service des Cloud Functions** : géré automatiquement par Google, jamais exposé dans le code
- **Accès à Firebase Console / Google Cloud Console** : actuellement limité aux personnes disposant des identifiants Google du projet — c'est le point de contrôle d'accès le plus important à surveiller. Toute personne ayant accès à la Console peut, en théorie, modifier les règles de sécurité, voir les journaux, ou même supprimer des données. Limitez cet accès au strict nécessaire et utilisez l'authentification à deux facteurs sur le compte Google associé au projet lui-même (distinct de la 2FA applicative déjà mise en place pour les comptes Super Admin/Hospital Admin).