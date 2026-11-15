// Routes communes de l'espace officiels : connexion, déconnexion,
// statistiques des codes et journal des actions.

import argon2 from 'argon2';
import { ErreurMetier } from '../services/erreurs.js';
import { ouvrirSession, fermerSession, lireSession, optionsCookie, COOKIE_ADMIN } from '../services/sessions.js';
import { patienter } from '../services/limiteur.js';
import { statistiquesCodes } from '../services/distribution.js';
import { noterAuJournal } from '../services/journal.js';

// Empreinte d'un mot de passe bidon : quand l'identifiant n'existe pas, on
// vérifie quand même un mot de passe, pour que la réponse prenne le même
// temps. Sinon, on pourrait deviner quels identifiants existent.
const EMPREINTE_BIDON = await argon2.hash('mot-de-passe-qui-ne-sert-a-rien', { type: argon2.argon2id });

export async function routesAdmin(app) {
  const { sql, config } = app;

  app.post('/connexion', {
    schema: {
      body: {
        type: 'object',
        required: ['identifiant', 'motDePasse'],
        properties: {
          identifiant: { type: 'string', minLength: 1, maxLength: 60 },
          motDePasse: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (requete, reponse) => {
    const identifiant = requete.body.identifiant.trim().toLowerCase();
    const cleLimiteur = `admin:${requete.ip}`;
    if (app.limiteurAdmins.estBloque(cleLimiteur)) {
      throw new ErreurMetier('Trop d’essais ratés. Réessayez dans 15 minutes.', 429);
    }

    const [compte] = await sql`
      select id, mot_de_passe_hache from compte_admin where identifiant = ${identifiant} and actif`;
    const motDePasseCorrect = await argon2.verify(
      compte ? compte.mot_de_passe_hache : EMPREINTE_BIDON,
      requete.body.motDePasse
    );

    if (!compte || !motDePasseCorrect) {
      app.limiteurAdmins.noterEchec(cleLimiteur);
      await patienter(400);
      throw new ErreurMetier('Identifiant ou mot de passe incorrect.', 401);
    }

    const { jeton, dureeSecondes } = await ouvrirSession(sql, 'admin', compte.id);
    reponse.setCookie(COOKIE_ADMIN, jeton, optionsCookie(config, dureeSecondes));
    await noterAuJournal(sql, compte.id, 'connexion_officiel');
    return { connecte: true };
  });

  app.post('/deconnexion', async (requete, reponse) => {
    await fermerSession(sql, requete.cookies[COOKIE_ADMIN]);
    reponse.clearCookie(COOKIE_ADMIN, { path: '/' });
    return { deconnecte: true };
  });

  // Simple question « suis-je connecté ? », sans erreur si la réponse est non.
  app.get('/session', async (requete) => {
    const adminId = await lireSession(sql, 'admin', requete.cookies[COOKIE_ADMIN]);
    return { connecte: adminId !== null };
  });

  app.get('/moi', { preHandler: app.exigerRole() }, async (requete) => ({
    identifiant: requete.admin.identifiant,
    nomComplet: requete.admin.nom_complet,
    role: requete.admin.role,
  }));

  // Combien de codes ont été remis, par promotion, faculté, site, et au total.
  app.get('/statistiques', { preHandler: app.exigerRole() }, async () => statistiquesCodes(sql));

  // Les 300 dernières actions des officiels.
  app.get('/journal', { preHandler: app.exigerRole('superviseur', 'observateur') }, async () => {
    const lignes = await sql`
      select j.id, j.action, j.details, j.le, a.nom_complet as officiel
      from journal j left join compte_admin a on a.id = j.admin_id
      order by j.id desc
      limit 300`;
    return lignes.map((l) => ({
      id: Number(l.id),
      action: l.action,
      details: l.details,
      le: l.le,
      officiel: l.officiel ?? 'Le serveur (automatique)',
    }));
  });
}
