// Outils partagés par toutes les pages.

// Appelle l'API du serveur et renvoie la réponse (objet JavaScript).
// En cas d'erreur, lance une Error dont le message est celui du serveur,
// et dont .statut est le code HTTP (401, 409…).
export async function api(adresse, { methode = 'GET', corps, entetes = {} } = {}) {
  const options = { method: methode, headers: { ...entetes }, credentials: 'same-origin' };
  if (corps instanceof Blob) {
    options.body = corps;
  } else if (methode !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(corps ?? {});
  }

  let reponse;
  try {
    reponse = await fetch(adresse, options);
  } catch {
    const erreur = new Error('Connexion impossible. Vérifiez votre connexion Internet et réessayez.');
    erreur.statut = 0;
    throw erreur;
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const erreur = new Error(donnees.erreur ?? `Erreur ${reponse.status}`);
    erreur.statut = reponse.status;
    throw erreur;
  }
  return donnees;
}

// Protège un texte avant de l'insérer dans la page : un nom de candidat
// contenant du code HTML s'affichera comme du texte, sans s'exécuter.
export function e(texte) {
  return String(texte ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function initiales(nom) {
  return String(nom ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0].toUpperCase())
    .join('');
}

// Photo du candidat, ou ses initiales s'il n'en a pas.
export function photoCandidat(candidat, classe = '') {
  if (candidat.photoId) {
    return `<img class="photo ${classe}" src="/api/photos/${candidat.photoId}" alt="Photo de ${e(candidat.nom)}" loading="lazy" width="64" height="64">`;
  }
  return `<div class="photo photo-initiales ${classe}" aria-hidden="true">${e(initiales(candidat.nom))}</div>`;
}

export function afficherMessage(element, texte, type = 'erreur') {
  element.innerHTML = texte ? `<div class="message message-${type}" role="alert">${e(texte)}</div>` : '';
}

export function pourcentage(partie, total) {
  return total > 0 ? Math.round((partie / total) * 100) : 0;
}

export function formaterDateHeure(dateTexte) {
  return new Date(dateTexte).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ---------------------------------------------------------------------
// Horloge calée sur le serveur
// ---------------------------------------------------------------------
// L'heure des téléphones est souvent décalée de quelques minutes. On mesure
// l'écart avec l'heure du serveur, et tous les décomptes utilisent l'heure
// du serveur. C'est de toute façon lui qui décide de la fin du vote.

let ecartServeur = 0;

export function caleHorloge(maintenantServeur) {
  if (maintenantServeur) ecartServeur = new Date(maintenantServeur).getTime() - Date.now();
}

export function secondesRestantes(fin) {
  return Math.max(0, Math.floor((new Date(fin).getTime() - (Date.now() + ecartServeur)) / 1000));
}

export function formaterDuree(secondes) {
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  const s = secondes % 60;
  const deux = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${deux(m)}:${deux(s)}` : `${deux(m)}:${deux(s)}`;
}

// Met à jour tous les éléments qui portent data-fin="…" (le décompte).
export function rafraichirDecomptes() {
  for (const element of document.querySelectorAll('[data-fin]')) {
    const reste = secondesRestantes(element.dataset.fin);
    element.textContent = reste > 0 ? formaterDuree(reste) : 'Terminé';
  }
}

// … et recommence chaque seconde.
export function lancerDecomptes() {
  rafraichirDecomptes();
  setInterval(rafraichirDecomptes, 1000);
}

// ---------------------------------------------------------------------
// Le direct
// ---------------------------------------------------------------------
// Ouvre la connexion au direct et appelle "quandEtat" à chaque nouvel état.
// Le navigateur se reconnecte tout seul si la connexion coupe.
export function ecouterDirect(quandEtat) {
  const source = new EventSource('/api/direct');
  source.addEventListener('etat', (evenement) => {
    const etat = JSON.parse(evenement.data);
    caleHorloge(etat.maintenant);
    quandEtat(etat);
  });
  return source;
}

// Bloc "vote en cours" : décompte + participation.
export function blocSeance(seance) {
  const pourcent = pourcentage(seance.votants, seance.inscrits);
  const ouverte = seance.statut === 'ouverte';
  return `
    <div class="ligne-flex">
      <span class="pastille ${ouverte ? 'pastille-ouvert' : 'pastille-ferme'}">${ouverte ? 'Vote ouvert' : 'Vote fermé'}</span>
      ${ouverte ? `<span class="decompte" data-fin="${e(seance.fin)}">--:--</span>` : ''}
    </div>
    <p class="petit">${seance.votants} votant${seance.votants > 1 ? 's' : ''} sur ${seance.inscrits} inscrits (${pourcent} %)</p>
    <div class="jauge" role="img" aria-label="Participation : ${pourcent} %">
      <div class="jauge-remplissage" data-largeur="${pourcent}"></div>
    </div>`;
}

// Les largeurs sont posées en JavaScript (et non dans le HTML) pour
// respecter la politique de sécurité du site, qui interdit le style "en ligne".
// On en profite pour mettre tout de suite les décomptes à l'heure.
export function appliquerLargeurs(racine = document) {
  for (const element of racine.querySelectorAll('[data-largeur]')) {
    element.style.width = `${element.dataset.largeur}%`;
  }
  rafraichirDecomptes();
}

// Marque le lien de la page courante dans le menu.
export function marquerPageCourante() {
  const chemin = location.pathname.replace(/\.html$/, '').replace(/\/$/, '/index');
  for (const lien of document.querySelectorAll('.navigation a')) {
    const cible = new URL(lien.href).pathname.replace(/\.html$/, '').replace(/\/$/, '/index');
    if (cible === chemin) lien.setAttribute('aria-current', 'page');
  }
  ajouterLienMesVotes();
}

// --- L'étudiant connecté ------------------------------------------------------
// Une seule demande au serveur par page, partagée par tous ceux qui en ont besoin.
let sessionEnCours = null;
export function sessionEtudiant() {
  if (!sessionEnCours) sessionEnCours = api('/api/etudiant/session').catch(() => ({ connecte: false }));
  return sessionEnCours;
}

// Quand l'étudiant est connecté, « Mes votes » apparaît en premier dans le
// menu, avec le nombre de votes qui l'attendent (ouverts, pas encore votés).
async function ajouterLienMesVotes() {
  const liens = document.querySelector('.navigation-liens');
  if (!liens) return;
  const session = await sessionEtudiant();
  if (!session.connecte || liens.querySelector('.lien-mes-votes')) return;
  const lien = document.createElement('a');
  lien.href = '/voter';
  lien.className = 'lien-mes-votes';
  lien.textContent = 'Mes votes';
  if (session.votesAFaire > 0) {
    const compteur = document.createElement('span');
    compteur.className = 'compteur-votes';
    compteur.textContent = String(session.votesAFaire);
    compteur.title = `${session.votesAFaire} vote${session.votesAFaire > 1 ? 's' : ''} vous attend${session.votesAFaire > 1 ? 'ent' : ''}`;
    lien.append(' ', compteur);
  }
  if (location.pathname.replace(/\.html$/, '') === '/voter') lien.setAttribute('aria-current', 'page');
  liens.prepend(lien);
}
