// Page des candidats, ouverte à tous (visiteurs compris).

import { api, e, photoCandidat, afficherMessage, marquerPageCourante, sessionEtudiant } from './commun.js';

marquerPageCourante();

const selectSite = document.querySelector('#choix-site');
const selectFaculte = document.querySelector('#choix-faculte');
const selectPromo = document.querySelector('#choix-promo');
const formulaire = document.querySelector('#choix-promotion');
const zoneListe = document.querySelector('#liste');
const zoneMessage = document.querySelector('#message');
const ongletPromotions = document.querySelector('#onglet-promotions');
const ongletPresidence = document.querySelector('#onglet-presidence');

const STATUTS = {
  preparation: ['Vote pas encore ouvert', ''],
  en_cours: ['Vote en cours', 'pastille-ouvert'],
  termine: ['Vote fermé', 'pastille-ferme'],
  devoile: ['Résultats dévoilés', 'pastille-devoile'],
};

let structure = null;
let modePourMoi = false;   // étudiant connecté : on montre seulement sa promotion + la présidence

function options(liste, texte) {
  return liste.map((x) => `<option value="${x.id}">${e(texte(x))}</option>`).join('');
}

function remplirFacultes() {
  const campusId = Number(selectSite.value);
  const facultesDuSite = structure.facultes.filter((f) =>
    structure.promotions.some((p) => p.campusId === campusId && p.faculteId === f.id));
  selectFaculte.innerHTML = options(facultesDuSite, (f) => f.nom);
  remplirPromotions();
}

function remplirPromotions() {
  const campusId = Number(selectSite.value);
  const faculteId = Number(selectFaculte.value);
  const promotions = structure.promotions.filter((p) => p.campusId === campusId && p.faculteId === faculteId);
  selectPromo.innerHTML = options(promotions, (p) => p.niveau + (p.filiere ? ` · ${p.filiere}` : ''));
  chargerPromotion();
}

// Pour chaque poste, on montre le dernier tour.
function derniersTours(scrutins) {
  const parPoste = new Map();
  for (const s of scrutins) {
    const actuel = parPoste.get(s.poste);
    if (!actuel || s.tour > actuel.tour) parPoste.set(s.poste, s);
  }
  return [...parPoste.values()];
}

// Ordre d'affichage des postes (la présidence en dernier).
const ORDRE = { CP: 1, CPA: 2, SECRETAIRE: 3, PRESIDENCE: 4 };

function afficher(scrutins) {
  if (scrutins.length === 0) {
    zoneListe.innerHTML = '<p class="texte-doux">Aucun scrutin pour cette sélection.</p>';
    return;
  }
  zoneListe.innerHTML = derniersTours(scrutins).sort((a, b) => ORDRE[a.poste] - ORDRE[b.poste]).map((s) => {
    const [texteStatut, classeStatut] = STATUTS[s.statut];
    const candidats = s.candidats.length === 0
      ? '<p class="texte-doux">Aucun candidat : poste vacant.</p>'
      : `<div class="liste-candidats">${s.candidats.map((c) => `
          <div class="candidat">${photoCandidat(c)}
            <div><div class="candidat-nom">${e(c.nom)}</div>
            ${c.slogan ? `<p class="candidat-slogan">${e(c.slogan)}</p>` : ''}</div>
          </div>`).join('')}</div>`;
    return `
      <article class="carte section">
        <div class="ligne-flex">
          <h2>${e(s.nomPoste)}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}</h2>
          <span class="pastille ${classeStatut}">${s.eluDOffice ? 'Élu(e) d’office' : texteStatut}</span>
        </div>
        <p class="texte-doux petit">${e(s.promotion ?? 'Toute l’université · Lingwala et N’djili')}</p>
        ${candidats}
        ${s.statut === 'devoile' && !s.eluDOffice ? `<p class="section"><a href="/resultats?scrutin=${s.id}">Voir les résultats</a></p>` : ''}
      </article>`;
  }).join('');
}

