# URKIMeVote – Université Révérend Kim

**URKIMeVote** est le prototype du site de vote pour les élections étudiantes de Lingwala et N’djili :
CP, CPA et secrétaire de chaque promotion, président et vice-président de l’université.

Le circuit de travail : **VS Code → GitHub → Render → Neon**.

| Outil | Rôle |
|---|---|
| **VS Code** | Tu lis, modifies et testes le code sur ton PC. |
| **GitHub** | Garde toutes les versions du code. |
| **Render** | Fait tourner le serveur et donne l’adresse publique du site. |
| **Neon** | Héberge la base de données PostgreSQL (étudiants, codes, votes). |

---

## 1. Installer les outils (une seule fois)

1. **Git** : télécharge-le sur <https://git-scm.com/downloads>, installe-le en gardant les choix proposés.
2. **Node.js** : sur <https://nodejs.org>, prends la version marquée **LTS**, installe-la en gardant les choix proposés.
3. **Ferme puis rouvre VS Code** pour qu’il trouve Git et Node.js.
4. Vérifie dans le terminal de VS Code (menu **Terminal → Nouveau terminal**) :

   ```
   node --version
   git --version
   ```

   Chaque commande doit afficher un numéro de version (Node.js 22.12 ou plus récent).

---

## 2. Lancer le site sur ton PC

1. Décompresse le fichier `vote-etudiant-prototype.zip`.
2. Dans VS Code : **Fichier → Ouvrir le dossier…** et choisis le dossier `vote-etudiant-prototype`.
3. Ouvre un terminal (**Terminal → Nouveau terminal**) et installe les bibliothèques :

   ```
   npm install
   ```

4. Crée le fichier des réglages : dans l’explorateur de VS Code (à gauche), clic droit sur
   `.env.exemple` → **Copier**, puis clic droit dans le vide → **Coller**, et renomme la copie
   en `.env` (exactement, avec le point au début).
5. Remplis `.env` en suivant les explications qu’il contient :
   - `DATABASE_URL` : l’adresse **pooled** de Neon (bouton **Connect** dans Neon) ;
   - `CODE_SECRET` : une longue clé au hasard. Pour en fabriquer une :

     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

   - `DONNEES_DEMO=oui` et un `DEMO_MOT_DE_PASSE` de ton choix.
6. Lance le serveur :

   ```
   npm run dev
   ```

   Ouvre <http://localhost:3000> dans ton navigateur. Au premier démarrage, le site crée
   tout seul les tables dans Neon et ajoute les données de démonstration.

   `npm run dev` redémarre le serveur à chaque fois que tu enregistres un fichier.
   Pour l’arrêter : **Ctrl + C** dans le terminal.

### Comptes de démonstration

| Identifiant | Rôle | Adresse |
|---|---|---|
| `superviseur` | Candidats, ouverture des votes, dévoilement | <http://localhost:3000/admin/> |
| `distributeur` | Remise des codes | <http://localhost:3000/admin/> |
| `observateur` | Consulte tout, ne modifie rien | <http://localhost:3000/admin/> |

Le mot de passe des trois comptes est celui que tu as mis dans `DEMO_MOT_DE_PASSE`.

---

## 3. Scénario de démonstration (pour la présentation)

Ouvre trois fenêtres : une pour le **distributeur**, une pour le **superviseur**, et un
**téléphone** pour l’étudiant. Une fenêtre de navigation privée permet d’être connecté
à deux comptes en même temps.

1. **Distributeur** → onglet *Inscription et codes* → choisis Lingwala, Sciences informatiques, L2.
   Tape un nom (ex. « Matondo », postnom « Lusala », prénom « Jonas ») → *Inscrire et remettre le code*.
   L’étudiant apparaît dans la liste de sa promotion, et son code s’affiche
   **une seule fois** : note-le. Le bouton *Imprimer la liste* donne une liste d’émargement.
2. **Superviseur** → onglet *Votes* → même promotion → sur le CP, durée **3** minutes →
   *Ouvrir le vote*.
