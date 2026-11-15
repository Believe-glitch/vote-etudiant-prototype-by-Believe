// Les scrutins : lecture de leur état, déroulement des séances,
// dévoilement des résultats, second tour, candidats.
//
// Rappel du vocabulaire :
//   scrutin : l'élection d'un poste pour un tour (ex. CP de L2 INF Lingwala, tour 1) ;
//   séance  : le moment où UN site vote pour ce scrutin (la présidence en a deux).
//
// Étapes d'un scrutin :
//   preparation → en_cours (une séance s'ouvre) → termine (toutes les séances
//   sont fermées) → devoile (le superviseur a dévoilé les résultats).

import { ErreurMetier } from './erreurs.js';
import { noterAuJournal } from './journal.js';
import { calculerResultat, NOMS_POSTES, nomDeLaPlace } from './resultats.js';

export const DUREE_MAXIMALE_MINUTES = 240;

export function libellePromotion({ niveau, filiere, faculte_nom, campus_nom }) {
  const intitule = filiere ? filiere : faculte_nom;
  return `${niveau} ${intitule} · ${campus_nom}`;
}

// ---------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------

// Charge des scrutins avec leurs séances (et la participation) et leurs candidats.
// Le filtre est l'un de : { promotionId }, { presidence: true }, { ids: [...] }.
export async function chargerScrutins(sql, filtre) {
  let lignes;
  const colonnes = sql`
    s.id, s.poste, s.tour, s.statut, s.promotion_id, s.parent_id,
    s.premiere_place, s.nombre_places, s.mode_devoilement, s.elu_d_office, s.devoile_le,
    pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom`;
  const jointures = sql`
    left join promotion pr on pr.id = s.promotion_id
    left join faculte f on f.id = pr.faculte_id
    left join campus c on c.id = pr.campus_id`;

  if (filtre.promotionId !== undefined) {
    lignes = await sql`select ${colonnes} from scrutin s ${jointures}
      where s.promotion_id = ${filtre.promotionId} order by s.id`;
  } else if (filtre.presidence) {
    lignes = await sql`select ${colonnes} from scrutin s ${jointures}
      where s.poste = 'PRESIDENCE' order by s.id`;
  } else {
    if (filtre.ids.length === 0) return [];
    lignes = await sql`select ${colonnes} from scrutin s ${jointures}
      where s.id in ${sql(filtre.ids)} order by s.id`;
  }
  if (lignes.length === 0) return [];

  const ids = lignes.map((l) => l.id);
  const seances = await sql`
    select se.scrutin_id, se.campus_id, c.nom as campus_nom, se.statut, se.debut, se.fin, se.devoilee
    from seance se join campus c on c.id = se.campus_id
    where se.scrutin_id in ${sql(ids)}
    order by c.id`;
  const candidats = await sql`
    select id, scrutin_id, nom, slogan, photo_id from candidat
    where scrutin_id in ${sql(ids)} order by id`;
  const votants = await compterVotants(sql, ids);
  const inscrits = await compterInscrits(sql);

  return lignes.map((s) => ({
    id: s.id,
    poste: s.poste,
    nomPoste: NOMS_POSTES[s.poste],
    tour: s.tour,
    statut: s.statut,
    parentId: s.parent_id,
    promotionId: s.promotion_id,
    promotion: s.promotion_id ? libellePromotion(s) : null,
    premierePlace: s.premiere_place,
    nombrePlaces: s.nombre_places,
    modeDevoilement: s.mode_devoilement,
    eluDOffice: s.elu_d_office,
    seances: seances
      .filter((se) => se.scrutin_id === s.id)
      .map((se) => ({
        campusId: se.campus_id,
        campus: se.campus_nom,
        statut: se.statut,
        debut: se.debut,
        fin: se.fin,
        devoilee: se.devoilee,
        votants: votants.get(`${s.id}-${se.campus_id}`) ?? 0,
        inscrits: s.promotion_id
          ? inscrits.parPromotion.get(s.promotion_id) ?? 0
          : inscrits.parCampus.get(se.campus_id) ?? 0,
      })),
    candidats: candidats
      .filter((c) => c.scrutin_id === s.id)
      .map((c) => ({ id: c.id, nom: c.nom, slogan: c.slogan, photoId: c.photo_id })),
  }));
}

