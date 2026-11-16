// Le nettoyage : remettre le site en ordre après des essais, avant une
// démonstration. Réservé au superviseur.
//
// Les cinq nettoyages possibles :
//   votes_scrutin  : effacer les votes d'UN scrutin (il revient « en préparation ») ;
//   tous_les_votes : effacer tous les votes, et supprimer les seconds tours ;
//   codes          : annuler les codes remis (d'une promotion, ou de toutes) ;
//   sessions       : déconnecter tout le monde, sauf le superviseur lui-même ;
//   tout           : tout remettre comme au départ (seulement en démonstration).
//
// Les protections (vérifiées par la route, voir routes/admin-nettoyage.js) :
//   - le superviseur retape son mot de passe et écrit le mot EFFACER ;
//   - rien n'est possible pendant qu'un vote est ouvert ;
//   - le journal n'est JAMAIS effacé : chaque nettoyage y est noté.
//
// Chaque nettoyage se fait dans UNE transaction : soit tout est fait, soit rien.

import { ErreurMetier } from './erreurs.js';
import { noterAuJournal } from './journal.js';
import { fermerAutresSessions } from './sessions.js';
import { NOMS_POSTES } from './resultats.js';
import { libellePromotion } from './scrutins.js';
import {
  ajouterEtudiantsDemo, ajouterCandidatsDemo, ajouterPhotosDemo, creerCodesDemo,
} from '../base/demo.js';

export const ACTIONS_NETTOYAGE = ['votes_scrutin', 'tous_les_votes', 'codes', 'sessions', 'tout'];

// Ce que la page « Nettoyage » doit savoir pour s'afficher.
export async function etatNettoyage(sql, config) {
  // Les votes ouverts en ce moment (le nettoyage attend leur fermeture).
  const ouverts = await sql`
    select s.id, s.poste, s.tour, pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom,
      cs.nom as site_seance
    from seance se
    join scrutin s on s.id = se.scrutin_id
    join campus cs on cs.id = se.campus_id
    left join promotion pr on pr.id = s.promotion_id
    left join faculte f on f.id = pr.faculte_id
    left join campus c on c.id = pr.campus_id
    where se.statut = 'ouverte'
    order by s.id`;

  // Les scrutins qui ont quelque chose à effacer : déjà ouverts une fois, ou avec des votes.
  const scrutins = await sql`
    select s.id, s.poste, s.tour, s.statut,
      pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom,
      (select count(*)::int from participation pa where pa.scrutin_id = s.id) as participations
    from scrutin s
    left join promotion pr on pr.id = s.promotion_id
    left join faculte f on f.id = pr.faculte_id
    left join campus c on c.id = pr.campus_id
    where s.statut <> 'preparation' or s.elu_d_office
       or exists (select 1 from participation pa where pa.scrutin_id = s.id)
    order by s.promotion_id nulls first, s.poste, s.tour`;

  const promotions = await sql`
    select pr.id, pr.niveau, pr.filiere, f.nom as faculte_nom, c.nom as campus_nom,
      count(co.id)::int as codes_actifs
    from promotion pr
    join faculte f on f.id = pr.faculte_id
    join campus c on c.id = pr.campus_id
    left join etudiant e on e.promotion_id = pr.id
    left join code_vote co on co.etudiant_id = e.id and co.statut = 'actif'
    group by pr.id, f.id, c.id
    order by c.id, f.nom, pr.niveau, pr.filiere`;

  const [{ sessions }] = await sql`select count(*)::int as sessions from session where expire_le > now()`;

  return {
    modeDemo: Boolean(config.donneesDemo),
    voteOuvert: ouverts.length > 0,
    votesOuverts: ouverts.map((o) => (o.poste === 'PRESIDENCE' ? `${libelleScrutin(o)} (${o.site_seance})` : libelleScrutin(o))),
    sessionsOuvertes: sessions,
    scrutins: scrutins.map((s) => ({
      id: s.id,
      libelle: libelleScrutin(s),
      statut: s.statut,
      participations: s.participations,
    })),
    promotions: promotions.map((p) => ({
      id: p.id,
      libelle: libellePromotion(p),
      codesActifs: p.codes_actifs,
    })),
  };
}

function libelleScrutin(s) {
  const poste = NOMS_POSTES[s.poste] ?? s.poste;
  const tour = s.tour > 1 ? ` · tour ${s.tour}` : '';
  if (s.poste === 'PRESIDENCE') return `${poste}${tour}`;
  return `${poste} · ${libellePromotion(s)}${tour}`;
}

// Point de départ de chaque nettoyage : aucun vote ne doit être ouvert.
// "for update" bloque les séances le temps du nettoyage : personne ne peut
// en ouvrir une pendant qu'on efface.
async function verifierAucunVoteOuvert(tx) {
  const seances = await tx`select statut from seance for update`;
  if (seances.some((s) => s.statut === 'ouverte')) {
    throw new ErreurMetier('Un vote est ouvert en ce moment. Fermez-le avant de nettoyer.', 409);
  }
}