3. **Visiteur** (sur le vidéoprojecteur) → *Résultats* → clique sur le CP en cours :
   la page attend le dévoilement en montrant la participation en direct.
4. **Téléphone** → page d’accueil → tape le code → vote pour le CP. Essaie de revoter :
   c’est refusé. Essaie un faux code : refusé aussi.
5. À la fin du décompte, le vote se ferme tout seul. **Superviseur** → *Dévoiler les résultats* :
   la page projetée lance l’animation.
6. **Observateur** → onglet *Journal* : toutes les actions sont tracées, sans aucun code.

Cas particuliers déjà prêts dans la démonstration :
- **L3 Génie logiciel (Lingwala), secrétaire** : un seul candidat → *Déclarer élu(e) d’office* ;
- **L1 Santé publique (N’djili), CPA** : aucun candidat → poste vacant ;
- **Présidence** : une séance par site ; choisis avant le vote le mode de dévoilement.

Pour **repartir propre avant la présentation** : **superviseur** → onglet *Nettoyage* →
*Tout remettre comme au départ* (retape ton mot de passe et écris `EFFACER`). Voir la section 10.

---

## 4. Envoyer le code sur GitHub (depuis VS Code)

1. Dans la barre de gauche de VS Code, clique sur l’icône **Contrôle de code source**
   (les trois ronds reliés).
2. Clique sur **Publier sur GitHub**, accepte la connexion à ton compte, choisis
   **dépôt public** (pour que ton doyen puisse voir le code) ou privé.
3. VS Code envoie le code. Le fichier `.env` ne part **pas** : c’est voulu, il contient tes secrets.

Ensuite, après chaque modification :
1. Onglet **Contrôle de code source** → écris un court message (ex. « Ajout de la faculté de droit ») ;
2. **Valider** (Commit), puis **Synchroniser les modifications** (Push).

Render met alors le site en ligne à jour tout seul.

---

## 5. Mettre le site en ligne sur Render

1. Sur <https://dashboard.render.com> : **New → Web Service**, puis choisis ton dépôt `vote-etudiant-prototype`.
2. Réglages :
   - **Region** : *Frankfurt (EU Central)* (la même région que ta base Neon) ;
   - **Build Command** : `npm install` ;
   - **Start Command** : `npm start` ;
   - **Instance Type** : *Free* pour la démonstration.
3. Dans **Environment Variables**, ajoute :

   | Nom | Valeur |
   |---|---|
   | `DATABASE_URL` | la même adresse Neon que dans ton `.env` |
   | `CODE_SECRET` | **la même clé** que dans ton `.env` |
   | `NODE_ENV` | `production` |
   | `DONNEES_DEMO` | `oui` |
   | `DEMO_MOT_DE_PASSE` | le même mot de passe que dans ton `.env` |

4. **Create Web Service**. Après quelques minutes, Render affiche l’adresse du site,
   du genre `https://urkim-evote.onrender.com`.

Le service gratuit **s’endort après 15 minutes sans visite** et met environ une minute à se
réveiller. Ouvre le site quelques minutes avant de le montrer. Pour le vrai scrutin, prends
une offre payante (pas de mise en veille) ou un serveur de l’université.

Ton PC et Render utilisent la même base Neon : un code généré sur l’un marche sur l’autre,
à condition que `CODE_SECRET` soit identique des deux côtés.

---

## 6. Les tests automatiques

Les tests vérifient chaque règle du vote : faux code, double vote, mauvaise promotion,
vote fermé, résultats cachés, rôles, remplacement de code, égalité, second tour, journal…

Ils utilisent une **base à part**, entièrement vidée à chaque lancement :

1. Dans Neon : **Databases → New database**, nomme-la `tests`.
2. Copie son adresse (bouton **Connect**, en choisissant la base `tests`) dans `.env`,
   à la ligne `TEST_DATABASE_URL=`. **Jamais** l’adresse de ta vraie base.
3. Lance :

   ```
   npm test
   ```

   Chaque ligne `ok` est une règle vérifiée. À la fin : `# fail 0`.

