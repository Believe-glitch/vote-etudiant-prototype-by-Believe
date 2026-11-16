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

  // Le journal des actions, avec des filtres :
  //   recherche : un mot (nom d'étudiant, matricule, motif, action…) ;
  //   action    : un type d'action précis (ex. "vote_ouvert") ;
  //   officiel  : le numéro d'un compte, ou "auto" pour les actions du serveur ;
  //   campus    : un site (via le site de la séance, de la promotion ou du scrutin) ;
  //   du, au    : une période (dates et heures).
  // On renvoie au plus 500 lignes, les plus récentes d'abord, et le total trouvé.
  app.get('/journal', {
    preHandler: app.exigerRole('superviseur', 'observateur'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          recherche: { type: 'string', maxLength: 80 },
          action: { type: 'string', maxLength: 60 },
          officiel: { type: 'string', pattern: '^([0-9]+|auto)$' },
          campus: { type: 'integer', minimum: 1 },
          du: { type: 'string', format: 'date-time' },
          au: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (requete) => {
    const { recherche, action, officiel, campus, du, au } = requete.query;
    const texte = (recherche ?? '').trim();
    const motif = `%${texte.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

    const conditions = [sql`true`];
    if (texte) {
      conditions.push(sql`(j.action ilike ${motif} or j.details::text ilike ${motif} or a.nom_complet ilike ${motif})`);
    }
    if (action) conditions.push(sql`j.action = ${action}`);
    if (officiel === 'auto') conditions.push(sql`j.admin_id is null`);
    else if (officiel) conditions.push(sql`j.admin_id = ${Number(officiel)}`);
    if (campus) {
      conditions.push(sql`(
        j.details->>'campusId' = ${String(campus)}
        or ps.campus_id = ${campus}
        or pp.campus_id = ${campus}
      )`);
    }
    if (du) conditions.push(sql`j.le >= ${du}`);
    if (au) conditions.push(sql`j.le <= ${au}`);
    const ou = conditions.reduce((tout, c) => sql`${tout} and ${c}`);

    // Le site d'une action se retrouve par le scrutin ou la promotion notés dans ses détails.
    const jointures = sql`
      from journal j
      left join compte_admin a on a.id = j.admin_id
      left join scrutin s on s.id = case when j.details->>'scrutinId' ~ '^[0-9]+$' then (j.details->>'scrutinId')::int end
      left join promotion ps on ps.id = s.promotion_id
      left join promotion pp on pp.id = case when j.details->>'promotionId' ~ '^[0-9]+$' then (j.details->>'promotionId')::int end`;

    const [{ total }] = await sql`select count(*)::int as total ${jointures} where ${ou}`;
    const lignes = await sql`
      select j.id, j.action, j.details, j.le, a.nom_complet as officiel
      ${jointures}
      where ${ou}
      order by j.id desc
      limit 500`;
    return {
      total,
      lignes: lignes.map((l) => ({
        id: Number(l.id),
        action: l.action,
        details: l.details,
        le: l.le,
        officiel: l.officiel ?? 'Le serveur (automatique)',
      })),
    };
  });

  // La liste des comptes d'officiels (pour le filtre du journal).
  app.get('/officiels', { preHandler: app.exigerRole('superviseur', 'observateur') }, async () =>
    sql`select id, nom_complet as "nomComplet", role from compte_admin order by nom_complet`);
}
