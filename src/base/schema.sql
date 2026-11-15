-- =====================================================================
-- Tables de la base de données du vote étudiant
--
-- Ce fichier est lu à chaque démarrage du serveur. Grâce aux
-- "if not exists", il ne recrée rien de ce qui existe déjà : on peut
-- donc relancer le serveur sans perdre de données.
--
-- Beaucoup de règles du vote sont écrites ICI, dans la base elle-même.
-- Même si le code du serveur avait une erreur, la base refuserait
-- par exemple un deuxième vote du même code pour le même poste.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. L'université : sites, facultés, promotions
-- ---------------------------------------------------------------------

-- Les sites : Lingwala (LIN) et N'djili (NDJI).
create table if not exists campus (
  id     serial primary key,
  sigle  text not null unique check (sigle ~ '^[A-Z]{2,5}$'),
  nom    text not null
);

-- Les facultés, avec un sigle de 3 lettres utilisé dans les codes (INF, MED…).
create table if not exists faculte (
  id     serial primary key,
  sigle  text not null unique check (sigle ~ '^[A-Z]{3}$'),
  nom    text not null
);

-- Une promotion = une classe : un niveau (L1, B2, M1…) dans une faculté,
-- sur un site, et parfois dans une filière (ex. Génie logiciel).
-- La filière vaut '' (texte vide) quand il n'y en a pas.
create table if not exists promotion (
  id          serial primary key,
  campus_id   int  not null references campus(id),
  faculte_id  int  not null references faculte(id),
  niveau      text not null check (niveau ~ '^[A-Z][0-9]$'),
  filiere     text not null default '',
  unique (campus_id, faculte_id, niveau, filiere)
);

-- La liste officielle des inscrits, fournie par l'université.
create table if not exists etudiant (
  id            serial primary key,
  promotion_id  int  not null references promotion(id),
  matricule     text not null unique,
  nom           text not null,
  postnom       text not null default '',
  prenom        text not null default ''
);
create index if not exists etudiant_par_promotion on etudiant (promotion_id);


-- ---------------------------------------------------------------------
-- 2. Les comptes des officiels
-- ---------------------------------------------------------------------

-- Trois rôles, jamais mélangés :
--   superviseur  : candidats, ouverture des votes, dévoilement des résultats
--   distributeur : création et remise des codes
--   observateur  : consulte tout, ne modifie rien (commission, témoins)
create table if not exists compte_admin (
  id                  serial primary key,
  identifiant         text not null unique,
  nom_complet         text not null,
  mot_de_passe_hache  text not null,          -- jamais le mot de passe en clair
  role                text not null check (role in ('superviseur', 'distributeur', 'observateur')),
  actif               boolean not null default true
);


-- ---------------------------------------------------------------------
-- 3. Les codes de vote
-- ---------------------------------------------------------------------

-- Le code complet (ex. L2INF-LIN-K7M2QX) n'est JAMAIS rangé ici.
-- On ne garde que son "empreinte" : une version brouillée qu'on ne peut
-- pas transformer en code. Le code n'apparaît en clair qu'une fois,
-- à l'écran du distributeur, au moment de la remise.
create table if not exists code_vote (
  id                serial primary key,
  etudiant_id       int  not null references etudiant(id),
  prefixe           text not null,                 -- ex. L2INF-LIN (pas secret)
  empreinte         text not null unique,          -- deux codes ne peuvent pas être identiques
  statut            text not null default 'actif' check (statut in ('actif', 'annule')),
  motif_annulation  text,
  cree_par          int  not null references compte_admin(id),
  cree_le           timestamptz not null default now(),
  annule_le         timestamptz
);
-- Un étudiant ne peut avoir qu'UN SEUL code actif à la fois.
create unique index if not exists un_seul_code_actif
  on code_vote (etudiant_id) where statut = 'actif';


-- ---------------------------------------------------------------------
-- 4. Les scrutins, les séances et les candidats
-- ---------------------------------------------------------------------

-- Les photos des candidats (déjà compressées par la page admin).
create table if not exists photo (
  id         serial primary key,
  type_mime  text  not null check (type_mime in ('image/jpeg', 'image/png', 'image/webp')),
  donnees    bytea not null,
  cree_le    timestamptz not null default now()
);

