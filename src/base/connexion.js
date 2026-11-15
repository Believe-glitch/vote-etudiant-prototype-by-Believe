// Connexion à la base PostgreSQL avec la bibliothèque postgres.js.
//
// On écrit les requêtes comme ceci :   sql`select * from campus where id = ${id}`
// Les valeurs entre ${ } ne sont JAMAIS collées dans le texte SQL : postgres.js
// les envoie à part. C'est ce qui protège contre les "injections SQL", même si
// quelqu'un tape du code SQL dans un formulaire.

import postgres from 'postgres';

export function connecterBase(adresse) {
  const url = new URL(adresse);

  // Neon ajoute "channel_binding=require" à l'adresse. postgres.js ne connaît
  // pas ce réglage et l'enverrait tel quel au serveur, qui le refuserait.
  // On le retire : la connexion reste chiffrée grâce à sslmode=require.
  url.searchParams.delete('channel_binding');

  // L'adresse "pooled" de Neon passe par un répartiteur de connexions
  // (PgBouncer). Avec lui, il vaut mieux ne pas préparer les requêtes à l'avance.
  const viaRepartiteur = url.hostname.includes('-pooler');

  return postgres(url.toString(), {
    max: 10,                    // au plus 10 connexions ouvertes en même temps
    idle_timeout: 30,           // on ferme une connexion inutilisée après 30 s
    connect_timeout: 30,        // Neon peut mettre quelques secondes à se réveiller
    prepare: !viaRepartiteur,
    // Les messages "NOTICE" de PostgreSQL (ex. "la table existe déjà") ne nous intéressent pas.
    onnotice: () => {},
    transform: { undefined: null },
  });
}
