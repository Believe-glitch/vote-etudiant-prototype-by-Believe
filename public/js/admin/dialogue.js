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

// Confirmation renforcée d'un nettoyage : l'officiel retape son mot de passe
// et écrit le mot demandé (EFFACER). Renvoie { motDePasse, confirmation }, ou null.
export function confirmerNettoyage({ titre, texte, mot = 'EFFACER' }) {
  return new Promise((resolve) => {
    ouvrir(`
      <h2>${e(titre)}</h2>
      <p>${texte}</p>
      <form id="formulaire-nettoyage" novalidate>
        <div class="champ">
          <label for="mdp-nettoyage">Votre mot de passe</label>
          <input id="mdp-nettoyage" type="password" autocomplete="current-password" maxlength="200" required>
        </div>
        <div class="champ">
          <label for="mot-nettoyage">Écrivez <strong>${e(mot)}</strong> pour confirmer</label>
          <input id="mot-nettoyage" type="text" autocomplete="off" autocapitalize="characters" maxlength="20" required>
        </div>
        <div class="rangee-boutons">
          <button class="bouton bouton-danger" type="submit" disabled>Nettoyer</button>
          <button class="bouton bouton-contour" data-reponse="non" type="button">Annuler</button>
        </div>
      </form>`);
    const formulaire = contenu.querySelector('#formulaire-nettoyage');
    const motDePasse = contenu.querySelector('#mdp-nettoyage');
    const confirmation = contenu.querySelector('#mot-nettoyage');
    const bouton = formulaire.querySelector('[type="submit"]');
    // Le bouton ne s'active que quand le mot est bien écrit.
    const verifier = () => {
      bouton.disabled = !(motDePasse.value && confirmation.value.trim().toUpperCase() === mot);
    };
    motDePasse.addEventListener('input', verifier);
    confirmation.addEventListener('input', verifier);
    motDePasse.focus();
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      if (bouton.disabled) return;
      dialogue.close();
      resolve({ motDePasse: motDePasse.value, confirmation: confirmation.value.trim().toUpperCase() });
    });
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