-- Un scrutin = l'élection d'un poste, pour un tour.
--   CP, CPA, SECRETAIRE : liés à une promotion.
--   PRESIDENCE          : toute l'université (pas de promotion).
-- Un second tour est un nouveau scrutin, lié au précédent par parent_id.
-- premiere_place et nombre_places disent quelles places ce tour attribue :
--   présidence, 1er tour : places 1 et 2 (président et vice-président) ;
--   second tour pour la vice-présidence seulement : place 2 uniquement.
create table if not exists scrutin (
  id                serial primary key,
  poste             text not null check (poste in ('CP', 'CPA', 'SECRETAIRE', 'PRESIDENCE')),
  promotion_id      int  references promotion(id),
  tour              int  not null default 1 check (tour >= 1),
  parent_id         int  references scrutin(id),
  premiere_place    int  not null default 1 check (premiere_place between 1 and 2),
  nombre_places     int  not null default 1 check (nombre_places between 1 and 2),
  statut            text not null default 'preparation'
                    check (statut in ('preparation', 'en_cours', 'termine', 'devoile')),
  -- Présidence : dévoiler le total seulement, ou chaque site à la fin de sa séance.
  mode_devoilement  text not null default 'total' check (mode_devoilement in ('total', 'par_site')),
  elu_d_office      boolean not null default false,   -- candidat unique
  devoile_le        timestamptz,
  check ((poste = 'PRESIDENCE') = (promotion_id is null)),
  unique nulls not distinct (poste, promotion_id, tour)
);

-- Une séance = le moment où un site vote pour un scrutin.
-- Un scrutin de promotion a une séance (le site de la promotion).
-- La présidence a une séance par site : Lingwala et N'djili votent
-- séparément, puis on additionne.
create table if not exists seance (
  id          serial primary key,
  scrutin_id  int  not null references scrutin(id),
  campus_id   int  not null references campus(id),
  statut      text not null default 'attente' check (statut in ('attente', 'ouverte', 'fermee')),
  debut       timestamptz,
  fin         timestamptz,          -- heure de fin selon l'horloge du serveur
  devoilee    boolean not null default false,
  unique (scrutin_id, campus_id)
);

create table if not exists candidat (
  id          serial primary key,
  scrutin_id  int  not null references scrutin(id),
  nom         text not null,
  slogan      text not null default '',
  photo_id    int  references photo(id),
  unique (scrutin_id, id)
);


-- ---------------------------------------------------------------------
-- 5. Le vote : deux tables SANS AUCUN LIEN entre elles
-- ---------------------------------------------------------------------

-- a) QUI a voté. Pas d'heure, pas de numéro d'ordre.
--    La clé primaire (code + scrutin) interdit un deuxième vote :
--    la base refuse la ligne, quoi que fasse le serveur.
create table if not exists participation (
  code_id     int not null references code_vote(id),
  scrutin_id  int not null references scrutin(id),
  primary key (code_id, scrutin_id)
);

-- b) POUR QUI. Aucun bulletin individuel : un simple compteur par
--    candidat et par site. Impossible de relier une voix à un code.
create table if not exists voix (
  scrutin_id   int not null,
  candidat_id  int not null,
  campus_id    int not null references campus(id),
  nombre       int not null default 0 check (nombre >= 0),
  primary key (scrutin_id, candidat_id, campus_id),
  -- le candidat doit appartenir à CE scrutin
  foreign key (scrutin_id, candidat_id) references candidat (scrutin_id, id)
);


-- ---------------------------------------------------------------------
-- 6. Les connexions en cours (étudiants et officiels)
-- ---------------------------------------------------------------------

-- Le navigateur garde un jeton dans un cookie ; ici on ne garde que
-- l'empreinte du jeton, pour qu'un vol de la base ne permette pas de
-- se faire passer pour quelqu'un.
create table if not exists session (
  jeton_empreinte  text primary key,
  type             text not null check (type in ('etudiant', 'admin')),
  reference_id     int  not null,      -- id du code (étudiant) ou du compte (admin)
  expire_le        timestamptz not null
);
create index if not exists session_par_expiration on session (expire_le);


-- ---------------------------------------------------------------------
-- 7. Le journal des actions des officiels
-- ---------------------------------------------------------------------

-- On y ajoute des lignes, on ne peut ni les modifier ni les effacer.
-- Les votes n'y sont JAMAIS notés (ça trahirait le secret du vote).
create table if not exists journal (
  id        bigserial primary key,
  admin_id  int references compte_admin(id),
  action    text  not null,
  details   jsonb not null default '{}',
  le        timestamptz not null default now()
);

create or replace function journal_interdire_modification() returns trigger
language plpgsql as $$
begin
  raise exception 'Le journal ne peut être ni modifié ni effacé.';
end
$$;

create or replace trigger journal_sans_modification
  before update or delete on journal
  for each row execute function journal_interdire_modification();

create or replace trigger journal_sans_vidage
  before truncate on journal
  for each statement execute function journal_interdire_modification();
