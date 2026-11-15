// Routes des distributeurs : retrouver un étudiant dans la liste officielle,
// lui remettre son code, ou remplacer un code perdu.

import { rechercherEtudiants, genererCode, remplacerCode } from '../services/distribution.js';

const schemaEtudiant = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 1 } },
  },
};

export async function routesAdminCodes(app) {
  const { sql, config } = app;
  const distributeur = app.exigerRole('distributeur');

  app.get('/etudiants', {
    preHandler: distributeur,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          recherche: { type: 'string', maxLength: 80 },
          promotion: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (requete) => rechercherEtudiants(sql, {
    recherche: requete.query.recherche,
    promotionId: requete.query.promotion,
  }));

  // La réponse contient le code EN CLAIR : c'est la seule fois qu'il apparaît.
  app.post('/etudiants/:id/code', { preHandler: distributeur, schema: schemaEtudiant }, async (requete) => {
    const code = await genererCode(sql, requete.admin.id, requete.params.id, config.cleSecreteCodes);
    return { code };
  });

  app.post('/etudiants/:id/remplacer-code', {
    preHandler: distributeur,
    schema: {
      ...schemaEtudiant,
      body: {
        type: 'object',
        required: ['motif'],
        properties: { motif: { type: 'string', maxLength: 200 } },
      },
    },
  }, async (requete) => {
    const code = await remplacerCode(
      sql, requete.admin.id, requete.params.id, requete.body.motif, config.cleSecreteCodes
    );
    return { code };
  });
}
