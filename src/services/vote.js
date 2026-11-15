// Le cœur du site : enregistrer un vote.
//
// Tout se passe dans UNE transaction : soit tout est enregistré, soit rien.
// À chaque vote, le serveur revérifie toutes les règles lui-même, sans
// jamais faire confiance à ce que la page lui envoie :
//   1. le code est toujours valide (pas annulé) ;
//   2. le scrutin concerne bien la promotion de l'étudiant (ou c'est la présidence) ;
//   3. le vote est ouvert POUR SON SITE, et l'heure de fin n'est pas passée ;
//   4. le candidat fait bien partie de ce scrutin ;
//   5. ce code n'a pas déjà voté pour ce scrutin.

import { ErreurMetier } from './erreurs.js';

export async function enregistrerVote(sql, codeId, scrutinId, candidatId) {
  await sql.begin(async (tx) => {
    // 1. Le code
    const [code] = await tx`
      select co.id, pr.id as promotion_id, pr.campus_id
      from code_vote co
      join etudiant e on e.id = co.etudiant_id
      join promotion pr on pr.id = e.promotion_id
      where co.id = ${codeId} and co.statut = 'actif'`;
    if (!code) throw new ErreurMetier('Votre code n’est plus valide. Adressez-vous à un officiel.', 401);

    // 2. Le scrutin
    const [scrutin] = await tx`select id, promotion_id from scrutin where id = ${scrutinId}`;
    if (!scrutin) throw new ErreurMetier('Ce vote n’existe pas.', 404);
    if (scrutin.promotion_id !== null && scrutin.promotion_id !== code.promotion_id) {
      throw new ErreurMetier('Ce vote ne concerne pas votre promotion.', 403);
    }

    // 3. La séance de son site. "for share" empêche le superviseur de fermer
    // la séance pendant que ce vote est en train d'être enregistré : la
    // fermeture attendra simplement la fin de cette transaction.
    const [seance] = await tx`
      select id from seance
      where scrutin_id = ${scrutinId} and campus_id = ${code.campus_id}
        and statut = 'ouverte' and fin > now()
      for share`;
    if (!seance) throw new ErreurMetier('Ce vote n’est pas ouvert pour votre site en ce moment.', 409);

    // 4. Le candidat
    const [candidat] = await tx`
      select id from candidat where id = ${candidatId} and scrutin_id = ${scrutinId}`;
    if (!candidat) throw new ErreurMetier('Ce candidat ne se présente pas à ce vote.', 400);

    // 5. La participation. Si la ligne existe déjà, la base ne l'ajoute pas
    // ("on conflict do nothing") et ne renvoie rien : c'est un deuxième vote.
    // Même deux clics au même instant ne passent pas : la base fait attendre
    // le second jusqu'à ce que le premier soit enregistré.
    const participation = await tx`
      insert into participation (code_id, scrutin_id) values (${code.id}, ${scrutinId})
      on conflict do nothing
      returning code_id`;
    if (participation.length === 0) throw new ErreurMetier('Vous avez déjà voté pour ce poste.', 409);

    // La voix : on ajoute 1 au compteur du candidat, pour ce site.
    // Aucune trace de QUI a donné cette voix.
    await tx`
      insert into voix (scrutin_id, candidat_id, campus_id, nombre)
      values (${scrutinId}, ${candidatId}, ${code.campus_id}, 1)
      on conflict (scrutin_id, candidat_id, campus_id)
      do update set nombre = voix.nombre + 1`;
  });
}
