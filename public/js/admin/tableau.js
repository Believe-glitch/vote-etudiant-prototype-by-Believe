// Tableau de bord des officiels. Les onglets affichés dépendent du rôle :
//   distributeur : Inscription et codes, Statistiques
//   superviseur  : Votes, Listes des inscrits, Statistiques, Journal
//   observateur  : les mêmes, en lecture seule
// Le serveur vérifie de toute façon le rôle à chaque action.

import { api, e, afficherMessage, lancerDecomptes } from '../commun.js';
import { afficherListes } from './codes.js';
import { afficherVotes } from './votes.js';
import { afficherStatistiques } from './statistiques.js';
import { afficherJournal } from './journal.js';

const ONGLETS = {
  codes: { titre: 'Inscription et codes', roles: ['distributeur'], afficher: afficherListes },
  votes: { titre: 'Votes', roles: ['superviseur', 'observateur'], afficher: afficherVotes },
  listes: { titre: 'Listes des inscrits', roles: ['superviseur', 'observateur'], afficher: afficherListes },
  statistiques: { titre: 'Statistiques', roles: ['distributeur', 'superviseur', 'observateur'], afficher: afficherStatistiques },
  journal: { titre: 'Journal', roles: ['superviseur', 'observateur'], afficher: afficherJournal },
};
const NOMS_ROLES = { superviseur: 'Superviseur', distributeur: 'Distributeur', observateur: 'Observateur' };

const zoneOnglets = document.querySelector('#onglets');
const zoneContenu = document.querySelector('#contenu');
const zoneMessage = document.querySelector('#message-general');

let moi;
let arreterOngletCourant = null;   // certains onglets écoutent le direct : on l'arrête en changeant d'onglet

async function demarrer() {
  try {
    moi = await api('/api/admin/moi');
  } catch {
    location.href = '/admin/';
    return;
  }
  document.querySelector('#qui').textContent = `${moi.nomComplet} · ${NOMS_ROLES[moi.role]}`;
  lancerDecomptes();

  const mesOnglets = Object.entries(ONGLETS).filter(([, o]) => o.roles.includes(moi.role));
  zoneOnglets.innerHTML = mesOnglets
    .map(([cle, o]) => `<button class="onglet" role="tab" type="button" data-onglet="${cle}">${e(o.titre)}</button>`)
    .join('');
  zoneOnglets.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('[data-onglet]');
    if (bouton) location.hash = bouton.dataset.onglet;
  });

  window.addEventListener('hashchange', () => ouvrirOnglet(mesOnglets));
  ouvrirOnglet(mesOnglets);
}

async function ouvrirOnglet(mesOnglets) {
  const demande = location.hash.slice(1);
  const [cle, onglet] = mesOnglets.find(([c]) => c === demande) ?? mesOnglets[0];
  for (const bouton of zoneOnglets.querySelectorAll('[data-onglet]')) {
    bouton.setAttribute('aria-selected', String(bouton.dataset.onglet === cle));
  }
  if (arreterOngletCourant) arreterOngletCourant();
  arreterOngletCourant = null;
  afficherMessage(zoneMessage, '');
  zoneContenu.innerHTML = '<p class="texte-doux">Chargement…</p>';
  try {
    arreterOngletCourant = (await onglet.afficher(zoneContenu, moi)) ?? null;
  } catch (erreur) {
    if (erreur.statut === 401) {
      location.href = '/admin/';
      return;
    }
    afficherMessage(zoneMessage, erreur.message);
  }
}

document.querySelector('#deconnexion').addEventListener('click', async () => {
  await api('/api/admin/deconnexion', { methode: 'POST' }).catch(() => {});
  location.href = '/admin/';
});

demarrer();
