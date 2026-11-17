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
  if (new URLSearchParams(location.search).get('connecte')) {
    afficherMessage(document.querySelector('#message-connecte'), 'Connexion réussie. Bienvenue !', 'ok');
    history.replaceState(null, '', '/');
  }
  if (dernierEtat) afficherVotes(dernierEtat);   // ses votes passent en premier
});

// --- Les tirets se placent tout seuls ---------------------------------------
// Comme dans un champ de carte bancaire : dès qu'une partie est complète, le
// tiret apparaît tout seul. L'étudiant tape « L2INF », le champ affiche
// « L2INF- » ; il continue « LIN » → « L2INF-LIN- » ; puis les 6 caractères.
// Un code = niveau (2) + faculté (3), puis le site (LIN ou NDJI), puis 6 caractères.
const SECRET = 6;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // pas de 0, O, 1, I ni L
let siglesSites = ['NDJI', 'LIN'];
let siglesFacultes = [];
api('/api/structure')
  .then((structure) => {
    // Du plus long au plus court, pour reconnaître « NDJI » avant un éventuel « ND ».
    siglesSites = structure.campus.map((c) => c.sigle.toUpperCase()).sort((a, b) => b.length - a.length);
    siglesFacultes = structure.facultes.map((f) => f.sigle.toUpperCase());
  })
  .catch(() => { /* on garde la liste par défaut */ });

export function mettreEnFormeCode(saisie, sigles = siglesSites) {
  const brut = String(saisie).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const debut = brut.slice(0, 5);          // ex. L2INF
  const reste = brut.slice(5);             // ex. LINQVM355
  if (debut.length < 5) return debut;
  if (!reste) return `${debut}-`;          // la 1re partie est complète : le tiret apparaît
  const site = sigles.find((s) => reste.startsWith(s));
  if (!site) return `${debut}-${reste}`;   // site pas encore complet : on attend
  const secret = reste.slice(site.length).slice(0, SECRET);
  if (secret) return `${debut}-${site}-${secret}`;
  // Site complet : le 2e tiret apparaît (sauf si un autre site plus long commence pareil).
  const autrePossible = sigles.some((s) => s !== site && s.startsWith(site));
  return autrePossible ? `${debut}-${site}` : `${debut}-${site}-`;
}

// Petite aide sous le champ, mise à jour à chaque lettre : elle dit ce qui
// manque ou ce qui ne va pas, sans rien bloquer (le serveur vérifie de toute façon).
const zoneAide = document.querySelector('#aide-code');
function aideCode(valeur) {
  const [debut = '', site = '', secret = ''] = valeur.split('-');
  if (!valeur) return ['', 'Le tiret se place tout seul : tapez seulement les lettres et les chiffres.'];
  if (!/^[A-Z]([0-9]([A-Z]{0,3})?)?$/.test(debut)) return ['erreur', 'Le code commence par le niveau : une lettre et un chiffre (ex. L2, B1, M1).'];
  if (debut.length < 5) return ['', `Niveau puis faculté (ex. L2INF) : encore ${5 - debut.length} caractère${5 - debut.length > 1 ? 's' : ''}.`];
  if (siglesFacultes.length && !siglesFacultes.includes(debut.slice(2))) {
    return ['erreur', `« ${debut.slice(2)} » n’est pas une faculté connue (${siglesFacultes.join(', ')}).`];
  }
  const sitePossible = siglesSites.some((s) => s.startsWith(site) || site.startsWith(s));
  if (!sitePossible) return ['erreur', `Après la faculté vient le site : ${siglesSites.join(' ou ')}.`];
  if (!siglesSites.includes(site)) return ['', `Le site : ${siglesSites.join(' ou ')}.`];
  const interdit = [...secret].filter((c) => !ALPHABET.includes(c));
  if (interdit.length) return ['erreur', `Un code ne contient jamais ${interdit.join(', ')} : vérifiez ces caractères (0, O, 1, I et L n’existent pas dans les codes).`];
  if (secret.length < SECRET) return ['', `Encore ${SECRET - secret.length} caractère${SECRET - secret.length > 1 ? 's' : ''}.`];
  return ['ok', '✓ Le code est complet.'];
}
function montrerAide() {
  const [type, texte] = aideCode(champCode.value);
  zoneAide.textContent = texte;
  zoneAide.className = `aide-code petit${type ? ` aide-${type}` : ''}`;
}

// Retour arrière juste après un tiret : on efface aussi le caractère d'avant,
// sinon le tiret effacé reviendrait aussitôt et l'étudiant resterait bloqué.
champCode.addEventListener('keydown', (evenement) => {
  if (evenement.key !== 'Backspace') return;
  const { selectionStart: debut, selectionEnd: fin, value } = champCode;
  if (debut !== fin || debut < 2 || value[debut - 1] !== '-') return;
  evenement.preventDefault();
  const sansTiret = value.slice(0, debut - 2) + value.slice(debut);
  // Pas de tiret ajouté tout de suite à la fin : l'étudiant est en train d'effacer.
  champCode.value = mettreEnFormeCode(sansTiret).replace(/-$/, '');
  const curseur = Math.min(debut - 2, champCode.value.length);
  champCode.setSelectionRange(curseur, curseur);
  montrerAide();
});

champCode.addEventListener('input', (evenement) => {
  // On garde le curseur au même endroit : on compte les lettres et chiffres
  // avant lui, puis on le replace après le même nombre dans le texte mis en forme.
  const position = champCode.selectionStart ?? champCode.value.length;
  const avant = champCode.value.slice(0, position).replace(/[^A-Za-z0-9]/g, '').length;
  let nouveau = mettreEnFormeCode(champCode.value);
  // Quand on efface (touche Suppr…), on n'ajoute pas de tiret à la fin.
  if (evenement.inputType && evenement.inputType.startsWith('delete')) nouveau = nouveau.replace(/-$/, '');
  if (nouveau !== champCode.value) {
    champCode.value = nouveau;
    let compte = 0, curseur = 0;
    while (curseur < nouveau.length && compte < avant) {
      if (/[A-Z0-9]/.test(nouveau[curseur])) compte++;
      curseur++;
    }
    // Si le curseur est juste avant un tiret ajouté, on le place après.
    if (nouveau[curseur] === '-' && curseur === nouveau.length - 1) curseur++;
    champCode.setSelectionRange(curseur, curseur);
  }
  montrerAide();
});
montrerAide();

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
    // On reste sur l'accueil : l'étudiant choisit lui-même d'aller à « Mes votes »
    // (bouton ci-dessous, ou dans le menu).
    location.href = '/?connecte=1';
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
