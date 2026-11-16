// Onglet « Journal » : les dernières actions des officiels.
// Ce journal ne peut être ni modifié ni effacé (la base l'interdit).

import { api, e, formaterDateHeure } from '../commun.js';

const ACTIONS = {
  connexion_officiel: 'Connexion à l’espace officiels',
  code_remis: 'Code remis à un étudiant',
  etudiant_inscrit_code_remis: 'Étudiant inscrit et code remis',
  donnees_demo_codes: 'Codes de démonstration créés',
  code_remplace: 'Code remplacé',
  code_annule: 'Code annulé',
  etudiant_corrige: 'Nom d’un étudiant corrigé',
  etudiant_change_promotion: 'Étudiant changé de promotion',
  etudiant_retire: 'Étudiant retiré de la liste',
  candidat_ajoute: 'Candidat ajouté',
  candidat_retire: 'Candidat retiré',
  photo_candidat_changee: 'Photo de candidat changée',
  mode_devoilement_choisi: 'Mode de dévoilement choisi',
  vote_ouvert: 'Vote ouvert',
  vote_prolonge: 'Vote prolongé',
  vote_ferme_manuellement: 'Vote fermé par le superviseur',
  vote_ferme_fin_du_temps: 'Vote fermé (fin du décompte)',
  resultats_site_devoiles: 'Résultats d’un site dévoilés',
  resultats_devoiles: 'Résultats dévoilés',
  elu_d_office: 'Candidat élu d’office',
  second_tour_cree: 'Second tour créé',
  nettoyage_votes_scrutin: 'Nettoyage : votes d’un scrutin effacés',
  nettoyage_tous_les_votes: 'Nettoyage : tous les votes effacés',
  nettoyage_codes: 'Nettoyage : codes annulés',
  nettoyage_sessions: 'Nettoyage : tout le monde déconnecté',
  nettoyage_complet: 'Nettoyage : tout remis comme au départ',
};

// Résumé lisible des détails (sans jargon technique).
function resume(details, nomsSites) {
  const morceaux = [];
  if (details.avant) morceaux.push(`avant : ${details.avant}`);
  if (details.nom) morceaux.push(details.avant ? `après : ${details.nom}` : details.nom);
  if (details.nouvellePromotion) morceaux.push(`vers ${details.nouvellePromotion}`);
  if (details.matricule) morceaux.push(`matricule ${details.matricule}`);
  if (details.campusId && nomsSites.has(details.campusId)) morceaux.push(`site de ${nomsSites.get(details.campusId)}`);
  if (details.motif) morceaux.push(`motif : ${details.motif}`);
  if (details.dureeMinutes) morceaux.push(`${details.dureeMinutes} min`);
  if (details.minutes) morceaux.push(`+${details.minutes} min`);
  if (details.mode) morceaux.push(details.mode === 'total' ? 'total seulement' : 'par site');
  if (details.scrutinId) morceaux.push(`scrutin n° ${details.scrutinId}`);
  // Résumé d'un nettoyage
  if (details.voix !== undefined) morceaux.push(`${details.voix} voix effacée${details.voix > 1 ? 's' : ''}`);
  if (details.secondsTours) morceaux.push(`${details.secondsTours} second${details.secondsTours > 1 ? 's' : ''} tour${details.secondsTours > 1 ? 's' : ''} supprimé${details.secondsTours > 1 ? 's' : ''}`);
  if (details.codes !== undefined) morceaux.push(`${details.codes} code${details.codes > 1 ? 's' : ''}`);
  if (details.sessions !== undefined) morceaux.push(`${details.sessions} session${details.sessions > 1 ? 's' : ''} fermée${details.sessions > 1 ? 's' : ''}`);
  if (details.etudiants !== undefined) morceaux.push(`${details.etudiants} étudiants, ${details.candidats} candidats`);
  return morceaux.join(' · ');
}

// Une date choisie dans le formulaire (heure locale) → format attendu par le serveur.
function enIso(valeur) {
  return valeur ? new Date(valeur).toISOString() : '';
}

