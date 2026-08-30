# Procédures de réponse aux incidents — Système Hospitalier du Mali

Ce document définit ce qu'un administrateur doit faire, dans l'ordre, face à différents types
d'incidents de sécurité. L'objectif : ne jamais avoir à réfléchir "par où commencer" en plein
incident — suivre la liste.

---

## 1. Compte compromis (mot de passe volé, comportement suspect signalé)

**Signal typique** : un utilisateur signale ne pas reconnaître une connexion, ou l'aperçu sécurité
montre une activité inhabituelle sur un compte précis.

1. **Révoquer immédiatement toutes les sessions de ce compte**
   Super Admin ou Hospital Admin → trouver l'utilisateur → "Sessions" → "Déconnecter tous les
   appareils". Ceci déconnecte la personne (légitime ou non) sur tous les appareils actifs en
   quelques instants, sans attendre.

2. **Désactiver le compte**
   Panneau Personnel → "Désactiver" sur ce compte. Ceci bloque toute nouvelle connexion
   immédiatement, y compris sur un appareil déjà approuvé.

3. **Vérifier l'appareil enregistré**
   Si un appareil inconnu a été approuvé récemment sur ce compte, le révoquer aussi (Sessions →
   Appareil → Révoquer), pour empêcher une reconnexion même après réinitialisation du mot de passe.

4. **Enquêter avant de tout effacer**
   Aperçu sécurité (Super Admin) → filtrer les événements par date autour du moment suspect →
   noter : quand la connexion suspecte a eu lieu, depuis quel appareil, quelles actions ont suivi
   (consultations, modifications de dossiers, exports). Copier ces informations dans un document
   séparé avant de continuer — les journaux restent disponibles, mais avoir un résumé au moment de
   l'incident facilite toute investigation ultérieure.

5. **Préserver les preuves**
   Ne pas supprimer manuellement les entrées `securityEvents` ou `sessions` liées à l'incident,
   même après l'avoir résolu. Elles constituent l'historique de ce qui s'est passé.

6. **Restaurer l'accès en toute sécurité**
   Une fois l'enquête terminée : réinitialiser le mot de passe du compte (ne jamais le communiquer
   par un canal non sécurisé — utiliser le lien de réinitialisation Firebase), réactiver le compte,
   et exiger que la personne configure une nouvelle 2FA si son rôle en dispose. Informer la
   personne concernée de ce qui s'est passé.

---

## 2. Perte ou vol d'un appareil (ordinateur, téléphone)

1. **Révoquer l'appareil immédiatement** — Sessions → Appareil de cette personne → Révoquer.
   Ceci empêche toute nouvelle connexion depuis cet appareil, même si le mot de passe reste valide.
2. **Révoquer aussi toutes les sessions actives** sur cet appareil, au cas où une session serait
   encore ouverte.
3. La personne peut se connecter normalement depuis un nouvel appareil — celui-ci déclenchera une
   nouvelle demande d'approbation (comportement normal, pas une erreur).
4. Si l'appareil contenait des informations sensibles affichées à l'écran au moment de la perte
   (dossier patient ouvert, etc.), traiter comme un incident de confidentialité potentiel — voir
   section 4.

---

## 3. Activité suspecte détectée par l'aperçu sécurité (alertes automatiques)

Quand la bannière "Activité inhabituelle détectée" apparaît (échecs de connexion en nombre anormal,
plusieurs comptes bloqués simultanément, volume d'événements anormal) :

1. **Ne pas paniquer, mais ne pas ignorer non plus** — ces seuils sont volontairement prudents, un
   pic peut avoir une explication normale (ex: toute l'équipe se reconnecte après une panne
   réseau).
2. Ouvrir le journal "Événements récents" et filtrer par la date concernée.
3. Identifier s'il s'agit d'un seul compte visé (probable tentative ciblée) ou de plusieurs comptes
   (probable attaque automatisée plus large, ou coïncidence bénigne).
4. Si un seul compte est visé de manière répétée : suivre la procédure de la section 1
   préventivement, même si le compte ne montre pas encore de signe de compromission réussie.
5. Si le pic est confirmé bénin (ex: panne réseau résolue), noter l'explication quelque part pour
   référence future — cela aide à calibrer les seuils d'alerte au fil du temps.

---

## 4. Incident de confidentialité (données patient potentiellement exposées)

1. **Déterminer l'étendue** : combien de dossiers, quelle période, quel canal (accès non autorisé
   via un compte compromis, appareil perdu affichant des données à l'écran, export accidentel).
2. **Contenir** : suivre la section 1 ou 2 selon la cause.
3. **Documenter** : quels dossiers patients étaient potentiellement visibles, à quel moment, par qui.
4. **Évaluer l'obligation de notification** : selon la réglementation malienne applicable à la
   protection des données de santé, une notification aux patients concernés et/ou aux autorités
   compétentes peut être requise. Ceci dépasse le cadre technique — consulter un responsable
   juridique/conformité de l'établissement avant toute communication externe.

---

## 5. Panne ou perte de données (suppression accidentelle, corruption)

1. **Arrêter immédiatement toute action supplémentaire** sur les données concernées pour éviter
   d'aggraver la situation.
2. **Vérifier la dernière sauvegarde disponible** — Super Admin → Aperçu sécurité → historique des
   sauvegardes dans le bucket Cloud Storage configuré (voir `functions/lib/backup.js` pour les
   détails de configuration).
3. **Restaurer depuis la sauvegarde** via la Console Google Cloud (Firestore → Import/Export →
   sélectionner l'export le plus récent avant l'incident) — cette étape nécessite un accès
   administrateur Google Cloud, pas seulement Super Admin de l'application.
4. **Évaluer la perte de données entre la sauvegarde et l'incident** — toute donnée créée après la
   dernière sauvegarde et avant l'incident sera perdue lors d'une restauration. Documenter cette
   fenêtre de perte potentielle.
5. Envisager d'augmenter la fréquence des sauvegardes si la fenêtre de perte constatée est jugée
   trop importante.

---

## Contacts et responsabilités

*(à compléter selon l'organisation réelle)*

| Rôle | Nom | Contact |
|---|---|---|
| Responsable technique / Super Admin principal | | |
| Responsable conformité / juridique | | |
| Contact Google Cloud / Firebase (support ou revendeur) | | |

## Après tout incident

Que l'incident se soit avéré réel ou bénin, prendre 15 minutes pour noter : ce qui s'est passé,
comment il a été détecté, ce qui a fonctionné dans la réponse, ce qui pourrait être amélioré. Ce
projet a déjà traversé plusieurs incidents techniques réels durant son développement (voir
l'historique de développement) — la même discipline de documentation s'applique aux incidents de
sécurité en production.