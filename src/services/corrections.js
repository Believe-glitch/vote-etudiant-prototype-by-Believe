// Les corrections de la liste des inscrits (distributeur et superviseur) :
//   - corriger le nom, le postnom, le prénom ou le matricule d'un étudiant ;
//   - annuler son code (sans en créer un nouveau : le distributeur le remettra) ;
//   - le retirer de la liste, s'il a été inscrit par erreur ;
//   - le changer de promotion, s'il a été inscrit dans la mauvaise.
//
// Règles :
//   - chaque correction est notée au journal, avec le nom de l'officiel ;
//   - annuler, retirer et changer de promotion demandent un motif ;
//   - on ne retire pas et on ne change pas de promotion un étudiant qui a
//     déjà voté : son vote compte dans sa promotion, on ne peut plus le déplacer ;
//   - le superviseur peut faire ces corrections, mais il ne crée jamais de code.

import { ErreurMetier } from './erreurs.js';
import { noterAuJournal } from './journal.js';
import { nettoyerNom, nomComplet, chercherHomonyme } from './distribution.js';
import { libellePromotion } from './scrutins.js';

function verifierMotif(motif) {
  const propre = nettoyerNom(motif);
  if (propre.length < 3) throw new ErreurMetier('Indiquez le motif (ex. « inscrit par erreur »).');
  return propre;
}

// L'étudiant, sa promotion et son site. "for update" : personne d'autre ne
// le modifie pendant qu'on le corrige.
async function lireEtudiant(tx, etudiantId) {
  const [etudiant] = await tx`
    select e.id, e.promotion_id, e.matricule, e.nom, e.postnom, e.prenom, pr.campus_id
    from etudiant e
    join promotion pr on pr.id = e.promotion_id
    where e.id = ${etudiantId}
    for update of e`;
  if (!etudiant) throw new ErreurMetier('Étudiant introuvable dans la liste.', 404);
  return etudiant;
}

async function aDejaVote(tx, etudiantId) {
  const [vote] = await tx`
    select 1 from participation pa
    join code_vote co on co.id = pa.code_id
    where co.etudiant_id = ${etudiantId}
    limit 1`;
  return Boolean(vote);
}

// --- 1. Corriger le nom ----------------------------------------------------

export async function corrigerEtudiant(sql, adminId, etudiantId, identite) {
  const nom = nettoyerNom(identite.nom);
  const postnom = nettoyerNom(identite.postnom);
  const prenom = nettoyerNom(identite.prenom);
  const matricule = nettoyerNom(identite.matricule) || null;
  if (nom.length < 2) throw new ErreurMetier('Indiquez au moins le nom de l’étudiant.');
  if (!postnom && !prenom) throw new ErreurMetier('Indiquez aussi le postnom ou le prénom.');

  return sql.begin(async (tx) => {
    const avant = await lireEtudiant(tx, etudiantId);

    if (!identite.confirmerHomonyme) {
      const double = await chercherHomonyme(tx, avant.promotion_id, { nom, postnom, prenom }, etudiantId);
      if (double) {
        throw new ErreurMetier(
          `« ${nomComplet(double)} » est déjà inscrit dans cette promotion. Si c’est bien une autre personne, confirmez.`,
          409, { homonyme: true });
      }
    }
    if (matricule && matricule !== avant.matricule) {
      const [pris] = await tx`select id from etudiant where matricule = ${matricule} and id <> ${etudiantId}`;
      if (pris) throw new ErreurMetier('Ce matricule est déjà utilisé par un autre étudiant.', 409);
    }

    await tx`
      update etudiant set nom = ${nom}, postnom = ${postnom}, prenom = ${prenom}, matricule = ${matricule}
      where id = ${etudiantId}`;
    await noterAuJournal(tx, adminId, 'etudiant_corrige', {
      etudiantId,
      avant: nomComplet(avant) + (avant.matricule ? ` (${avant.matricule})` : ''),
      nom: nomComplet({ nom, postnom, prenom }),
      matricule,
      promotionId: avant.promotion_id,
      campusId: avant.campus_id,
    });
    return { nomComplet: nomComplet({ nom, postnom, prenom }) };
  });
}

// --- 2. Annuler le code ----------------------------------------------------