export async function afficherJournal(conteneur) {
  const [structure, officiels] = await Promise.all([api('/api/structure'), api('/api/admin/officiels')]);
  const nomsSites = new Map(structure.campus.map((c) => [c.id, c.nom]));

  conteneur.innerHTML = `
    <form id="filtres-journal" class="carte carte-simple filtres" role="search" aria-label="Filtrer le journal">
      <h2 class="petit-titre">Rechercher dans le journal</h2>
      <div class="grille-filtres">
        <div class="champ champ-large"><label for="j-recherche">Mot cherché</label>
          <input id="j-recherche" type="search" placeholder="ex. Matondo, code perdu, 2026-LIN-0014" autocomplete="off"></div>
        <div class="champ"><label for="j-action">Action</label>
          <select id="j-action"><option value="">Toutes les actions</option>
            ${Object.entries(ACTIONS).map(([cle, texte]) => `<option value="${cle}">${e(texte)}</option>`).join('')}
          </select></div>
        <div class="champ"><label for="j-officiel">Officiel</label>
          <select id="j-officiel"><option value="">Tous</option>
            ${officiels.map((o) => `<option value="${o.id}">${e(o.nomComplet)}</option>`).join('')}
            <option value="auto">Le serveur (automatique)</option>
          </select></div>
        <div class="champ"><label for="j-site">Site</label>
          <select id="j-site"><option value="">Les deux sites</option>
            ${structure.campus.map((c) => `<option value="${c.id}">${e(c.nom)}</option>`).join('')}
          </select></div>
        <div class="champ"><label for="j-du">Du</label><input id="j-du" type="datetime-local"></div>
        <div class="champ"><label for="j-au">Au</label><input id="j-au" type="datetime-local"></div>
      </div>
      <div class="ligne-flex">
        <p id="j-compte" class="texte-doux petit" aria-live="polite"></p>
        <button id="j-effacer" class="bouton bouton-contour bouton-petit" type="button">Effacer les filtres</button>
      </div>
      <p class="texte-doux petit">Les codes de vote ne sont jamais écrits dans le journal : pour suivre un code, cherchez le nom de l’étudiant.</p>
    </form>
    <div id="j-message"></div>
    <div id="j-tableau" class="section"></div>`;

  const champs = ['recherche', 'action', 'officiel', 'site', 'du', 'au'].map((n) => conteneur.querySelector(`#j-${n}`));
  const [recherche, action, officiel, site, du, au] = champs;
  const zoneTableau = conteneur.querySelector('#j-tableau');
  const zoneCompte = conteneur.querySelector('#j-compte');
  let demande = 0;

  async function charger() {
    const numero = ++demande;
    const parametres = new URLSearchParams();
    if (recherche.value.trim()) parametres.set('recherche', recherche.value.trim());
    if (action.value) parametres.set('action', action.value);
    if (officiel.value) parametres.set('officiel', officiel.value);
    if (site.value) parametres.set('campus', site.value);
    if (du.value) parametres.set('du', enIso(du.value));
    if (au.value) parametres.set('au', enIso(au.value));
    let reponse;
    try {
      reponse = await api(`/api/admin/journal?${parametres}`);
    } catch (erreur) {
      conteneur.querySelector('#j-message').innerHTML = `<div class="message message-erreur">${e(erreur.message)}</div>`;
      return;
    }
    if (numero !== demande) return;   // une recherche plus récente est déjà partie
    conteneur.querySelector('#j-message').innerHTML = '';
    const { total, lignes } = reponse;
    zoneCompte.textContent = total === 0 ? 'Aucune action trouvée.'
      : `${total} action${total > 1 ? 's' : ''} trouvée${total > 1 ? 's' : ''}${total > lignes.length ? ` · les ${lignes.length} plus récentes sont affichées` : ''}`;
    zoneTableau.innerHTML = lignes.length === 0 ? '' : `
      <div class="tableau-conteneur"><table>
        <thead><tr><th>Date et heure</th><th>Officiel</th><th>Action</th><th>Détails</th></tr></thead>
        <tbody>${lignes.map((l) => `
          <tr>
            <td>${e(formaterDateHeure(l.le))}</td>
            <td>${e(l.officiel)}</td>
            <td>${e(ACTIONS[l.action] ?? l.action)}</td>
            <td class="petit">${e(resume(l.details, nomsSites))}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  // On relance la recherche à chaque changement ; pour le texte, on attend
  // que l'officiel ait fini de taper (0,3 seconde).
  let minuterie;
  recherche.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(charger, 300); });
  for (const champ of [action, officiel, site, du, au]) champ.addEventListener('change', charger);
  conteneur.querySelector('#filtres-journal').addEventListener('submit', (evenement) => { evenement.preventDefault(); charger(); });
  conteneur.querySelector('#j-effacer').addEventListener('click', () => {
    for (const champ of champs) champ.value = '';
    charger();
  });

  await charger();
}
