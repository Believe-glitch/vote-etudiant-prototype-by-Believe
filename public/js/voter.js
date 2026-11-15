// Espace de vote de l'étudiant connecté.
//
// La page affiche un bloc par poste (CP, CPA, secrétaire, présidence) et
// s'adapte à l'état de chaque vote : pas encore ouvert, ouvert, déjà voté,
// fermé, résultats dévoilés. Le direct la tient à jour sans recharger.

import {
  api, e, photoCandidat, afficherMessage, ecouterDirect, blocSeance, appliquerLargeurs,
  lancerDecomptes, caleHorloge, secondesRestantes, marquerPageCourante,
} from './commun.js';

marquerPageCourante();
lancerDecomptes();

const ORDRE_POSTES = ['CP', 'CPA', 'SECRETAIRE', 'PRESIDENCE'];

const zoneIdentite = document.querySelector('#identite');
const zoneListe = document.querySelector('#liste-scrutins');
const zoneMessage = document.querySelector('#message-general');
const dialogue = document.querySelector('#confirmation');

let moi = null;                 // ce que renvoie /api/etudiant/moi
let signatureDirect = '';       // pour savoir si l'état des séances a changé
const selections = new Map();   // candidat choisi (pas encore validé), par scrutin
let voteEnAttente = null;       // { scrutinId, candidatId } pendant la confirmation

// Pour chaque poste, on ne garde que le dernier tour (un second tour remplace le premier).
function derniersTours(scrutins) {
  const parPoste = new Map();
  for (const s of scrutins) {
    const actuel = parPoste.get(s.poste);
    if (!actuel || s.tour > actuel.tour) parPoste.set(s.poste, s);
  }
  return ORDRE_POSTES.filter((p) => parPoste.has(p)).map((p) => parPoste.get(p));
}

async function charger() {
  try {
    moi = await api('/api/etudiant/moi');
  } catch (erreur) {
    if (erreur.statut === 401) {
      location.href = '/';
      return;
    }
    afficherMessage(zoneMessage, erreur.message);
    return;
  }
  caleHorloge(moi.maintenant);
  // On n'affiche que le début du code : la partie secrète ne revient jamais du serveur.
  zoneIdentite.textContent = `Code ${moi.prefixe}-•••••• · ${moi.promotion}`;
  afficher();
}

function afficher() {
  const scrutins = derniersTours(moi.scrutins);
  zoneListe.innerHTML = scrutins.map(blocScrutin).join('');
  appliquerLargeurs(zoneListe);

  // On remet les choix déjà cochés (si la page s'est mise à jour entre-temps).
  for (const [scrutinId, candidatId] of selections) {
    const caseACocher = zoneListe.querySelector(`input[name="choix-${scrutinId}"][value="${candidatId}"]`);
    if (caseACocher) caseACocher.checked = true;
  }
}

function blocScrutin(s) {
  const titre = `${e(s.nomPoste)}${s.tour > 1 ? ` <span class="pastille">${s.tour}e tour</span>` : ''}`;
  const sousTitre = s.poste === 'PRESIDENCE' ? 'Toute l’université' : e(moi.promotion);
  let contenu;

  const seance = s.seance;
  const voteOuvert = seance && seance.statut === 'ouverte' && secondesRestantes(seance.fin) > 0;

  if (s.candidats.length === 0) {
    contenu = '<p class="texte-doux">Aucun candidat : le poste est vacant.</p>';
  } else if (s.eluDOffice) {
    contenu = `<div class="message message-ok">${e(s.candidats[0].nom)} est élu(e) d’office (candidat unique).</div>`;
  } else if (s.statut === 'devoile') {
    contenu = `<p>Les résultats sont dévoilés.</p>
      <a class="bouton" href="/resultats?scrutin=${s.id}">Voir les résultats</a>`;
  } else if (s.aVote) {
    contenu = `<div class="message message-ok">Vous avez voté pour ce poste. Merci !</div>
      ${seance && seance.statut === 'ouverte' ? `<div data-seance="${s.id}">${blocSeance(seance)}</div>` : ''}`;
  } else if (voteOuvert) {
    contenu = `
      <div data-seance="${s.id}">${blocSeance(seance)}</div>
      <form class="formulaire-vote section" data-scrutin="${s.id}">
        <fieldset class="liste-candidats fieldset-nu">
          <legend class="cache">Choisissez votre candidat</legend>
          ${s.candidats.map((c) => `
            <label class="candidat choix">
              <input type="radio" name="choix-${s.id}" value="${c.id}" required>
              ${photoCandidat(c)}
              <span>
                <span class="candidat-nom">${e(c.nom)}</span>
                ${c.slogan ? `<span class="candidat-slogan">${e(c.slogan)}</span>` : ''}
              </span>
            </label>`).join('')}
        </fieldset>
        <div class="message-vote"></div>
        <button class="bouton bouton-accent section" type="submit">Valider mon vote</button>
      </form>`;
  } else if (seance && seance.statut === 'fermee') {
    contenu = '<p class="texte-doux">Le vote est fermé. Les résultats seront dévoilés par le superviseur.</p>';
  } else {
    contenu = `<p class="texte-doux">Le vote n’est pas encore ouvert. Voici les candidats :</p>
      <div class="liste-candidats">
        ${s.candidats.map((c) => `
          <div class="candidat">${photoCandidat(c)}
            <div><div class="candidat-nom">${e(c.nom)}</div>
            ${c.slogan ? `<p class="candidat-slogan">${e(c.slogan)}</p>` : ''}</div>
          </div>`).join('')}
      </div>`;
  }

  return `
    <article class="carte section" id="scrutin-${s.id}">
      <h2>${titre}</h2>
      <p class="texte-doux petit">${sousTitre}</p>
      ${contenu}
    </article>`;
}