// Efface les votes des scrutins donnés et les remet « en préparation ».
// Les seconds tours nés de ces scrutins sont supprimés.
async function effacerVotes(tx, scrutinIds) {
  if (scrutinIds.length === 0) return { scrutins: 0, voix: 0, secondsTours: 0 };

  // Tous les seconds tours qui descendent de ces scrutins (et leurs propres seconds tours).
  const descendants = (await tx`
    with recursive famille as (
      select id from scrutin where parent_id in ${tx(scrutinIds)}
      union
      select s.id from scrutin s join famille on s.parent_id = famille.id
    )
    select id from famille`).map((l) => l.id).filter((id) => !scrutinIds.includes(id));

  const tous = [...scrutinIds, ...descendants];
  const [{ voix }] = await tx`
    select coalesce(sum(nombre), 0)::int as voix from voix where scrutin_id in ${tx(tous)}`;
  await tx`delete from participation where scrutin_id in ${tx(tous)}`;
  await tx`delete from voix where scrutin_id in ${tx(tous)}`;

  if (descendants.length > 0) {
    await tx`delete from candidat where scrutin_id in ${tx(descendants)}`;
    await tx`delete from seance where scrutin_id in ${tx(descendants)}`;
    // Une seule instruction pour tous : la base accepte qu'un second tour
    // et son propre second tour disparaissent ensemble.
    await tx`delete from scrutin where id in ${tx(descendants)}`;
  }

  await tx`
    update seance set statut = 'attente', debut = null, fin = null, devoilee = false
    where scrutin_id in ${tx(scrutinIds)}`;
  // On ne compte que les scrutins qui avaient vraiment commencé.
  const remis = await tx`
    update scrutin set statut = 'preparation', elu_d_office = false, devoile_le = null
    where id in ${tx(scrutinIds)} and (statut <> 'preparation' or elu_d_office)
    returning id`;
  return { scrutins: remis.length, voix, secondsTours: descendants.length };
}

// Le nettoyage demandé. Renvoie un petit résumé de ce qui a été fait.
export async function nettoyer(sql, config, { adminId, jetonSession, action, scrutinId, promotionId }) {
  if (!ACTIONS_NETTOYAGE.includes(action)) throw new ErreurMetier('Nettoyage inconnu.');
  if (action === 'tout' && !config.donneesDemo) {
    throw new ErreurMetier('« Tout remettre comme au départ » n’existe qu’en mode démonstration.', 403);
  }

  return sql.begin(async (tx) => {
    await verifierAucunVoteOuvert(tx);
    let resume;

    if (action === 'votes_scrutin') {
      const [scrutin] = await tx`select id from scrutin where id = ${scrutinId ?? 0} for update`;
      if (!scrutin) throw new ErreurMetier('Choisissez le scrutin à remettre à zéro.', 404);
      resume = await effacerVotes(tx, [scrutin.id]);
      await noterAuJournal(tx, adminId, 'nettoyage_votes_scrutin', { scrutinId: scrutin.id, ...resume });
    }

    if (action === 'tous_les_votes') {
      // Les seconds tours seront supprimés avec leur scrutin d'origine.
      const ids = (await tx`select id from scrutin where parent_id is null for update`).map((l) => l.id);
      resume = await effacerVotes(tx, ids);
      await noterAuJournal(tx, adminId, 'nettoyage_tous_les_votes', resume);
    }

    if (action === 'codes') {
      // Les codes sont annulés, pas effacés : un étudiant qui a déjà voté
      // garde sa participation, et son nouveau code en hérite.
      const filtre = promotionId
        ? tx`and etudiant_id in (select id from etudiant where promotion_id = ${promotionId})`
        : tx``;
      const annules = await tx`
        update code_vote
        set statut = 'annule', par_nettoyage = true, annule_le = now(),
            motif_annulation = 'Annulé lors d’un nettoyage par le superviseur'
        where statut = 'actif' ${filtre}
        returning id`;
      const ids = annules.map((l) => l.id);
      if (ids.length > 0) await tx`delete from session where type = 'etudiant' and reference_id in ${tx(ids)}`;
      resume = { codes: ids.length };
      await noterAuJournal(tx, adminId, 'nettoyage_codes', { promotionId: promotionId ?? null, ...resume });
    }

    if (action === 'sessions') {
      resume = { sessions: await fermerAutresSessions(tx, jetonSession) };
      await noterAuJournal(tx, adminId, 'nettoyage_sessions', resume);
    }

    if (action === 'tout') {
      resume = await toutRemettreAuDepart(tx, config, jetonSession);
      await noterAuJournal(tx, adminId, 'nettoyage_complet', resume);
    }

    return resume;
  });
}

// « Tout remettre comme au départ » : votes, codes, listes et candidats
// reviennent à l'état de la démonstration. Les sites, facultés, promotions,
// comptes d'officiels et le journal ne changent pas.
async function toutRemettreAuDepart(tx, config, jetonSession) {
  const ids = (await tx`select id from scrutin where parent_id is null`).map((l) => l.id);
  const votes = await effacerVotes(tx, ids);
  await tx`update scrutin set mode_devoilement = 'total'`;

  const sessions = await fermerAutresSessions(tx, jetonSession);

  // Les candidats (et leurs photos), les codes et les étudiants.
  await tx`delete from candidat`;
  await tx`delete from photo`;
  await tx`delete from participation`;   // déjà vide, par sécurité
  await tx`delete from code_vote`;
  await tx`delete from etudiant`;

  // On remet la démonstration (les scrutins et leurs séances sont gardés).
  await ajouterEtudiantsDemo(tx);
  await ajouterCandidatsDemo(tx);
  await ajouterPhotosDemo(tx);
  const codes = (await creerCodesDemo(tx, config.cleSecreteCodes)) ?? 0;

  const [{ etudiants }] = await tx`select count(*)::int as etudiants from etudiant`;
  const [{ candidats }] = await tx`select count(*)::int as candidats from candidat`;
  return { ...votes, sessions, etudiants, candidats, codes };
}
