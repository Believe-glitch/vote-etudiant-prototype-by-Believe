// Les sessions : comment le site se souvient qu'un étudiant (ou un officiel)
// est connecté, d'une page à l'autre.
//
// À la connexion, on tire au hasard un "jeton" très long, qu'on donne au
// navigateur dans un cookie. Dans la base, on ne garde que l'empreinte du
// jeton : même avec une copie de la base, on ne peut pas se connecter.

import { randomBytes, createHash } from 'node:crypto';

export const COOKIE_ETUDIANT = 'session_etudiant';
export const COOKIE_ADMIN = 'session_admin';

const DUREE_MINUTES = { etudiant: 120, admin: 8 * 60 };

function empreinteJeton(jeton) {
  return createHash('sha256').update(jeton).digest('hex');
}

export async function ouvrirSession(sql, type, referenceId) {
  const jeton = randomBytes(32).toString('base64url');
  await sql`
    insert into session (jeton_empreinte, type, reference_id, expire_le)
    values (${empreinteJeton(jeton)}, ${type}, ${referenceId},
            now() + make_interval(mins => ${DUREE_MINUTES[type]}))`;
  return { jeton, dureeSecondes: DUREE_MINUTES[type] * 60 };
}

// Renvoie l'id du code (étudiant) ou du compte (admin), ou null.
export async function lireSession(sql, type, jeton) {
  if (!jeton || typeof jeton !== 'string' || jeton.length > 100) return null;
  const [session] = await sql`
    select reference_id from session
    where jeton_empreinte = ${empreinteJeton(jeton)}
      and type = ${type}
      and expire_le > now()`;
  return session ? session.reference_id : null;
}

export async function fermerSession(sql, jeton) {
  if (!jeton || typeof jeton !== 'string') return;
  await sql`delete from session where jeton_empreinte = ${empreinteJeton(jeton)}`;
}

export async function supprimerSessionsExpirees(sql) {
  await sql`delete from session where expire_le <= now()`;
}

// Réglages du cookie :
//   httpOnly : le JavaScript de la page ne peut pas le lire (protège contre le vol) ;
//   sameSite strict : un autre site ne peut pas envoyer de demande en ton nom ;
//   secure : en production, le cookie ne circule qu'en HTTPS.
export function optionsCookie(config, dureeSecondes) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.enProduction,
    path: '/',
    maxAge: dureeSecondes,
  };
}