// Nombre d'étudiants différents qui ont voté, par scrutin et par site.
// On compte les ÉTUDIANTS et non les codes : après un remplacement de code,
// l'ancien et le nouveau code portent la même participation.
export async function compterVotants(sql, scrutinIds) {
  const resultat = new Map();
  if (scrutinIds.length === 0) return resultat;
  const lignes = await sql`
    select pa.scrutin_id, pr.campus_id, count(distinct co.etudiant_id)::int as votants
    from participation pa
    join code_vote co on co.id = pa.code_id
    join etudiant e on e.id = co.etudiant_id
    join promotion pr on pr.id = e.promotion_id
    where pa.scrutin_id in ${sql(scrutinIds)}
    group by pa.scrutin_id, pr.campus_id`;
  for (const l of lignes) resultat.set(`${l.scrutin_id}-${l.campus_id}`, l.votants);
  return resultat;
}

export async function compterInscrits(sql) {
  const parPromotion = new Map();
  const parCampus = new Map();
  const lignes = await sql`
    select pr.id as promotion_id, pr.campus_id, count(e.id)::int as inscrits
    from promotion pr left join etudiant e on e.promotion_id = pr.id
    group by pr.id, pr.campus_id`;
  for (const l of lignes) {
    parPromotion.set(l.promotion_id, l.inscrits);
    parCampus.set(l.campus_id, (parCampus.get(l.campus_id) ?? 0) + l.inscrits);
  }
  return { parPromotion, parCampus };
}

// ---------------------------------------------------------------------
// Résultats : ils ne sortent de la base QUE s'ils ont été dévoilés,
// pour tout le monde, officiels compris.
// ---------------------------------------------------------------------

export async function lireResultat(sql, scrutinId) {
  const [scrutin] = await chargerScrutins(sql, { ids: [scrutinId] });
  if (!scrutin) throw new ErreurMetier('Scrutin introuvable.', 404);

  const complet = scrutin.statut === 'devoile';
  const sitesVisibles = scrutin.seances.filter((se) => complet || se.devoilee);
  if (!complet && sitesVisibles.length === 0) {
    throw new ErreurMetier('Les résultats de ce scrutin n’ont pas encore été dévoilés.', 403);
  }

  const voix = await sql`
    select candidat_id, campus_id, nombre from voix where scrutin_id = ${scrutinId}`;
  const voixDe = (candidatId, campusIds) =>
    voix
      .filter((v) => v.candidat_id === candidatId && campusIds.includes(v.campus_id))
      .reduce((total, v) => total + v.nombre, 0);

  const parSite = sitesVisibles.map((se) => ({
    campusId: se.campusId,
    campus: se.campus,
    votants: se.votants,
    inscrits: se.inscrits,
    candidats: scrutin.candidats.map((c) => ({ ...c, voix: voixDe(c.id, [se.campusId]) })),
  }));

  const reponse = {
    scrutin: resumeScrutin(scrutin),
    complet,
    eluDOffice: scrutin.eluDOffice,
    parSite,
    participation: null,
    candidats: null,
    places: [],
    egalite: null,
    secondTourId: null,
  };
  if (!complet) return reponse;

  const tousLesSites = scrutin.seances.map((se) => se.campusId);
  reponse.participation = {
    votants: scrutin.seances.reduce((t, se) => t + se.votants, 0),
    inscrits: scrutin.seances.reduce((t, se) => t + se.inscrits, 0),
  };
  reponse.candidats = scrutin.candidats.map((c) => ({ ...c, voix: voixDe(c.id, tousLesSites) }));

  if (scrutin.eluDOffice) {
    const [seul] = scrutin.candidats;
    reponse.places = [{ rang: scrutin.premierePlace, nomPlace: nomDeLaPlace(scrutin.poste, scrutin.premierePlace), candidatId: seul.id }];
    return reponse;
  }

  const calcul = calculerResultat({
    candidats: reponse.candidats,
    premierePlace: scrutin.premierePlace,
    nombrePlaces: scrutin.nombrePlaces,
  });
  reponse.places = calcul.places.map((p) => ({
    rang: p.rang,
    nomPlace: nomDeLaPlace(scrutin.poste, p.rang),
    candidatId: p.candidat.id,
  }));
  reponse.egalite = calcul.egalite;
  const [enfant] = await sql`select id from scrutin where parent_id = ${scrutinId}`;
  reponse.secondTourId = enfant ? enfant.id : null;
  return reponse;
}

