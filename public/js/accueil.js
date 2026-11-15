// Page d'accueil : connexion avec le code, et votes en cours en direct.

import { api, e, afficherMessage, ecouterDirect, blocSeance, appliquerLargeurs, lancerDecomptes, marquerPageCourante } from './commun.js';

marquerPageCourante();
lancerDecomptes();

const formulaire = document.querySelector('#formulaire-code');
const champCode = document.querySelector('#code');
const zoneMessage = document.querySelector('#message-code');

// Si l'étudiant est déjà connecté, on lui propose d'aller directement à ses votes.
api('/api/etudiant/session')
  .then(({ connecte }) => {
    if (!connecte) return;
    document.querySelector('#deja-connecte').classList.remove('cache');
    formulaire.classList.add('cache');
  })
  .catch(() => { /* en cas de souci, on laisse simplement le formulaire */ });

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const code = champCode.value.trim();
  if (!code) {
    afficherMessage(zoneMessage, 'Entrez votre code de vote.');
    return;
  }
  const bouton = formulaire.querySelector('button');
  bouton.disabled = true;
  afficherMessage(zoneMessage, '');
  try {
    await api('/api/etudiant/connexion', { methode: 'POST', corps: { code } });
    location.href = '/voter';
  } catch (erreur) {
    afficherMessage(zoneMessage, erreur.message);
    bouton.disabled = false;
    champCode.focus();
  }
});

// Votes en cours, mis à jour en direct.
const zoneVotes = document.querySelector('#votes-en-cours');
ecouterDirect((etat) => {
  const ouvertes = etat.seances.filter((s) => s.statut === 'ouverte');
  if (ouvertes.length === 0) {
    zoneVotes.innerHTML = '<p class="texte-doux">Aucun vote n’est ouvert en ce moment.</p>';
    return;
  }
  zoneVotes.innerHTML = ouvertes.map((s) => `
    <article class="carte">
      <h3>${e(s.nomPoste)}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}</h3>
      <p class="texte-doux petit">${e(s.promotion ?? 'Toute l’université')} · séance de ${e(s.campus)}</p>
      ${blocSeance(s)}
    </article>`).join('');
  appliquerLargeurs(zoneVotes);
});
