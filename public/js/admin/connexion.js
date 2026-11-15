// Connexion à l'espace officiels.

import { api, afficherMessage } from '../commun.js';

const formulaire = document.querySelector('#formulaire-connexion');
const zoneMessage = document.querySelector('#message');

// Déjà connecté ? On va directement au tableau de bord.
api('/api/admin/session')
  .then(({ connecte }) => { if (connecte) location.href = '/admin/tableau'; })
  .catch(() => {});

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const identifiant = document.querySelector('#identifiant').value.trim();
  const motDePasse = document.querySelector('#mot-de-passe').value;
  if (!identifiant || !motDePasse) {
    afficherMessage(zoneMessage, 'Entrez votre identifiant et votre mot de passe.');
    return;
  }
  const bouton = formulaire.querySelector('button');
  bouton.disabled = true;
  try {
    await api('/api/admin/connexion', { methode: 'POST', corps: { identifiant, motDePasse } });
    location.href = '/admin/tableau';
  } catch (erreur) {
    afficherMessage(zoneMessage, erreur.message);
    bouton.disabled = false;
  }
});
