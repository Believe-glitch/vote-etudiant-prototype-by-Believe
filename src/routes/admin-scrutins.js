// Routes du superviseur (et lecture pour l'observateur) : candidats, photos,
// ouverture et fermeture des votes, dévoilement, second tour.

import { ErreurMetier } from '../services/erreurs.js';
import {
  chargerScrutins, listerVotants, ouvrirSeance, prolongerSeance, fermerSeance,
  devoiler, lancerSecondTour, declarerEluDOffice, changerModeDevoilement,
  ajouterCandidat, retirerCandidat, changerPhoto,
} from '../services/scrutins.js';

const parametresId = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};
const parametresSeance = {
  type: 'object',
  required: ['id', 'campusId'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    campusId: { type: 'integer', minimum: 1 },
  },
};

// On vérifie le vrai type du fichier à partir de ses premiers octets,
// sans croire l'extension ni ce que dit le navigateur.
function typeImage(donnees) {
  if (donnees.length > 3 && donnees[0] === 0xff && donnees[1] === 0xd8 && donnees[2] === 0xff) return 'image/jpeg';
  if (donnees.length > 8 && donnees.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (donnees.length > 12 && donnees.toString('ascii', 0, 4) === 'RIFF' && donnees.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function routesAdminScrutins(app) {
  const { sql } = app;
  const superviseur = app.exigerRole('superviseur');
  const lecture = app.exigerRole('superviseur', 'observateur');

  // Après chaque action, on prévient les pages ouvertes (direct).
  const action = (fonction) => async (requete, reponse) => {
    const resultat = await fonction(requete, reponse);
    app.direct.signalerChangement();
    return resultat ?? { fait: true };
  };

  app.get('/scrutins', {
    preHandler: lecture,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          promotion: { type: 'integer', minimum: 1 },
          presidence: { type: 'string', enum: ['oui'] },
        },
      },
    },
  }, async (requete) => {
    const { promotion, presidence } = requete.query;
    if (presidence === 'oui') return chargerScrutins(sql, { presidence: true });
    if (promotion) return chargerScrutins(sql, { promotionId: promotion });
    throw new ErreurMetier('Choisissez une promotion ou la présidence.');
  });

  app.get('/scrutins/:id/votants', { preHandler: lecture, schema: { params: parametresId } },
    async (requete) => listerVotants(sql, requete.params.id));

  // --- Candidats -------------------------------------------------------------

  app.post('/scrutins/:id/candidats', {
    preHandler: superviseur,
    schema: {
      params: parametresId,
      body: {
        type: 'object',
        required: ['nom'],
        properties: {
          nom: { type: 'string', minLength: 2, maxLength: 80 },
          slogan: { type: 'string', maxLength: 140 },
        },
      },
    },
  }, action(async (requete) => {
    const id = await ajouterCandidat(sql, requete.admin.id, requete.params.id, {
      nom: requete.body.nom.trim(),
      slogan: (requete.body.slogan ?? '').trim(),
    });
    return { id };
  }));

  app.delete('/candidats/:id', { preHandler: superviseur, schema: { params: parametresId } },
    action(async (requete) => retirerCandidat(sql, requete.admin.id, requete.params.id)));

  app.put('/candidats/:id/photo', { preHandler: superviseur, schema: { params: parametresId } },
    action(async (requete) => {
      const donnees = requete.body;
      if (!Buffer.isBuffer(donnees) || donnees.length === 0) throw new ErreurMetier('Aucune image reçue.');
      const typeMime = typeImage(donnees);
      if (!typeMime) throw new ErreurMetier('Le fichier n’est pas une image JPEG, PNG ou WebP.');
      await changerPhoto(sql, requete.admin.id, requete.params.id, { typeMime, donnees });
    }));

  // --- Déroulement du vote ---------------------------------------------------

  app.put('/scrutins/:id/mode-devoilement', {
    preHandler: superviseur,
    schema: {
      params: parametresId,
      body: {
        type: 'object',
        required: ['mode'],
        properties: { mode: { type: 'string', enum: ['total', 'par_site'] } },
      },
    },
  }, action(async (requete) => changerModeDevoilement(sql, requete.admin.id, requete.params.id, requete.body.mode)));

  app.post('/scrutins/:id/seances/:campusId/ouvrir', {
    preHandler: superviseur,
    schema: {
      params: parametresSeance,
      body: {
        type: 'object',
        required: ['dureeMinutes'],
        properties: { dureeMinutes: { type: 'integer' } },
      },
    },
  }, action(async (requete) => ouvrirSeance(
    sql, requete.admin.id, requete.params.id, requete.params.campusId, requete.body.dureeMinutes
  )));

  app.post('/scrutins/:id/seances/:campusId/prolonger', {
    preHandler: superviseur,
    schema: {
      params: parametresSeance,
      body: {
        type: 'object',
        required: ['minutes'],
        properties: { minutes: { type: 'integer' } },
      },
    },
  }, action(async (requete) => prolongerSeance(
    sql, requete.admin.id, requete.params.id, requete.params.campusId, requete.body.minutes
  )));

  app.post('/scrutins/:id/seances/:campusId/fermer', { preHandler: superviseur, schema: { params: parametresSeance } },
    action(async (requete) => fermerSeance(sql, requete.admin.id, requete.params.id, requete.params.campusId)));

  app.post('/scrutins/:id/devoiler', {
    preHandler: superviseur,
    schema: {
      params: parametresId,
      body: {
        type: 'object',
        properties: { campusId: { type: ['integer', 'null'], minimum: 1 } },
      },
    },
  }, action(async (requete) => devoiler(
    sql, requete.admin.id, requete.params.id, requete.body?.campusId ?? null
  )));

  app.post('/scrutins/:id/second-tour', { preHandler: superviseur, schema: { params: parametresId } },
    action(async (requete) => ({ id: await lancerSecondTour(sql, requete.admin.id, requete.params.id) })));

  app.post('/scrutins/:id/elu-d-office', { preHandler: superviseur, schema: { params: parametresId } },
    action(async (requete) => declarerEluDOffice(sql, requete.admin.id, requete.params.id)));
}
