// Routes du nettoyage (réservées au superviseur). Voir services/nettoyage.js.
//
// Pour chaque nettoyage, le superviseur doit :
//   1. retaper son mot de passe (si quelqu'un utilise son ordinateur resté
//      ouvert, il ne peut rien effacer) ;
//   2. écrire le mot EFFACER (pour éviter un clic par erreur).

import argon2 from 'argon2';
import { ErreurMetier } from '../services/erreurs.js';
import { COOKIE_ADMIN } from '../services/sessions.js';
import { patienter } from '../services/limiteur.js';
import { etatNettoyage, nettoyer, ACTIONS_NETTOYAGE } from '../services/nettoyage.js';

export const MOT_DE_CONFIRMATION = 'EFFACER';

export async function routesAdminNettoyage(app) {
  const { sql, config } = app;
  const superviseur = app.exigerRole('superviseur');

  app.get('/nettoyage', { preHandler: superviseur }, async () => etatNettoyage(sql, config));

  app.post('/nettoyage', {
    preHandler: superviseur,
    schema: {
      body: {
        type: 'object',
        required: ['action', 'motDePasse', 'confirmation'],
        properties: {
          action: { type: 'string', enum: ACTIONS_NETTOYAGE },
          scrutinId: { type: 'integer', minimum: 1 },
          promotionId: { type: 'integer', minimum: 1 },
          motDePasse: { type: 'string', minLength: 1, maxLength: 200 },
          confirmation: { type: 'string', maxLength: 20 },
        },
      },
    },
  }, async (requete) => {
    const { action, scrutinId, promotionId, motDePasse, confirmation } = requete.body;

    if (confirmation.trim() !== MOT_DE_CONFIRMATION) {
      throw new ErreurMetier(`Écrivez le mot ${MOT_DE_CONFIRMATION} pour confirmer.`);
    }

    // Le mot de passe : mêmes protections que la connexion (blocage après
    // 10 essais ratés en 15 minutes).
    const cleLimiteur = `admin:${requete.ip}`;
    if (app.limiteurAdmins.estBloque(cleLimiteur)) {
      throw new ErreurMetier('Trop d’essais ratés. Réessayez dans 15 minutes.', 429);
    }
    const [compte] = await sql`select mot_de_passe_hache from compte_admin where id = ${requete.admin.id}`;
    if (!(await argon2.verify(compte.mot_de_passe_hache, motDePasse))) {
      app.limiteurAdmins.noterEchec(cleLimiteur);
      await patienter(400);
      throw new ErreurMetier('Mot de passe incorrect.', 403);
    }

    const resume = await nettoyer(sql, config, {
      adminId: requete.admin.id,
      jetonSession: requete.cookies[COOKIE_ADMIN],
      action,
      scrutinId,
      promotionId,
    });
    app.direct.signalerChangement();   // les pages ouvertes se mettent à jour
    return { fait: true, resume };
  });
}
