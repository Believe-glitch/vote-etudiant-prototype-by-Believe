// Routes de l'espace étudiant : connexion avec le code, liste de ses votes,
// enregistrement d'un vote, déconnexion.

import { ErreurMetier } from '../services/erreurs.js';
import { normaliserCode, aLaFormeDUnCode, empreinteCode } from '../services/codes.js';
import { ouvrirSession, fermerSession, lireSession, optionsCookie, COOKIE_ETUDIANT } from '../services/sessions.js';
import { patienter } from '../services/limiteur.js';
import { chargerScrutins, libellePromotion } from '../services/scrutins.js';
import { enregistrerVote } from '../services/vote.js';

export async function routesEtudiant(app) {
  const { sql, config } = app;

  app.post('/connexion', {
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', maxLength: 40 } },
      },
    },
  }, async (requete, reponse) => {
    const cleLimiteur = `etudiant:${requete.ip}`;
    if (app.limiteurEtudiants.estBloque(cleLimiteur)) {
      throw new ErreurMetier('Trop de codes incorrects depuis ce réseau. Réessayez dans quelques minutes.', 429);
    }

    const code = normaliserCode(requete.body.code);
    // On cherche toujours le code DANS LA BASE : un code qui a "la bonne
    // forme" mais qui n'a jamais été remis par un officiel est refusé.
    const [trouve] = aLaFormeDUnCode(code)
      ? await sql`
          select id from code_vote
          where empreinte = ${empreinteCode(code, config.cleSecreteCodes)} and statut = 'actif'`
      : [];

    if (!trouve) {
      app.limiteurEtudiants.noterEchec(cleLimiteur);
      await patienter(400);
      throw new ErreurMetier('Code inconnu ou plus valide. Vérifiez chaque caractère.', 401);
    }

    const { jeton, dureeSecondes } = await ouvrirSession(sql, 'etudiant', trouve.id);
    reponse.setCookie(COOKIE_ETUDIANT, jeton, optionsCookie(config, dureeSecondes));
    return { connecte: true };
  });

  app.post('/deconnexion', async (requete, reponse) => {
    await fermerSession(sql, requete.cookies[COOKIE_ETUDIANT]);
    reponse.clearCookie(COOKIE_ETUDIANT, { path: '/' });
    return { deconnecte: true };
  });

  // Simple question « suis-je connecté ? », sans erreur si la réponse est non.
  app.get('/session', async (requete) => {
    const codeId = await lireSession(sql, 'etudiant', requete.cookies[COOKIE_ETUDIANT]);
    return { connecte: codeId !== null };
  });

  // Ce que l'étudiant connecté peut voir : sa promotion et les votes qui le
  // concernent (ceux de sa promotion et la présidence), avec « déjà voté ».
  app.get('/moi', { preHandler: app.exigerEtudiant }, async (requete) => {
    const [moi] = await sql`
      select co.prefixe, pr.id as promotion_id, pr.campus_id, pr.niveau, pr.filiere,
        f.nom as faculte_nom, c.nom as campus_nom
      from code_vote co
      join etudiant e on e.id = co.etudiant_id
      join promotion pr on pr.id = e.promotion_id
      join faculte f on f.id = pr.faculte_id
      join campus c on c.id = pr.campus_id
      where co.id = ${requete.codeId} and co.statut = 'actif'`;
    if (!moi) throw new ErreurMetier('Votre code n’est plus valide. Adressez-vous à un officiel.', 401);

    const scrutins = [
      ...(await chargerScrutins(sql, { promotionId: moi.promotion_id })),
      ...(await chargerScrutins(sql, { presidence: true })),
    ];
    const votes = await sql`select scrutin_id from participation where code_id = ${requete.codeId}`;
    const dejaVote = new Set(votes.map((v) => v.scrutin_id));

    return {
      maintenant: new Date().toISOString(),
      prefixe: moi.prefixe,
      promotion: libellePromotion(moi),
      campusId: moi.campus_id,
      scrutins: scrutins.map((s) => ({
        id: s.id,
        poste: s.poste,
        nomPoste: s.nomPoste,
        tour: s.tour,
        statut: s.statut,
        eluDOffice: s.eluDOffice,
        aVote: dejaVote.has(s.id),
        // L'étudiant ne voit que la séance de SON site.
        seance: s.seances.find((se) => se.campusId === moi.campus_id) ?? null,
        candidats: s.candidats,
      })),
    };
  });

  app.post('/voter', {
    preHandler: app.exigerEtudiant,
    schema: {
      body: {
        type: 'object',
        required: ['scrutinId', 'candidatId'],
        properties: {
          scrutinId: { type: 'integer', minimum: 1 },
          candidatId: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (requete) => {
    await enregistrerVote(sql, requete.codeId, requete.body.scrutinId, requete.body.candidatId);
    app.direct.signalerChangement();
    return { enregistre: true };
  });
}