Lance les tests après chaque modification importante : si tu as cassé une règle sans le
vouloir, ils te le diront.

---

## 7. Comment le projet est organisé

```
vote-etudiant-prototype/
├── serveur.js                 Point de départ : lance le serveur
├── src/
│   ├── configuration.js       Lecture des réglages (.env)
│   ├── application.js         Assemblage : sécurité, pages, routes
│   ├── base/
│   │   ├── schema.sql         Les tables et les règles de la base
│   │   ├── installation.js    Création des tables et des scrutins au démarrage
│   │   ├── connexion.js       Connexion à PostgreSQL
│   │   └── demo.js            Les données de démonstration
│   ├── services/              La logique du vote (sans rien de web)
│   │   ├── vote.js            Enregistrement d’un vote et ses 5 vérifications
│   │   ├── codes.js           Fabrication et vérification des codes
│   │   ├── distribution.js    Remise et remplacement des codes, statistiques
│   │   ├── corrections.js     Corrections de la liste (nom, code, retrait, promotion)
│   │   ├── scrutins.js        Séances, dévoilement, second tour, candidats
│   │   ├── resultats.js       Calcul des élus et des égalités
│   │   ├── direct.js          Le direct (décompte et participation en temps réel)
│   │   ├── sessions.js        Connexions des étudiants et des officiels
│   │   ├── limiteur.js        Blocage des essais ratés à répétition
│   │   ├── journal.js         Journal des actions des officiels
│   │   ├── nettoyage.js       Nettoyage du superviseur (votes, codes, sessions…)
│   │   └── erreurs.js         Les erreurs expliquées à l’utilisateur
│   └── routes/                Les adresses de l’API (/api/…)
│       ├── public.js          Ouvertes à tous
│       ├── etudiant.js        Espace étudiant
│       ├── admin.js           Connexion des officiels, statistiques, journal
│       ├── admin-codes.js     Distributeurs (et corrections de la liste)
│       ├── admin-scrutins.js  Superviseur
│       └── admin-nettoyage.js Nettoyage (superviseur)
├── public/                    Les pages du site (HTML, CSS, JavaScript)
│   ├── index.html             Accueil
│   ├── candidats.html         Candidats
│   ├── voter.html             Espace de vote de l’étudiant
│   ├── resultats.html         Résultats et animation du dévoilement
│   ├── regles.html, apropos.html
│   ├── admin/                 Espace officiels
│   ├── css/style.css          L’apparence de tout le site
│   ├── images/                L’écusson de l’université et l’icône du site
│   ├── polices/               La police des titres (Poppins)
│   └── js/                    Le JavaScript de chaque page
├── scripts/creer-admin.js     Création d’un compte officiel
└── tests/                     Les tests automatiques
```

La règle de séparation : **`services/` décide, `routes/` reçoit les demandes, `public/` affiche**.
Pour changer une règle du vote, regarde d’abord dans `services/`.

---

## 8. Modifications courantes

**Changer un texte d’une page** : modifie le fichier `.html` correspondant dans `public/`.

**Changer les couleurs** : en haut de `public/css/style.css`, les variables `--encre`, `--accent`…

**Créer un vrai compte officiel** (après avoir rempli `.env`) :

```
npm run creer-admin -- jean.kabeya "Jean Kabeya" distributeur
```

Le mot de passe est demandé au clavier. Rôles possibles : `superviseur`, `distributeur`, `observateur`.

**Ajouter une faculté, une promotion ou des étudiants** : dans Neon, **SQL Editor**, par exemple :

```sql
insert into faculte (sigle, nom) values ('ECO', 'Sciences économiques')
on conflict (sigle) do nothing;   -- ne fait rien si elle existe déjà

insert into promotion (campus_id, faculte_id, niveau, filiere)
select c.id, f.id, 'L2', '' from campus c, faculte f
where c.sigle = 'LIN' and f.sigle = 'ECO';

insert into etudiant (promotion_id, matricule, nom, postnom, prenom) values
  (12, '2026-LIN-1001', 'Kabeya', 'Mukendi', 'Jean');
```