export function resumeScrutin(s) {
  return {
    id: s.id, poste: s.poste, nomPoste: s.nomPoste, tour: s.tour,
    statut: s.statut, promotion: s.promotion, promotionId: s.promotionId,
  };
}

// Liste des inscrits avec « a voté / n'a pas voté ». Seulement quand toutes
// les séances sont fermées : pendant le vote, cette liste à côté d'un
// compteur qui bouge pourrait trahir le choix de quelqu'un.
export async function listerVotants(sql, scrutinId) {
  const [scrutin] = await sql`select id, statut, promotion_id from scrutin where id = ${scrutinId}`;
  if (!scrutin) throw new ErreurMetier('Scrutin introuvable.', 404);
  if (!['termine', 'devoile'].includes(scrutin.statut)) {
    throw new ErreurMetier('La liste des votants n’est visible qu’après la fermeture du vote.', 403);
  }
  const filtrePromotion = scrutin.promotion_id
    ? sql`where e.promotion_id = ${scrutin.promotion_id}`
    : sql``;
  return sql`
    select e.matricule, e.nom, e.prenom, c.nom as campus,
      exists (
        select 1 from participation pa join code_vote co on co.id = pa.code_id
        where pa.scrutin_id = ${scrutinId} and co.etudiant_id = e.id
      ) as a_vote
    from etudiant e
    join promotion pr on pr.id = e.promotion_id
    join campus c on c.id = pr.campus_id
    ${filtrePromotion}
    order by c.id, e.nom, e.prenom`;
}

// ---------------------------------------------------------------------
// Déroulement des séances (réservé au superviseur)
// ---------------------------------------------------------------------

async function verrouillerScrutin(tx, scrutinId) {
  const [scrutin] = await tx`select * from scrutin where id = ${scrutinId} for update`;
  if (!scrutin) throw new ErreurMetier('Scrutin introuvable.', 404);
  return scrutin;
}

async function verrouillerSeance(tx, scrutinId, campusId) {
  const [seance] = await tx`
    select * from seance where scrutin_id = ${scrutinId} and campus_id = ${campusId} for update`;
  if (!seance) throw new ErreurMetier('Ce site ne vote pas pour ce scrutin.', 404);
  return seance;
}

// Recalcule l'étape du scrutin d'après l'état de ses séances :
//   toutes fermées → termine ; au moins une commencée → en_cours ; sinon preparation.
// Un scrutin déjà dévoilé ne change plus.
async function mettreAJourStatut(tx, scrutinId) {
  await tx`
    update scrutin set statut = (
      select case
        when bool_and(statut = 'fermee') then 'termine'
        when bool_or(statut <> 'attente') then 'en_cours'
        else 'preparation'
      end
      from seance where scrutin_id = ${scrutinId}
    )
    where id = ${scrutinId} and statut <> 'devoile'`;
}