// --- Choix et confirmation du vote -------------------------------------------

zoneListe.addEventListener('change', (evenement) => {
  const caseACocher = evenement.target;
  if (caseACocher.type !== 'radio') return;
  const scrutinId = Number(caseACocher.closest('form').dataset.scrutin);
  selections.set(scrutinId, Number(caseACocher.value));
});

zoneListe.addEventListener('submit', (evenement) => {
  evenement.preventDefault();
  const formulaire = evenement.target;
  const scrutinId = Number(formulaire.dataset.scrutin);
  const coche = formulaire.querySelector('input[type="radio"]:checked');
  const zoneErreur = formulaire.querySelector('.message-vote');
  if (!coche) {
    afficherMessage(zoneErreur, 'Choisissez d’abord un candidat.');
    return;
  }
  const scrutin = moi.scrutins.find((s) => s.id === scrutinId);
  const candidat = scrutin.candidats.find((c) => c.id === Number(coche.value));
  voteEnAttente = { scrutinId, candidatId: candidat.id };
  document.querySelector('#texte-confirmation').innerHTML =
    `Vous votez pour <strong>${e(candidat.nom)}</strong> — ${e(scrutin.nomPoste)}.`;
  dialogue.showModal();
});

document.querySelector('#annuler').addEventListener('click', () => {
  voteEnAttente = null;
  dialogue.close();
});

document.querySelector('#confirmer').addEventListener('click', async () => {
  if (!voteEnAttente) return;
  const { scrutinId, candidatId } = voteEnAttente;
  const bouton = document.querySelector('#confirmer');
  bouton.disabled = true;
  try {
    await api('/api/etudiant/voter', { methode: 'POST', corps: { scrutinId, candidatId } });
    selections.delete(scrutinId);
    afficherMessage(zoneMessage, 'Votre vote est enregistré. Merci !', 'ok');
  } catch (erreur) {
    if (erreur.statut === 401) {
      location.href = '/';
      return;
    }
    afficherMessage(zoneMessage, erreur.message);
  } finally {
    bouton.disabled = false;
    voteEnAttente = null;
    dialogue.close();
    await charger();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

document.querySelector('#deconnexion').addEventListener('click', async () => {
  await api('/api/etudiant/deconnexion', { methode: 'POST' }).catch(() => {});
  location.href = '/';
});

// --- Direct -----------------------------------------------------------------

ecouterDirect((etat) => {
  if (!moi) return;
  const mesScrutins = new Set(moi.scrutins.map((s) => s.id));
  const miennes = etat.seances.filter((s) => mesScrutins.has(s.scrutinId) && s.campusId === moi.campusId);

  // Une séance s'ouvre, se ferme ou se prolonge, ou un résultat est dévoilé :
  // on recharge tout. Sinon, on met seulement à jour la participation.
  const signature = `${etat.versionResultats}|` +
    miennes.map((s) => `${s.scrutinId}:${s.statut}:${s.fin}`).sort().join(',');
  if (signature !== signatureDirect) {
    const premiereFois = signatureDirect === '';
    signatureDirect = signature;
    if (!premiereFois) charger();
    return;
  }
  for (const s of miennes) {
    const zone = zoneListe.querySelector(`[data-seance="${s.scrutinId}"]`);
    if (zone) {
      zone.innerHTML = blocSeance(s);
      appliquerLargeurs(zone);
    }
  }
});

charger();
