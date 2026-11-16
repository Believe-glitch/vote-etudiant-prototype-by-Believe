// Routes de la remise des codes :
//   - inscrire un étudiant dans la liste de sa promotion et lui remettre son code ;
//   - consulter (et imprimer) la liste d'une promotion ;
//   - remettre un code à un étudiant déjà dans la liste, ou remplacer un code perdu ;
//   - corriger la liste (distributeur et superviseur) : nom, code, retrait, promotion.

import {
  rechercherEtudiants, genererCode, remplacerCode, listerPromotion, inscrireEtRemettreCode,
} from '../services/distribution.js';
import { corrigerEtudiant, annulerCode, retirerEtudiant, changerPromotion } from '../services/corrections.js';

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
  // Les corrections de la liste : distributeur et superviseur (jamais l'observateur).
  const correcteur = app.exigerRole('distributeur', 'superviseur');
  const corpsMotif = {
    type: 'object',
    required: ['motif'],
    properties: { motif: { type: 'string', maxLength: 200 } },
  };

  // La liste d'une promotion : visible par tous les officiels (les témoins
  // peuvent ainsi vérifier qu'il n'y a pas d'étudiants inventés).
  app.get('/promotions/:id/etudiants', {
    preHandler: app.exigerRole('distributeur', 'superviseur', 'observateur'),
    schema: schemaEtudiant,
  }, async (requete) => listerPromotion(sql, requete.params.id));

  // L'étudiant est devant l'officiel : on l'inscrit et on lui remet son code.
  // La réponse contient le code EN CLAIR : c'est la seule fois qu'il apparaît.
  app.post('/promotions/:id/inscrire', {
    preHandler: distributeur,
    schema: {
      ...schemaEtudiant,
      body: {
        type: 'object',
        required: ['nom'],
        properties: {
          nom: { type: 'string', maxLength: 60 },
          postnom: { type: 'string', maxLength: 60 },
          prenom: { type: 'string', maxLength: 60 },
          matricule: { type: 'string', maxLength: 40 },
          confirmerHomonyme: { type: 'boolean' },
        },
      },
    },
  }, async (requete) => inscrireEtRemettreCode(
    sql, requete.admin.id, requete.params.id, requete.body, config.cleSecreteCodes
  ));

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

  // --- Corrections de la liste -------------------------------------------------

  app.put('/etudiants/:id', {
    preHandler: correcteur,
    schema: {
      ...schemaEtudiant,
      body: {
        type: 'object',
        required: ['nom'],
        properties: {
          nom: { type: 'string', maxLength: 60 },
          postnom: { type: 'string', maxLength: 60 },
          prenom: { type: 'string', maxLength: 60 },
          matricule: { type: 'string', maxLength: 40 },
          confirmerHomonyme: { type: 'boolean' },
        },
      },
    },
  }, async (requete) => corrigerEtudiant(sql, requete.admin.id, requete.params.id, requete.body));

  app.post('/etudiants/:id/annuler-code', { preHandler: correcteur, schema: { ...schemaEtudiant, body: corpsMotif } },
    async (requete) => {
      await annulerCode(sql, requete.admin.id, requete.params.id, requete.body.motif);
      return { fait: true };
    });

  app.post('/etudiants/:id/retirer', { preHandler: correcteur, schema: { ...schemaEtudiant, body: corpsMotif } },
    async (requete) => {
      await retirerEtudiant(sql, requete.admin.id, requete.params.id, requete.body.motif);
      app.direct.signalerChangement();   // le nombre d'inscrits a changé
      return { fait: true };
    });

  app.post('/etudiants/:id/changer-promotion', {
    preHandler: correcteur,
    schema: {
      ...schemaEtudiant,
      body: {
        type: 'object',
        required: ['promotionId', 'motif'],
        properties: {
          promotionId: { type: 'integer', minimum: 1 },
          motif: { type: 'string', maxLength: 200 },
          confirmerHomonyme: { type: 'boolean' },
        },
      },
    },
  }, async (requete) => {
    const resultat = await changerPromotion(sql, requete.admin.id, requete.params.id, requete.body);
    app.direct.signalerChangement();   // le nombre d'inscrits a changé
    return resultat;
  });
}
