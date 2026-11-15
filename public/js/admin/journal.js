// Onglet « Journal » : les dernières actions des officiels.
// Ce journal ne peut être ni modifié ni effacé (la base l'interdit).

import { api, e, formaterDateHeure } from '../commun.js';

const ACTIONS = {
  connexion_officiel: 'Connexion à l’espace officiels',
  code_remis: 'Code remis à un étudiant',
  code_remplace: 'Code remplacé',
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
};

// Résumé lisible des détails (sans jargon technique).
function resume(details) {
  const morceaux = [];
  if (details.matricule) morceaux.push(`matricule ${details.matricule}`);
  if (details.nom) morceaux.push(details.nom);
  if (details.motif) morceaux.push(`motif : ${details.motif}`);
  if (details.dureeMinutes) morceaux.push(`${details.dureeMinutes} min`);
  if (details.minutes) morceaux.push(`+${details.minutes} min`);
  if (details.mode) morceaux.push(details.mode === 'total' ? 'total seulement' : 'par site');
  if (details.scrutinId) morceaux.push(`scrutin n° ${details.scrutinId}`);
  return morceaux.join(' · ');
}

export async function afficherJournal(conteneur) {
  const lignes = await api('/api/admin/journal');
  conteneur.innerHTML = `
    <p class="texte-doux">Les 300 dernières actions. Aucun code ni aucun choix de vote n’y figure.</p>
    <div class="tableau-conteneur"><table>
      <thead><tr><th>Date et heure</th><th>Officiel</th><th>Action</th><th>Détails</th></tr></thead>
      <tbody>${lignes.map((l) => `
        <tr>
          <td>${e(formaterDateHeure(l.le))}</td>
          <td>${e(l.officiel)}</td>
          <td>${e(ACTIONS[l.action] ?? l.action)}</td>
          <td class="petit">${e(resume(l.details))}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}
