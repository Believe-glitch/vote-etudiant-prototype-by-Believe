// La remise des codes aux étudiants (réservée aux distributeurs).
//
// Comment ça se passe devant l'officiel :
//   1. le distributeur choisit le site, la faculté et la promotion ;
//   2. il tape le nom de l'étudiant (le matricule est facultatif) ;
//   3. l'étudiant est ajouté à la liste de sa promotion, et son code est
//      créé et affiché UNE seule fois.
//
// Règles :
//   - un seul code actif par étudiant (la base l'interdit aussi) ;
//   - si un étudiant du même nom est déjà inscrit dans la promotion, le site
//     prévient : le distributeur doit confirmer qu'il s'agit d'une autre
//     personne (sinon, c'est un remplacement de code perdu) ;
//   - le code n'est jamais gardé en clair : la liste imprimée montre qui a
//     reçu un code, pas le code lui-même ;
//   - en cas de perte, l'ancien code est annulé et un nouveau est créé.
//     Le nouveau code "hérite" des votes déjà faits avec l'ancien :
//     l'étudiant ne peut donc pas voter deux fois grâce au remplacement.

import { ErreurMetier } from './erreurs.js';
import { noterAuJournal } from './journal.js';
import { prefixeCode, tirerPartieSecrete, empreinteCode } from './codes.js';
import { libellePromotion } from './scrutins.js';

const LIMITE_RECHERCHE = 50;