export async function ouvrirSeance(sql, adminId, scrutinId, campusId, dureeMinutes) {
  if (!Number.isInteger(dureeMinutes) || dureeMinutes < 1 || dureeMinutes > DUREE_MAXIMALE_MINUTES) {
    throw new ErreurMetier(`La durée doit être comprise entre 1 et ${DUREE_MAXIMALE_MINUTES} minutes.`);
  }
  await sql.begin(async (tx) => {
    const scrutin = await verrouillerScrutin(tx, scrutinId);
    if (scrutin.statut === 'devoile') throw new ErreurMetier('Ce scrutin est déjà terminé et dévoilé.', 409);
    const seance = await verrouillerSeance(tx, scrutinId, campusId);
    if (seance.statut === 'ouverte') throw new ErreurMetier('Ce vote est déjà ouvert.', 409);
    if (seance.statut === 'fermee') throw new ErreurMetier('Ce vote a déjà eu lieu : une séance fermée ne se rouvre pas.', 409);

    const [{ nombre }] = await tx`
      select count(*)::int as nombre from candidat where scrutin_id = ${scrutinId}`;
    if (nombre === 0) throw new ErreurMetier('Aucun candidat : le poste est vacant, il n’y a pas de vote à ouvrir.', 409);
    if (nombre === 1) throw new ErreurMetier('Un seul candidat : déclarez-le élu d’office au lieu d’ouvrir un vote.', 409);

    await tx`
      update seance
      set statut = 'ouverte', debut = now(), fin = now() + make_interval(mins => ${dureeMinutes})
      where id = ${seance.id}`;
    await mettreAJourStatut(tx, scrutinId);
    await noterAuJournal(tx, adminId, 'vote_ouvert', { scrutinId, campusId, dureeMinutes });
  });
}

export async function prolongerSeance(sql, adminId, scrutinId, campusId, minutes) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new ErreurMetier('On peut prolonger de 1 à 60 minutes à la fois.');
  }
  await sql.begin(async (tx) => {
    const seance = await verrouillerSeance(tx, scrutinId, campusId);
    if (seance.statut !== 'ouverte') throw new ErreurMetier('Seul un vote ouvert peut être prolongé.', 409);
    await tx`update seance set fin = fin + make_interval(mins => ${minutes}) where id = ${seance.id}`;
    await noterAuJournal(tx, adminId, 'vote_prolonge', { scrutinId, campusId, minutes });
  });
}

export async function fermerSeance(sql, adminId, scrutinId, campusId) {
  await sql.begin(async (tx) => {
    await verrouillerScrutin(tx, scrutinId);
    const seance = await verrouillerSeance(tx, scrutinId, campusId);
    if (seance.statut !== 'ouverte') throw new ErreurMetier('Ce vote n’est pas ouvert.', 409);
    await tx`update seance set statut = 'fermee', fin = least(fin, now()) where id = ${seance.id}`;
    await mettreAJourStatut(tx, scrutinId);
    await noterAuJournal(tx, adminId, 'vote_ferme_manuellement', { scrutinId, campusId });
  });
}

// Appelée chaque seconde par le serveur : ferme les séances dont l'heure de
// fin est passée. Renvoie true si quelque chose a changé.
export async function fermerSeancesEchues(sql) {
  const fermees = await sql.begin(async (tx) => {
    const lignes = await tx`
      update seance set statut = 'fermee'
      where statut = 'ouverte' and fin <= now()
      returning scrutin_id, campus_id`;
    for (const l of lignes) {
      await mettreAJourStatut(tx, l.scrutin_id);
      await noterAuJournal(tx, null, 'vote_ferme_fin_du_temps', { scrutinId: l.scrutin_id, campusId: l.campus_id });
    }
    return lignes;
  });
  return fermees.length > 0;
}

// Le choix du mode de dévoilement (présidence) se fait AVANT le vote et ne
// change plus ensuite : personne ne peut choisir après avoir vu les chiffres.
export async function changerModeDevoilement(sql, adminId, scrutinId, mode) {
  if (!['total', 'par_site'].includes(mode)) throw new ErreurMetier('Mode de dévoilement inconnu.');
  await sql.begin(async (tx) => {
    const scrutin = await verrouillerScrutin(tx, scrutinId);
    if (scrutin.statut !== 'preparation') {
      throw new ErreurMetier('Le mode de dévoilement ne peut plus changer : le vote a commencé.', 409);
    }
    await tx`update scrutin set mode_devoilement = ${mode} where id = ${scrutinId}`;
    await noterAuJournal(tx, adminId, 'mode_devoilement_choisi', { scrutinId, mode });
  });
}