(remplace `12` par le numéro de la promotion). Redémarre ensuite le serveur : les scrutins
CP, CPA et secrétaire de la nouvelle promotion sont créés tout seuls.

---

## 9. La remise des codes

> **Méthode provisoire.** Cette façon de remettre les codes sert à la démonstration.
> Elle sera améliorée après les essais : par exemple partir de la liste officielle de
> chaque promotion (fournie par l’appariteur) et vérifier la carte d’étudiant avant la remise.

- Le distributeur choisit le site, la faculté et la promotion, puis tape le **nom** de l’étudiant
  (postnom ou prénom obligatoire, matricule facultatif). L’étudiant est ajouté à la **liste de sa
  promotion** et reçoit son code, affiché une seule fois.
- Si un nom identique existe déjà dans la promotion, le site prévient : soit c’est la même personne
  (utiliser *Remplacer (perdu)*), soit c’est un homonyme (confirmer).
- La liste se filtre par nom et s’imprime (liste d’émargement avec une colonne *Signature*).
  **Les codes n’apparaissent jamais sur la liste** : une liste avec les codes donnerait le droit
  de vote de toute la promotion à celui qui la trouve.
- **Corriger la liste** (bouton *Corriger…* sur chaque ligne) : le **distributeur** et le **superviseur** peuvent
  - corriger le nom, le postnom, le prénom ou le matricule (faute de frappe) ;
  - changer l’étudiant de promotion (son ancien code est supprimé, le distributeur lui en remet un nouveau) ;
  - annuler son code (il ne marche plus tout de suite ; ses votes déjà faits restent comptés) ;
  - le retirer de la liste s’il a été inscrit par erreur.

  On ne peut ni retirer ni changer de promotion un étudiant **qui a déjà voté**. Chaque correction
  demande un motif (sauf la faute de frappe) et est notée au journal. Le superviseur corrige,
  mais il ne crée **jamais** de code : c’est le distributeur qui les remet.
- L’observateur consulte les listes, sans pouvoir les modifier.
- En démonstration, la plupart des étudiants fictifs ont déjà reçu leur code ; les deux derniers
  de chaque promotion pas encore. Les candidats fictifs ont un portrait dessiné (dossier
  `src/base/photos-demo`) ; un vrai candidat reçoit sa vraie photo depuis l’onglet *Votes*.

---

## 10. Le nettoyage (superviseur)

Onglet *Nettoyage*, réservé au superviseur, pour remettre le site en ordre après des essais :

| Nettoyage | Ce qu’il fait |
|---|---|
| Effacer les votes d’un scrutin | Le scrutin revient « en préparation » ; ses candidats sont gardés. |
| Effacer tous les votes | Tous les scrutins reviennent « en préparation » ; les seconds tours d’essai sont supprimés. |
| Annuler les codes remis | D’une promotion ou de toutes. Les étudiants restent dans la liste mais doivent recevoir un nouveau code. Un étudiant qui avait déjà voté ne peut pas revoter avec le nouveau code. |
| Déconnecter tout le monde | Ferme toutes les sessions, sauf celle du superviseur. |
| Tout remettre comme au départ | Votes, codes, listes et candidats reviennent à la démonstration. **Seulement si `DONNEES_DEMO=oui`.** |

Les protections :
- il faut **retaper son mot de passe** et écrire le mot **`EFFACER`** ;
- **impossible pendant qu’un vote est ouvert** ;
- **le journal n’est jamais effacé** : chaque nettoyage y est noté (qui, quand, combien).

En dernier recours (base abîmée), on peut encore tout effacer depuis Neon : **SQL Editor** →
`drop schema public cascade; create schema public;`, puis redémarrer le serveur.

---

## 11. L’identité visuelle (nom, logo, couleurs)

- **Le nom** s’écrit `URKIMeVote` : le « e » toujours en minuscule.
- **Le logo** est écrit directement dans l’en-tête de chaque page (`<span class="logo-mot">`) :
  les lettres sont du texte, et le V est un petit dessin (une coche qui sort d’un téléphone).
  Son apparence se règle dans `public/css/style.css`, section « Le logo URKIMeVote ».
  Le « e », le téléphone et le V restent toujours en or. Sur un fond clair, ajoute la classe
  `sur-clair` : les lettres deviennent foncées.
