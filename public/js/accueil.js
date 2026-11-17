// Page d'accueil : connexion avec le code, et votes en cours en direct.

import {
  api, e, afficherMessage, ecouterDirect, blocSeance, appliquerLargeurs, lancerDecomptes, marquerPageCourante,
  sessionEtudiant,
} from './commun.js';

marquerPageCourante();
lancerDecomptes();

const formulaire = document.querySelector('#formulaire-code');
const champCode = document.querySelector('#code');
const zoneMessage = document.querySelector('#message-code');

// Si l'étudiant est déjà connecté, on lui propose d'aller directement à ses
// votes, en lui disant combien l'attendent.
let moiEtudiant = null;
sessionEtudiant().then((session) => {
  if (!session.connecte) return;
  moiEtudiant = session;
  const bloc = document.querySelector('#deja-connecte');
  bloc.querySelector('p').textContent = session.votesAFaire > 0
    ? `Vous êtes connecté (${session.promotion}). ${session.votesAFaire} vote${session.votesAFaire > 1 ? 's vous attendent' : ' vous attend'}.`
    : `Vous êtes connecté (${session.promotion}).`;
  bloc.classList.remove('cache');
  formulaire.classList.add('cache');
  if (dernierEtat) afficherVotes(dernierEtat);   // ses votes passent en premier
});

// --- Les tirets se placent tout seuls ---------------------------------------
// L'étudiant tape « L2INFLINQVM355 », le champ affiche « L2INF-LIN-QVM355 ».
// Un code = niveau (2) + faculté (3), puis le site, puis la partie secrète (6).
// Les sites n'ont pas tous la même longueur (LIN, NDJI) : on les reconnaît
// grâce à la liste des sites de l'université.
let siglesSites = ['NDJI', 'LIN'];
api('/api/structure')
  .then((structure) => {
    // Du plus long au plus court, pour reconnaître « NDJI » avant un éventuel « ND ».
    siglesSites = structure.campus.map((c) => c.sigle.toUpperCase()).sort((a, b) => b.length - a.length);
  })
  .catch(() => { /* on garde la liste par défaut */ });

export function mettreEnFormeCode(saisie, sigles = siglesSites) {
  const brut = String(saisie).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const debut = brut.slice(0, 5);          // ex. L2INF
  const reste = brut.slice(5);             // ex. LINQVM355
  if (!reste) return debut;
  const site = sigles.find((s) => reste.startsWith(s));
  if (!site) return `${debut}-${reste}`;   // site pas encore complet : on attend
  const secret = reste.slice(site.length);
  return secret ? `${debut}-${site}-${secret}` : `${debut}-${site}`;
}

// Retour arrière juste après un tiret : on efface aussi le caractère d'avant,
// sinon le tiret effacé reviendrait aussitôt et l'étudiant resterait bloqué.
champCode.addEventListener('keydown', (evenement) => {
  if (evenement.key !== 'Backspace') return;
  const { selectionStart: debut, selectionEnd: fin, value } = champCode;
  if (debut !== fin || debut < 2 || value[debut - 1] !== '-') return;
  evenement.preventDefault();
  champCode.value = mettreEnFormeCode(value.slice(0, debut - 2) + value.slice(debut));
  const curseur = Math.min(debut - 2, champCode.value.length);
  champCode.setSelectionRange(curseur, curseur);
});

champCode.addEventListener('input', () => {
  // On garde le curseur au même endroit : on compte les lettres et chiffres
  // avant lui, puis on le replace après le même nombre dans le texte mis en forme.
  const position = champCode.selectionStart ?? champCode.value.length;
  const avant = champCode.value.slice(0, position).replace(/[^A-Za-z0-9]/g, '').length;
  const nouveau = mettreEnFormeCode(champCode.value);
  if (nouveau === champCode.value) return;
  champCode.value = nouveau;
  let compte = 0, curseur = 0;
  while (curseur < nouveau.length && compte < avant) {
    if (/[A-Z0-9]/.test(nouveau[curseur])) compte++;
    curseur++;
  }
  champCode.setSelectionRange(curseur, curseur);
});

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
// L'accueil ne montre qu'un APERÇU : les 3 votes qui se ferment le plus tôt
// (les plus urgents). Les autres sont sur la page Résultats, avec des filtres.
const APERCU = 3;
const zoneVotes = document.querySelector('#votes-en-cours');
const zoneTous = document.querySelector('#tous-les-votes');
let dernierEtat = null;
ecouterDirect((etat) => {
  dernierEtat = etat;
  afficherVotes(etat);
});

// Un vote « le concerne » : sa promotion ou la présidence, sur son site.
const meConcerne = (s) => moiEtudiant !== null && s.campusId === moiEtudiant.campusId
  && (s.promotionId === moiEtudiant.promotionId || s.promotionId === null);

function afficherVotes(etat) {
  const ouvertes = etat.seances
    .filter((s) => s.statut === 'ouverte')
    // D'abord ceux qui le concernent (étudiant connecté), puis les plus urgents.
    .sort((a, b) => Number(meConcerne(b)) - Number(meConcerne(a)) || new Date(a.fin) - new Date(b.fin));
  if (ouvertes.length === 0) {
    zoneVotes.innerHTML = '<p class="texte-doux">Aucun vote n’est ouvert en ce moment.</p>';
    zoneTous.innerHTML = '';
    return;
  }
  zoneVotes.innerHTML = ouvertes.slice(0, APERCU).map((s) => `
    <article class="carte">
      <div class="ligne-flex"><h3>${e(s.nomPoste)}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}</h3>
        ${meConcerne(s) ? '<span class="pastille pastille-devoile">Pour vous</span>' : ''}</div>
      <p class="texte-doux petit">${e(s.promotion ?? 'Toute l’université')} · séance de ${e(s.campus)}</p>
      ${blocSeance(s)}
    </article>`).join('');
  zoneTous.innerHTML = ouvertes.length > APERCU
    ? `<a class="bouton bouton-contour" href="/resultats#en-cours">Voir tous les votes en cours (${ouvertes.length}) →</a>
       <span class="petit texte-doux">avec un filtre par site, faculté, promotion et poste</span>`
    : '';
  appliquerLargeurs(zoneVotes);
}