// Dévoile les résultats. Sans campusId : le total (toutes les séances doivent
// être fermées). Avec campusId (mode "par site") : seulement ce site.
export async function devoiler(sql, adminId, scrutinId, campusId = null) {
  await sql.begin(async (tx) => {
    const scrutin = await verrouillerScrutin(tx, scrutinId);
    if (scrutin.statut === 'devoile') throw new ErreurMetier('Les résultats sont déjà dévoilés.', 409);

    if (campusId !== null) {
      if (scrutin.mode_devoilement !== 'par_site') {
        throw new ErreurMetier('Ce scrutin se dévoile seulement en total, après tous les sites.', 409);
      }
      const seance = await verrouillerSeance(tx, scrutinId, campusId);
      if (seance.statut !== 'fermee') throw new ErreurMetier('Le vote de ce site n’est pas encore fermé.', 409);
      if (seance.devoilee) throw new ErreurMetier('Les résultats de ce site sont déjà dévoilés.', 409);
      await tx`update seance set devoilee = true where id = ${seance.id}`;
      await noterAuJournal(tx, adminId, 'resultats_site_devoiles', { scrutinId, campusId });
    }

    const [{ toutesFermees, toutesDevoilees }] = await tx`
      select bool_and(statut = 'fermee') as "toutesFermees", bool_and(devoilee) as "toutesDevoilees"
      from seance where scrutin_id = ${scrutinId}`;

    // Dévoilement du total : demandé explicitement, ou automatique quand
    // chaque site a été dévoilé l'un après l'autre.
    if (campusId === null || toutesDevoilees) {
      if (!toutesFermees) throw new ErreurMetier('Tous les votes de ce scrutin ne sont pas encore fermés.', 409);
      await tx`update seance set devoilee = true where scrutin_id = ${scrutinId}`;
      await tx`update scrutin set statut = 'devoile', devoile_le = now() where id = ${scrutinId}`;
      await noterAuJournal(tx, adminId, 'resultats_devoiles', { scrutinId });
    }
  });
}

export async function declarerEluDOffice(sql, adminId, scrutinId) {
  await sql.begin(async (tx) => {
    const scrutin = await verrouillerScrutin(tx, scrutinId);
    if (scrutin.statut !== 'preparation') throw new ErreurMetier('Ce scrutin a déjà commencé.', 409);
    const candidats = await tx`select id from candidat where scrutin_id = ${scrutinId}`;
    if (candidats.length !== 1) {
      throw new ErreurMetier('Un candidat n’est élu d’office que s’il est le seul candidat.', 409);
    }
    await tx`
      update scrutin set statut = 'devoile', elu_d_office = true, devoile_le = now()
      where id = ${scrutinId}`;
    await tx`update seance set devoilee = true where scrutin_id = ${scrutinId}`;
    await noterAuJournal(tx, adminId, 'elu_d_office', { scrutinId, candidatId: candidats[0].id });
  });
}