- **L’icône de l’onglet** est `public/favicon.svg` ; celle des téléphones, `public/images/icone-180.png`.
- **Le logo en image**, pour tes diapositives et tes documents : `public/images/logo-urkimevote-fond-fonce.png`
  (lettres blanches, à poser sur un fond bleu) et `logo-urkimevote-fond-clair.png` (lettres bleues, pour
  un fond blanc). Leur fond est transparent.
- **Les couleurs** sont des variables, tout en haut de `public/css/style.css` : le bleu et le blanc
  dominent, le noir sert aux boutons principaux, et l’or (`--or`) est réservé au logo, à l’Espace
  officiels et aux **votes ouverts** (leur carte est encadrée d’or). Change une valeur, tout le site suit.
- **Le mode clair et le mode sombre** : le bloc `[data-theme="sombre"]` du même fichier donne les
  couleurs du mode sombre. Le petit fichier `public/js/theme.js` choisit le mode : celui du téléphone
  par défaut, ou celui choisi avec le bouton ◐ (retenu par le navigateur).
- **Le menu** : sur ordinateur, les liens sont dans la barre du haut ; sur téléphone et tablette,
  ils sont dans le menu « trois barres » (géré aussi par `public/js/theme.js`).
- **L’écusson de l’université** est dans `public/images/` (deux tailles). Il est affiché dans le bandeau
  de l’accueil (dans la barre du haut sur téléphone), en bas des pages et sur la connexion des officiels. Pour le vrai scrutin, demande à
  l’université l’autorisation d’utiliser son écusson.
- **La police des titres** (Poppins) est dans `public/polices/`, avec sa licence libre.

---

## 12. Sécurité : ce qui est déjà en place

- Le code complet n’est **jamais** rangé dans la base : seulement son empreinte (HMAC-SHA-256).
- Les règles du vote sont vérifiées par le **serveur**, et les plus importantes par la **base** elle-même.
- **Secret du vote** : la participation et les voix sont dans deux tables sans lien, sans heure.
- Les mots de passe des officiels sont protégés avec **Argon2**.
- Les essais ratés à répétition sont bloqués (codes et mots de passe).
- Le journal des officiels ne peut être **ni modifié ni effacé**.
- Politique de sécurité du contenu (CSP) : aucun script venu d’ailleurs ne peut s’exécuter.

### Avant un vrai scrutin

1. Une **base Neon neuve**, avec `DONNEES_DEMO=non` et sans `DEMO_MOT_DE_PASSE`.
2. Préparer les listes : soit importer les inscrits fournis par l’université, soit inscrire chaque étudiant au moment où il vient chercher son code.
3. Créer les **vrais comptes** officiels avec `npm run creer-admin`, avec des mots de passe solides.
4. Un **nouveau** `CODE_SECRET`, gardé secret.
5. Un hébergement **sans mise en veille** (offre payante ou serveur de l’université).
6. Une **répétition complète** avec de faux codes et de faux candidats.
7. Faire valider les règles par l’administration et la commission.

---

## 13. En cas de problème

| Message | Solution |
|---|---|
| `La variable DATABASE_URL est manquante` | Le fichier `.env` n’existe pas, ou n’est pas nommé exactement `.env`. |
| `CODE_SECRET doit contenir au moins 32 caractères` | Fabrique une clé avec la commande de la section 2. |
| `'npm' n'est pas reconnu…` | Node.js n’est pas installé, ou VS Code n’a pas été redémarré. |
| `password authentication failed` | L’adresse Neon est mal copiée : recopie-la depuis le bouton **Connect**. |
| `Code inconnu ou plus valide` alors que le code est bon | `CODE_SECRET` est différent entre ton PC et Render. |
| Le site en ligne met une minute à répondre | Normal avec l’offre gratuite de Render : il se réveillait. |