// Le code ne marche plus, tout de suite (même si l'étudiant est connecté).
// Les votes déjà faits restent comptés, et passeront sur son prochain code.
export async function annulerCode(sql, adminId, etudiantId, motif) {
  const motifPropre = verifierMotif(motif);
  return sql.begin(async (tx) => {
    const etudiant = await lireEtudiant(tx, etudiantId);
    const [code] = await tx`
      update code_vote set statut = 'annule', motif_annulation = ${motifPropre}, annule_le = now()
      where etudiant_id = ${etudiantId} and statut = 'actif'
      returning id`;
    if (!code) throw new ErreurMetier('Cet étudiant n’a pas de code à annuler.', 409);
    await tx`delete from session where type = 'etudiant' and reference_id = ${code.id}`;
    await noterAuJournal(tx, adminId, 'code_annule', {
      etudiantId, nom: nomComplet(etudiant), matricule: etudiant.matricule,
      promotionId: etudiant.promotion_id, campusId: etudiant.campus_id, motif: motifPropre,
    });
  });
}

// --- 3. Retirer de la liste ------------------------------------------------

export async function retirerEtudiant(sql, adminId, etudiantId, motif) {
  const motifPropre = verifierMotif(motif);
  return sql.begin(async (tx) => {
    const etudiant = await lireEtudiant(tx, etudiantId);
    if (await aDejaVote(tx, etudiantId)) {
      throw new ErreurMetier('Cet étudiant a déjà voté : il ne peut plus être retiré de la liste. Annulez plutôt son code.', 409);
    }
    // Ses codes disparaissent avec lui (aucun vote n'y est attaché).
    const codes = (await tx`select id from code_vote where etudiant_id = ${etudiantId}`).map((c) => c.id);
    if (codes.length > 0) {
      await tx`delete from session where type = 'etudiant' and reference_id in ${tx(codes)}`;
      await tx`delete from code_vote where id in ${tx(codes)}`;
    }
    await tx`delete from etudiant where id = ${etudiantId}`;
    await noterAuJournal(tx, adminId, 'etudiant_retire', {
      etudiantId, nom: nomComplet(etudiant), matricule: etudiant.matricule,
      promotionId: etudiant.promotion_id, campusId: etudiant.campus_id, motif: motifPropre,
    });
  });
}

// --- 4. Changer de promotion -----------------------------------------------

// Le code commence par la promotion (ex. L2INF-LIN) : l'ancien code ne
// convient plus. Il est supprimé, et le distributeur en remettra un nouveau.
export async function changerPromotion(sql, adminId, etudiantId, { promotionId, motif, confirmerHomonyme }) {
  const motifPropre = verifierMotif(motif);
  return sql.begin(async (tx) => {
    const etudiant = await lireEtudiant(tx, etudiantId);
    if (etudiant.promotion_id === promotionId) throw new ErreurMetier('L’étudiant est déjà dans cette promotion.');
    const [nouvelle] = await tx`
      select pr.id, pr.campus_id, pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom
      from promotion pr
      join faculte f on f.id = pr.faculte_id
      join campus c on c.id = pr.campus_id
      where pr.id = ${promotionId}`;
    if (!nouvelle) throw new ErreurMetier('Promotion introuvable.', 404);
    if (await aDejaVote(tx, etudiantId)) {
      throw new ErreurMetier('Cet étudiant a déjà voté : il ne peut plus changer de promotion.', 409);
    }
    if (!confirmerHomonyme) {
      const double = await chercherHomonyme(tx, promotionId, etudiant, etudiantId);
      if (double) {
        throw new ErreurMetier(
          `« ${nomComplet(double)} » est déjà inscrit dans la promotion choisie. Si c’est bien une autre personne, confirmez.`,
          409, { homonyme: true });
      }
    }

    const codes = (await tx`select id from code_vote where etudiant_id = ${etudiantId}`).map((c) => c.id);
    if (codes.length > 0) {
      await tx`delete from session where type = 'etudiant' and reference_id in ${tx(codes)}`;
      await tx`delete from code_vote where id in ${tx(codes)}`;
    }
    await tx`update etudiant set promotion_id = ${promotionId} where id = ${etudiantId}`;
    await noterAuJournal(tx, adminId, 'etudiant_change_promotion', {
      etudiantId, nom: nomComplet(etudiant), matricule: etudiant.matricule,
      anciennePromotionId: etudiant.promotion_id,
      promotionId, campusId: nouvelle.campus_id, motif: motifPropre,
      nouvellePromotion: libellePromotion(nouvelle),
    });
    return { promotion: libellePromotion(nouvelle), codeSupprime: codes.length > 0 };
  });
}