// Second tour : un nouveau scrutin entre les seuls candidats à égalité,
// pour la ou les places encore à attribuer. Les mêmes codes revotent.
export async function lancerSecondTour(sql, adminId, scrutinId) {
  const resultat = await lireResultat(sql, scrutinId);
  if (!resultat.complet) throw new ErreurMetier('Les résultats doivent d’abord être dévoilés.', 409);
  if (!resultat.egalite) throw new ErreurMetier('Il n’y a pas d’égalité : pas de second tour.', 409);
  if (resultat.secondTourId) throw new ErreurMetier('Le second tour existe déjà.', 409);

  return sql.begin(async (tx) => {
    const parent = await verrouillerScrutin(tx, scrutinId);
    const [dejaCree] = await tx`select id from scrutin where parent_id = ${scrutinId}`;
    if (dejaCree) throw new ErreurMetier('Le second tour existe déjà.', 409);

    const [{ dernierTour }] = await tx`
      select max(tour)::int as "dernierTour" from scrutin
      where poste = ${parent.poste} and promotion_id is not distinct from ${parent.promotion_id}`;
    const [nouveau] = await tx`
      insert into scrutin (poste, promotion_id, tour, parent_id, premiere_place, nombre_places, mode_devoilement)
      values (${parent.poste}, ${parent.promotion_id}, ${dernierTour + 1}, ${parent.id},
              ${resultat.egalite.premierePlace}, ${resultat.egalite.nombrePlaces}, ${parent.mode_devoilement})
      returning id`;
    await tx`
      insert into seance (scrutin_id, campus_id)
      select ${nouveau.id}, campus_id from seance where scrutin_id = ${parent.id}`;
    await tx`
      insert into candidat (scrutin_id, nom, slogan, photo_id)
      select ${nouveau.id}, nom, slogan, photo_id from candidat
      where scrutin_id = ${parent.id} and id in ${tx(resultat.egalite.candidatIds)}
      order by id`;
    await noterAuJournal(tx, adminId, 'second_tour_cree', {
      scrutinParentId: parent.id, scrutinId: nouveau.id, candidatIds: resultat.egalite.candidatIds,
    });
    return nouveau.id;
  });
}

// ---------------------------------------------------------------------
// Candidats (réservé au superviseur, seulement avant le début du vote)
// ---------------------------------------------------------------------

async function verifierModifiable(tx, scrutinId) {
  const scrutin = await verrouillerScrutin(tx, scrutinId);
  if (scrutin.statut !== 'preparation') {
    throw new ErreurMetier('Le vote a commencé : la liste des candidats ne peut plus changer.', 409);
  }
  if (scrutin.parent_id !== null) {
    throw new ErreurMetier('Les candidats d’un second tour sont fixés par l’égalité du tour précédent.', 409);
  }
  return scrutin;
}

export async function ajouterCandidat(sql, adminId, scrutinId, { nom, slogan }) {
  return sql.begin(async (tx) => {
    await verifierModifiable(tx, scrutinId);
    const [candidat] = await tx`
      insert into candidat (scrutin_id, nom, slogan)
      values (${scrutinId}, ${nom}, ${slogan ?? ''})
      returning id`;
    await noterAuJournal(tx, adminId, 'candidat_ajoute', { scrutinId, candidatId: candidat.id, nom });
    return candidat.id;
  });
}

export async function retirerCandidat(sql, adminId, candidatId) {
  await sql.begin(async (tx) => {
    const [candidat] = await tx`select id, scrutin_id, nom from candidat where id = ${candidatId}`;
    if (!candidat) throw new ErreurMetier('Candidat introuvable.', 404);
    await verifierModifiable(tx, candidat.scrutin_id);
    await tx`delete from candidat where id = ${candidatId}`;
    await noterAuJournal(tx, adminId, 'candidat_retire', {
      scrutinId: candidat.scrutin_id, candidatId, nom: candidat.nom,
    });
  });
}

export async function changerPhoto(sql, adminId, candidatId, { typeMime, donnees }) {
  await sql.begin(async (tx) => {
    const [candidat] = await tx`select id, scrutin_id from candidat where id = ${candidatId}`;
    if (!candidat) throw new ErreurMetier('Candidat introuvable.', 404);
    await verifierModifiable(tx, candidat.scrutin_id);
    const [photo] = await tx`
      insert into photo (type_mime, donnees) values (${typeMime}, ${donnees}) returning id`;
    await tx`update candidat set photo_id = ${photo.id} where id = ${candidatId}`;
    await noterAuJournal(tx, adminId, 'photo_candidat_changee', { candidatId });
  });
}
