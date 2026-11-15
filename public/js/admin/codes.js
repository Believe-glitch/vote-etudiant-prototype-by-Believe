// Onglet « Remise des codes » (distributeurs).
//
// Déroulement : on retrouve l'étudiant (nom ou matricule), on vérifie sa
// carte d'étudiant, on génère le code, on le lui montre ou le lui dicte.
// Le code ne s'affiche qu'UNE fois : il n'est gardé nulle part en clair.

import { api, e, afficherMessage, formaterDateHeure } from '../commun.js';
import { confirmer, demanderTexte, montrer } from './dialogue.js';

export async function afficherCodes(conteneur) {
  const structure = await api('/api/structure');

  conteneur.innerHTML = `
    <section class="carte">
      <h2>Retrouver un étudiant</h2>
      <form id="recherche" class="grille-3">
        <div class="champ">
          <label for="texte-recherche">Nom ou matricule</label>
          <input id="texte-recherche" type="search" placeholder="ex. Kabeya ou 2026-LIN-0014" autocomplete="off">
        </div>
        <div class="champ">
          <label for="promotion-recherche">Promotion</label>
          <select id="promotion-recherche">
            <option value="">Toutes les promotions</option>
            ${structure.promotions.map((p) => `<option value="${p.id}">${e(p.libelle)}</option>`).join('')}
          </select>
        </div>
        <div class="champ">
          <label>&nbsp;</label>
          <button class="bouton bouton-large" type="submit">Chercher</button>
        </div>
      </form>
      <div id="message-codes"></div>
    </section>
    <div id="resultats-recherche" class="section"></div>`;

  const formulaire = conteneur.querySelector('#recherche');
  const zoneResultats = conteneur.querySelector('#resultats-recherche');
  const zoneMessage = conteneur.querySelector('#message-codes');
  let derniersEtudiants = [];

  async function chercher() {
    const recherche = conteneur.querySelector('#texte-recherche').value.trim();
    const promotion = conteneur.querySelector('#promotion-recherche').value;
    const parametres = new URLSearchParams();
    if (recherche) parametres.set('recherche', recherche);
    if (promotion) parametres.set('promotion', promotion);
    try {
      derniersEtudiants = await api(`/api/admin/etudiants?${parametres}`);
      afficherMessage(zoneMessage, '');
    } catch (erreur) {
      afficherMessage(zoneMessage, erreur.message);
      return;
    }
    if (derniersEtudiants.length === 0) {
      zoneResultats.innerHTML = '<p class="texte-doux">Aucun étudiant trouvé dans la liste officielle.</p>';
      return;
    }
    zoneResultats.innerHTML = `
      <div class="tableau-conteneur"><table>
        <thead><tr><th>Matricule</th><th>Nom</th><th>Promotion</th><th>Code</th><th>Action</th></tr></thead>
        <tbody>${derniersEtudiants.map((et) => `
          <tr>
            <td>${e(et.matricule)}</td>
            <td>${e(et.nomComplet)}</td>
            <td>${e(et.promotion)}</td>
            <td>${et.codeRemisLe
              ? `Remis le ${e(formaterDateHeure(et.codeRemisLe))}${et.remplacements ? ` <span class="pastille">${et.remplacements} remplacement(s)</span>` : ''}`
              : '<span class="texte-doux">Pas encore remis</span>'}</td>
            <td>${et.codeRemisLe
              ? `<button class="bouton bouton-contour bouton-petit" data-action="remplacer" data-id="${et.id}" type="button">Remplacer (perdu)</button>`
              : `<button class="bouton bouton-accent bouton-petit" data-action="generer" data-id="${et.id}" type="button">Générer le code</button>`}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${derniersEtudiants.length === 50 ? '<p class="texte-doux petit">50 premiers résultats : précisez la recherche.</p>' : ''}`;
  }

  formulaire.addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    chercher();
  });

  zoneResultats.addEventListener('click', async (evenement) => {
    const bouton = evenement.target.closest('[data-action]');
    if (!bouton) return;
    const etudiant = derniersEtudiants.find((et) => et.id === Number(bouton.dataset.id));
    const identite = `<strong>${e(etudiant.nomComplet)}</strong> (matricule ${e(etudiant.matricule)}, ${e(etudiant.promotion)})`;

    let code;
    try {
      if (bouton.dataset.action === 'generer') {
        const ok = await confirmer({
          titre: 'Vérifier l’identité',
          texte: `Avez-vous vérifié la carte d’étudiant de ${identite} ? L’étudiant doit être présent en personne.`,
          bouton: 'Oui, générer son code',
        });
        if (!ok) return;
        ({ code } = await api(`/api/admin/etudiants/${etudiant.id}/code`, { methode: 'POST' }));
      } else {
        const motif = await demanderTexte({
          titre: 'Remplacer un code perdu',
          texte: `L’ancien code de ${identite} sera annulé. Les votes déjà faits avec lui restent comptés. Vérifiez sa carte d’étudiant.`,
          etiquette: 'Motif (ex. « code perdu »)',
          bouton: 'Annuler l’ancien et générer',
        });
        if (!motif) return;
        ({ code } = await api(`/api/admin/etudiants/${etudiant.id}/remplacer-code`, { methode: 'POST', corps: { motif } }));
      }
    } catch (erreur) {
      afficherMessage(zoneMessage, erreur.message);
      return;
    }

    await montrer(`
      <h2>Code de ${e(etudiant.nomComplet)}</h2>
      <p class="code-affiche">${e(code)}</p>
      <p>Montrez ou dictez ce code à l’étudiant, qui le recopie. <strong>Il ne sera plus jamais affiché</strong>, ni ici ni ailleurs.</p>`, 'Le code est remis');
    chercher();
  });
}
