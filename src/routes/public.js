// Routes ouvertes à tous (visiteurs compris) : structure de l'université,
// candidats, photos, résultats dévoilés, et le direct des votes en cours.

import { ErreurMetier } from '../services/erreurs.js';
import { chargerScrutins, lireResultat, libellePromotion, resumeScrutin } from '../services/scrutins.js';

const schemaId = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 1 } },
  },
};

export async function routesPubliques(app) {
  const { sql } = app;

  // Sites, facultés et promotions, pour les listes de choix des pages.
  app.get('/structure', async () => {
    const campus = await sql`select id, sigle, nom from campus order by id`;
    const facultes = await sql`select id, sigle, nom from faculte order by nom`;
    const promotions = await sql`
      select pr.id, pr.campus_id, pr.faculte_id, pr.niveau, pr.filiere,
        f.nom as faculte_nom, c.nom as campus_nom
      from promotion pr
      join faculte f on f.id = pr.faculte_id
      join campus c on c.id = pr.campus_id
      order by c.id, f.nom, pr.niveau, pr.filiere`;
    return {
      campus,
      facultes,
      promotions: promotions.map((p) => ({
        id: p.id,
        campusId: p.campus_id,
        faculteId: p.faculte_id,
        niveau: p.niveau,
        filiere: p.filiere,
        libelle: libellePromotion(p),
      })),
    };
  });

  // Les candidats et l'état des scrutins d'une promotion, ou de la présidence.
  // Aucune voix n'est renvoyée ici.
  app.get('/scrutins', {
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

  // Un seul scrutin (titre, candidats, participation), sans les voix.
  app.get('/scrutins/:id', { schema: schemaId }, async (requete) => {
    const [scrutin] = await chargerScrutins(sql, { ids: [requete.params.id] });
    if (!scrutin) throw new ErreurMetier('Scrutin introuvable.', 404);
    return scrutin;
  });

  // Les photos ne changent jamais (une nouvelle photo = un nouveau numéro) :
  // le navigateur peut donc les garder en mémoire très longtemps.
  app.get('/photos/:id', { schema: schemaId }, async (requete, reponse) => {
    const [photo] = await sql`select type_mime, donnees from photo where id = ${requete.params.id}`;
    if (!photo) throw new ErreurMetier('Photo introuvable.', 404);
    return reponse
      .header('Content-Type', photo.type_mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(photo.donnees);
  });

  // La liste des scrutins dont les résultats (au moins d'un site) sont dévoilés.
  app.get('/resultats', async () => {
    const lignes = await sql`
      select s.id from scrutin s
      where s.statut = 'devoile'
         or exists (select 1 from seance se where se.scrutin_id = s.id and se.devoilee)
      order by s.devoile_le desc nulls first, s.id desc`;
    const scrutins = await chargerScrutins(sql, { ids: lignes.map((l) => l.id) });
    // On garde l'ordre "du plus récent au plus ancien".
    const ordre = new Map(lignes.map((l, index) => [l.id, index]));
    return scrutins
      .sort((a, b) => ordre.get(a.id) - ordre.get(b.id))
      .map((s) => ({ ...resumeScrutin(s), complet: s.statut === 'devoile', eluDOffice: s.eluDOffice }));
  });

  // Le détail d'un résultat. Refusé tant qu'il n'est pas dévoilé.
  app.get('/resultats/:id', { schema: schemaId }, async (requete) => lireResultat(sql, requete.params.id));

  // Le direct (Server-Sent Events). On "détourne" la réponse : c'est le
  // module direct.js qui écrit dedans tant que la page reste ouverte.
  app.get('/direct', async (requete, reponse) => {
    reponse.hijack();
    await app.direct.ajouterClient(reponse.raw);
  });
}
