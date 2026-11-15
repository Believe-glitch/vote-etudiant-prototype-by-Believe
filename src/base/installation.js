// Préparation de la base au démarrage du serveur :
//   1. créer les tables qui manquent (schema.sql) ;
//   2. remplir une base vide avec la démonstration (si DONNEES_DEMO=oui) ;
//   3. créer les scrutins et les séances de chaque promotion ;
//   4. créer les comptes admin de démonstration (si DEMO_MOT_DE_PASSE est défini).
//
// Tout est prévu pour pouvoir être relancé sans rien casser ni dupliquer.

import { readFile } from 'node:fs/promises';
import argon2 from 'argon2';
import { remplirStructureDemo, ajouterCandidatsDemo } from './demo.js';

export async function preparerBase(sql, config) {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  // "unsafe" permet d'exécuter un fichier SQL complet. Ce n'est pas dangereux
  // ici : le texte vient de notre propre fichier, jamais d'un utilisateur.
  await sql.unsafe(schema);

  if (config.donneesDemo) {
    const [{ nombre }] = await sql`select count(*)::int as nombre from campus`;
    if (nombre === 0) await remplirStructureDemo(sql);
  }

  await creerScrutinsManquants(sql);

  if (config.donneesDemo) await ajouterCandidatsDemo(sql);
  if (config.motDePasseDemo) await creerComptesDemo(sql, config.motDePasseDemo);
}

// Chaque promotion a trois scrutins (CP, CPA, secrétaire) et l'université
// a un scrutin de présidence. Si on ajoute une promotion plus tard, ses
// scrutins seront créés au prochain démarrage.
export async function creerScrutinsManquants(sql) {
  await sql.begin(async (tx) => {
    await tx`
      insert into scrutin (poste, promotion_id)
      select poste, pr.id
      from promotion pr
      cross join (values ('CP'), ('CPA'), ('SECRETAIRE')) as postes(poste)
      on conflict do nothing`;

    // La présidence attribue deux places : président (1er) et vice-président (2e).
    await tx`
      insert into scrutin (poste, promotion_id, nombre_places)
      values ('PRESIDENCE', null, 2)
      on conflict do nothing`;

    // Une séance pour le site de la promotion…
    await tx`
      insert into seance (scrutin_id, campus_id)
      select s.id, pr.campus_id
      from scrutin s
      join promotion pr on pr.id = s.promotion_id
      on conflict do nothing`;

    // … et une séance par site pour la présidence (seulement pour les
    // tours qui n'ont pas encore commencé).
    await tx`
      insert into seance (scrutin_id, campus_id)
      select s.id, c.id
      from scrutin s
      cross join campus c
      where s.poste = 'PRESIDENCE' and s.statut = 'preparation'
      on conflict do nothing`;
  });
}

async function creerComptesDemo(sql, motDePasse) {
  const [{ nombre }] = await sql`select count(*)::int as nombre from compte_admin`;
  if (nombre > 0) return; // on ne touche jamais à des comptes existants

  const empreinte = await argon2.hash(motDePasse, { type: argon2.argon2id });
  await sql`
    insert into compte_admin (identifiant, nom_complet, mot_de_passe_hache, role) values
      ('superviseur',  'Superviseur (démonstration)',  ${empreinte}, 'superviseur'),
      ('distributeur', 'Distributeur (démonstration)', ${empreinte}, 'distributeur'),
      ('observateur',  'Observateur (démonstration)',  ${empreinte}, 'observateur')`;
}
