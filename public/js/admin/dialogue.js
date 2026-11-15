// Petites fenêtres de dialogue de l'espace officiels : confirmation,
// saisie d'un texte, affichage d'un contenu.

import { e } from '../commun.js';

const dialogue = document.querySelector('#dialogue');
const contenu = document.querySelector('#dialogue-contenu');

function ouvrir(html) {
  contenu.innerHTML = html;
  dialogue.showModal();
}

// Demande une confirmation. Renvoie true si l'officiel confirme.
export function confirmer({ titre, texte, bouton = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    ouvrir(`
      <h2>${e(titre)}</h2>
      <p>${texte}</p>
      <div class="rangee-boutons">
        <button class="bouton ${danger ? 'bouton-danger' : 'bouton-accent'}" data-reponse="oui" type="button">${e(bouton)}</button>
        <button class="bouton bouton-contour" data-reponse="non" type="button">Annuler</button>
      </div>`);
    contenu.querySelector('[data-reponse="oui"]').addEventListener('click', () => { dialogue.close(); resolve(true); }, { once: true });
    contenu.querySelector('[data-reponse="non"]').addEventListener('click', () => { dialogue.close(); resolve(false); }, { once: true });
    dialogue.addEventListener('cancel', () => resolve(false), { once: true });
  });
}

// Demande un texte (ex. le motif d'un remplacement). Renvoie le texte, ou null.
export function demanderTexte({ titre, texte, etiquette, bouton = 'Valider' }) {
  return new Promise((resolve) => {
    ouvrir(`
      <h2>${e(titre)}</h2>
      <p>${texte}</p>
      <form id="formulaire-dialogue">
        <div class="champ">
          <label for="saisie-dialogue">${e(etiquette)}</label>
          <input id="saisie-dialogue" type="text" maxlength="200" required>
        </div>
        <div class="rangee-boutons">
          <button class="bouton bouton-accent" type="submit">${e(bouton)}</button>
          <button class="bouton bouton-contour" data-reponse="non" type="button">Annuler</button>
        </div>
      </form>`);
    const champ = contenu.querySelector('#saisie-dialogue');
    champ.focus();
    contenu.querySelector('#formulaire-dialogue').addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      const valeur = champ.value.trim();
      if (!valeur) return;
      dialogue.close();
      resolve(valeur);
    }, { once: true });
    contenu.querySelector('[data-reponse="non"]').addEventListener('click', () => { dialogue.close(); resolve(null); }, { once: true });
    dialogue.addEventListener('cancel', () => resolve(null), { once: true });
  });
}

// Affiche un contenu avec un bouton pour fermer.
export function montrer(html, boutonFermer = 'Fermer') {
  return new Promise((resolve) => {
    ouvrir(`${html}
      <div class="rangee-boutons section">
        <button class="bouton" data-reponse="fermer" type="button">${e(boutonFermer)}</button>
      </div>`);
    contenu.querySelector('[data-reponse="fermer"]').addEventListener('click', () => { dialogue.close(); resolve(); }, { once: true });
    dialogue.addEventListener('cancel', () => resolve(), { once: true });
  });
}