export async function rechercherEtudiants(sql, { recherche, promotionId }) {
  const texte = (recherche ?? '').trim();
  if (texte.length < 2 && !promotionId) {
    throw new ErreurMetier('Tapez au moins 2 caractères (nom ou matricule), ou choisissez une promotion.');
  }
  // On échappe % et _ pour qu'ils soient cherchés comme des caractères normaux.
  const motif = `%${texte.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const filtreTexte = texte
    ? sql`and (e.matricule ilike ${motif} or e.nom ilike ${motif} or e.postnom ilike ${motif} or e.prenom ilike ${motif})`
    : sql``;
  const filtrePromotion = promotionId ? sql`and e.promotion_id = ${promotionId}` : sql``;

  const lignes = await sql`
    select e.id, e.matricule, e.nom, e.postnom, e.prenom,
      pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom,
      (select cree_le from code_vote where etudiant_id = e.id and statut = 'actif') as code_remis_le,
      (select count(*)::int from code_vote where etudiant_id = e.id and statut = 'annule') as remplacements
    from etudiant e
    join promotion pr on pr.id = e.promotion_id
    join faculte f on f.id = pr.faculte_id
    join campus c on c.id = pr.campus_id
    where true ${filtreTexte} ${filtrePromotion}
    order by e.nom, e.prenom
    limit ${LIMITE_RECHERCHE}`;

  return lignes.map((l) => ({
    id: l.id,
    matricule: l.matricule,
    nomComplet: nomComplet(l),
    promotion: libellePromotion(l),
    codeRemisLe: l.code_remis_le,
    remplacements: l.remplacements,
  }));
}

// --- Les noms -------------------------------------------------------------

// Met un nom au propre : espaces en trop retirés.
export function nettoyerNom(texte) {
  return String(texte ?? '').trim().replace(/\s+/g, ' ');
}

// Version "pour comparer" d'un nom : minuscules, sans accents ni tirets.
// « Kabéya-Mukendi » et « kabeya mukendi » donnent la même chose.
export function nomPourComparer(texte) {
  return nettoyerNom(texte)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nomComplet(e) {
  return [e.nom, e.postnom, e.prenom].filter(Boolean).join(' ');
}

// --- La liste d'une promotion ----------------------------------------------

// Tous les étudiants d'une promotion, dans l'ordre alphabétique, avec l'état
// de leur code. Le code lui-même n'y est jamais : il n'est gardé nulle part.
export async function listerPromotion(sql, promotionId) {
  const [promotion] = await sql`
    select pr.id, pr.campus_id, pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom
    from promotion pr
    join faculte f on f.id = pr.faculte_id
    join campus c on c.id = pr.campus_id
    where pr.id = ${promotionId}`;
  if (!promotion) throw new ErreurMetier('Promotion introuvable.', 404);

  const lignes = await sql`
    select e.id, e.matricule, e.nom, e.postnom, e.prenom, e.inscrit_le,
      a.nom_complet as inscrit_par,
      (select cree_le from code_vote where etudiant_id = e.id and statut = 'actif') as code_remis_le,
      (select count(*)::int from code_vote where etudiant_id = e.id and statut = 'annule') as remplacements
    from etudiant e
    left join compte_admin a on a.id = e.inscrit_par
    where e.promotion_id = ${promotionId}`;

  const etudiants = lignes
    .map((l) => ({
      id: l.id,
      matricule: l.matricule,
      nom: l.nom,
      postnom: l.postnom,
      prenom: l.prenom,
      nomComplet: nomComplet(l),
      inscritLe: l.inscrit_le,
      inscritPar: l.inscrit_par,
      codeRemisLe: l.code_remis_le,
      remplacements: l.remplacements,
    }))
    .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet, 'fr', { sensitivity: 'base' }))
    .map((e, index) => ({ numero: index + 1, ...e }));

  return {
    promotion: { id: promotion.id, campusId: promotion.campus_id, libelle: libellePromotion(promotion) },
    inscrits: etudiants.length,
    codesRemis: etudiants.filter((e) => e.codeRemisLe).length,
    etudiants,
  };
}

// --- Inscription d'un étudiant et remise de son code -----------------------

export async function inscrireEtRemettreCode(sql, adminId, promotionId, identite, cleSecrete) {
  const nom = nettoyerNom(identite.nom);
  const postnom = nettoyerNom(identite.postnom);
  const prenom = nettoyerNom(identite.prenom);
  const matricule = nettoyerNom(identite.matricule) || null;
  if (nom.length < 2) throw new ErreurMetier('Indiquez au moins le nom de l’étudiant.');
  if (!postnom && !prenom) throw new ErreurMetier('Indiquez aussi le postnom ou le prénom, pour bien distinguer les étudiants.');

  return sql.begin(async (tx) => {
    const [promotion] = await tx`select id from promotion where id = ${promotionId}`;
    if (!promotion) throw new ErreurMetier('Promotion introuvable.', 404);

    // Un étudiant du même nom est-il déjà inscrit dans cette promotion ?
    if (!identite.confirmerHomonyme) {
      const existants = await tx`
        select nom, postnom, prenom from etudiant where promotion_id = ${promotionId}`;
      const cherche = nomPourComparer(`${nom} ${postnom} ${prenom}`);
      const nomPrenom = nomPourComparer(`${nom} ${prenom}`);
      const double = existants.find((e) =>
        nomPourComparer(nomComplet(e)) === cherche ||
        (prenom && nomPourComparer(`${e.nom} ${e.prenom}`) === nomPrenom));
      if (double) {
        throw new ErreurMetier(
          `« ${nomComplet(double)} » est déjà inscrit dans cette promotion. S’il a perdu son code, utilisez « Remplacer » dans la liste. Si c’est bien une autre personne, confirmez.`,
          409, { homonyme: true });
      }
    }

    if (matricule) {
      const [pris] = await tx`select id from etudiant where matricule = ${matricule}`;
      if (pris) throw new ErreurMetier('Ce matricule est déjà utilisé par un autre étudiant.', 409);
    }

    const [etudiant] = await tx`
      insert into etudiant (promotion_id, matricule, nom, postnom, prenom, inscrit_le, inscrit_par)
      values (${promotionId}, ${matricule}, ${nom}, ${postnom}, ${prenom}, now(), ${adminId})
      returning id`;
    const fiche = await lireEtudiantPourCode(tx, etudiant.id);
    const code = await insererNouveauCode(tx, fiche, adminId, cleSecrete);
    await noterAuJournal(tx, adminId, 'etudiant_inscrit_code_remis', {
      etudiantId: etudiant.id, nom: nomComplet({ nom, postnom, prenom }),
      promotionId, campusId: fiche.campus_id,
    });
    return { etudiantId: etudiant.id, nomComplet: nomComplet({ nom, postnom, prenom }), code: code.texte };
  });
}

// Crée un code pour un étudiant qui n'en a pas encore.
export async function genererCode(sql, adminId, etudiantId, cleSecrete) {
  return sql.begin(async (tx) => {
    const etudiant = await lireEtudiantPourCode(tx, etudiantId);
    const code = await insererNouveauCode(tx, etudiant, adminId, cleSecrete);
    if (!code) throw new ErreurMetier('Cet étudiant a déjà un code. En cas de perte, utilisez « Remplacer ».', 409);
    await noterAuJournal(tx, adminId, 'code_remis', {
      etudiantId, nom: etudiant.nom_complet, matricule: etudiant.matricule, campusId: etudiant.campus_id,
    });
    return code.texte;
  });
}

// Remplace un code perdu : l'ancien est annulé, le nouveau garde la trace
// des votes déjà faits.
export async function remplacerCode(sql, adminId, etudiantId, motif, cleSecrete) {
  const motifPropre = (motif ?? '').trim();
  if (motifPropre.length < 3) throw new ErreurMetier('Indiquez le motif du remplacement (ex. « code perdu »).');

  return sql.begin(async (tx) => {
    const etudiant = await lireEtudiantPourCode(tx, etudiantId);
    const [ancien] = await tx`
      select id from code_vote where etudiant_id = ${etudiantId} and statut = 'actif' for update`;
    if (!ancien) throw new ErreurMetier('Cet étudiant n’a pas encore de code : utilisez « Générer ».', 409);

    await tx`
      update code_vote set statut = 'annule', motif_annulation = ${motifPropre}, annule_le = now()
      where id = ${ancien.id}`;
    // L'ancien code ne doit plus pouvoir servir, même s'il était connecté.
    await tx`delete from session where type = 'etudiant' and reference_id = ${ancien.id}`;

    const nouveau = await insererNouveauCode(tx, etudiant, adminId, cleSecrete);
    // Les votes déjà faits avec l'ancien code comptent pour le nouveau.
    await tx`
      insert into participation (code_id, scrutin_id)
      select ${nouveau.id}, scrutin_id from participation where code_id = ${ancien.id}`;

    await noterAuJournal(tx, adminId, 'code_remplace', {
      etudiantId, nom: etudiant.nom_complet, matricule: etudiant.matricule,
      campusId: etudiant.campus_id, motif: motifPropre,
    });
    return nouveau.texte;
  });
}

async function lireEtudiantPourCode(tx, etudiantId) {
  const [etudiant] = await tx`
    select e.id, e.matricule, e.nom, e.postnom, e.prenom, pr.niveau, pr.campus_id,
      f.sigle as sigle_faculte, c.sigle as sigle_campus
    from etudiant e
    join promotion pr on pr.id = e.promotion_id
    join faculte f on f.id = pr.faculte_id
    join campus c on c.id = pr.campus_id
    where e.id = ${etudiantId}`;
  if (!etudiant) throw new ErreurMetier('Étudiant introuvable dans la liste.', 404);
  return { ...etudiant, nom_complet: nomComplet(etudiant) };
}

// Tire un code au hasard et l'enregistre. Si par un hasard extraordinaire
// le même code existait déjà (1 chance sur des centaines de millions), on
// en tire un autre. Renvoie null si l'étudiant a déjà un code actif.
async function insererNouveauCode(tx, etudiant, adminId, cleSecrete) {
  const prefixe = prefixeCode({
    niveau: etudiant.niveau,
    sigleFaculte: etudiant.sigle_faculte,
    sigleCampus: etudiant.sigle_campus,
  });
  for (let essai = 0; essai < 5; essai++) {
    const texte = `${prefixe}-${tirerPartieSecrete()}`;
    const [ligne] = await tx`
      insert into code_vote (etudiant_id, prefixe, empreinte, cree_par)
      values (${etudiant.id}, ${prefixe}, ${empreinteCode(texte, cleSecrete)}, ${adminId})
      on conflict do nothing
      returning id`;
    if (ligne) return { id: ligne.id, texte };

    // Rien n'a été inséré : soit l'étudiant a déjà un code, soit le code tiré existe déjà.
    const [actif] = await tx`
      select id from code_vote where etudiant_id = ${etudiant.id} and statut = 'actif'`;
    if (actif) return null;
  }
  throw new Error('Impossible de tirer un code unique après 5 essais.');
}

// Statistiques des codes, par promotion. Les totaux par faculté, par site et
// pour l'université sont calculés à partir de ces lignes.
export async function statistiquesCodes(sql) {
  const lignes = await sql`
    select pr.id, pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom,
      count(distinct e.id)::int as inscrits,
      count(co.id) filter (where co.statut = 'actif')::int as codes_actifs,
      count(co.id) filter (where co.statut = 'annule')::int as codes_remplaces
    from promotion pr
    join faculte f on f.id = pr.faculte_id
    join campus c on c.id = pr.campus_id
    left join etudiant e on e.promotion_id = pr.id
    left join code_vote co on co.etudiant_id = e.id
    group by pr.id, f.id, c.id
    order by c.id, f.nom, pr.niveau, pr.filiere`;

  const promotions = lignes.map((l) => ({
    promotionId: l.id,
    promotion: libellePromotion(l),
    campus: l.campus_nom,
    faculte: l.faculte_nom,
    inscrits: l.inscrits,
    codesActifs: l.codes_actifs,
    codesRemplaces: l.codes_remplaces,
  }));

  const totaliser = (cleDe) => {
    const totaux = new Map();
    for (const p of promotions) {
      const cle = cleDe(p);
      const t = totaux.get(cle) ?? { nom: cle, inscrits: 0, codesActifs: 0, codesRemplaces: 0 };
      t.inscrits += p.inscrits;
      t.codesActifs += p.codesActifs;
      t.codesRemplaces += p.codesRemplaces;
      totaux.set(cle, t);
    }
    return [...totaux.values()];
  };

  return {
    promotions,
    parFaculte: totaliser((p) => `${p.faculte} · ${p.campus}`),
    parSite: totaliser((p) => p.campus),
    universite: totaliser(() => 'Université')[0] ?? { nom: 'Université', inscrits: 0, codesActifs: 0, codesRemplaces: 0 },
  };
}