async function chargerPromotion() {
  if (modePourMoi) return;   // la liste « pour vous » est déjà affichée
  const promotionId = Number(selectPromo.value);
  if (!promotionId) {
    zoneListe.innerHTML = '';
    return;
  }
  history.replaceState(null, '', `?promotion=${promotionId}`);
  try {
    afficher(await api(`/api/scrutins?promotion=${promotionId}`));
    afficherMessage(zoneMessage, '');
  } catch (erreur) {
    afficherMessage(zoneMessage, erreur.message);
  }
}

async function chargerPresidence() {
  history.replaceState(null, '', '?presidence=oui');
  try {
    afficher(await api('/api/scrutins?presidence=oui'));
    afficherMessage(zoneMessage, '');
  } catch (erreur) {
    afficherMessage(zoneMessage, erreur.message);
  }
}

function choisirOnglet(presidence) {
  ongletPromotions.setAttribute('aria-selected', String(!presidence));
  ongletPresidence.setAttribute('aria-selected', String(presidence));
  formulaire.classList.toggle('cache', presidence);
  if (presidence) chargerPresidence();
  else chargerPromotion();
}

ongletPromotions.addEventListener('click', () => choisirOnglet(false));
ongletPresidence.addEventListener('click', () => choisirOnglet(true));
selectSite.addEventListener('change', remplirFacultes);
selectFaculte.addEventListener('change', remplirPromotions);
selectPromo.addEventListener('change', chargerPromotion);

async function demarrer() {
  try {
    structure = await api('/api/structure');
  } catch (erreur) {
    afficherMessage(zoneMessage, erreur.message);
    return;
  }
  selectSite.innerHTML = options(structure.campus, (c) => c.nom);

  // Si l'adresse indique déjà une promotion (lien partagé), on la présélectionne.
  const parametres = new URLSearchParams(location.search);
  const demandee = structure.promotions.find((p) => p.id === Number(parametres.get('promotion')));

  // Étudiant connecté, sans lien précis dans l'adresse : on lui montre d'abord
  // ce qui le concerne (sa promotion + la présidence). Un bouton rend tout visible.
  const session = await sessionEtudiant();
  if (session.connecte && !demandee && !parametres.get('presidence')) {
    modePourMoi = true;
    const p = structure.promotions.find((x) => x.id === session.promotionId);
    if (p) selectSite.value = p.campusId;
    remplirFacultes();
    if (p) { selectFaculte.value = p.faculteId; remplirPromotions(); selectPromo.value = p.id; }
    await afficherPourMoi(session);
    return;
  }
  if (demandee) {
    selectSite.value = demandee.campusId;
    remplirFacultes();
    selectFaculte.value = demandee.faculteId;
    remplirPromotions();
    selectPromo.value = demandee.id;
    chargerPromotion();
  } else {
    remplirFacultes();
  }
  if (parametres.get('presidence') === 'oui') choisirOnglet(true);
}

async function afficherPourMoi(session) {
  const blocPourVous = document.querySelector('#pour-vous');
  const onglets = document.querySelector('#onglets-candidats');
  document.querySelector('#pour-vous-texte').textContent = `${session.promotion} + Présidence de l’université`;
  blocPourVous.classList.remove('cache');
  onglets.classList.add('cache');
  formulaire.classList.add('cache');
  try {
    const [miens, presidence] = await Promise.all([
      api(`/api/scrutins?promotion=${session.promotionId}`),
      api('/api/scrutins?presidence=oui'),
    ]);
    afficher([...miens, ...presidence]);
  } catch (erreur) {
    afficherMessage(zoneMessage, erreur.message);
  }
  document.querySelector('#voir-tout').addEventListener('click', () => {
    modePourMoi = false;
    blocPourVous.classList.add('cache');
    onglets.classList.remove('cache');
    choisirOnglet(false);   // on part de sa promotion, déjà choisie dans les listes
  }, { once: true });
}

demarrer();
