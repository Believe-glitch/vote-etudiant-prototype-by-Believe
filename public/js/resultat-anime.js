// Le résultat animé d'un scrutin, et la fenêtre plein écran qui le montre.
//
// Utilisé par plusieurs pages :
//   - Résultats : la page /resultats?scrutin=12 (lien direct, ou projection
//     dans la salle) et la fenêtre plein écran depuis la liste ;
//   - Mes votes et Candidats : le bouton « Voir le résultat » ouvre la même
//     fenêtre plein écran.
//
// La fenêtre plein écran : fond sombre, le résultat au centre, la page
// derrière bloquée (personne ne peut la faire défiler pendant l'animation),
// les boutons « Rejouer » et « Fermer » en haut, et la touche Échap.

import { api, e, photoCandidat, afficherMessage, ecouterDirect, blocSeance, appliquerLargeurs, pourcentage } from './commun.js';

const sansAnimation = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, sansAnimation ? 0 : ms));

// Affiche (et anime) le résultat d'un scrutin dans « racine ».
// Renvoie une fonction qui arrête le direct (à appeler en fermant la fenêtre).
export function afficherDetail(id, racine, { titreDuDocument = false, boutonRejouer = null } = {}) {
  const $ = (selecteur) => racine.querySelector(selecteur);
  const zoneContenu = $('.contenu-resultat');
  const zoneMessage = $('.message-resultat');
  let dejaAffiche = null;   // ce qu'on a déjà animé, pour ne pas rejouer sans raison
  let versionVue = null;
  let arrete = false;

  function remplirTitre(s) {
    $('.titre-scrutin').textContent = `${s.nomPoste}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}`;
    $('.sous-titre-scrutin').textContent = s.promotion ?? 'Toute l’université · Lingwala et N’djili';
    if (titreDuDocument) document.title = `${s.nomPoste} – Résultats`;
  }

  async function charger() {
    try {
      const resultat = await api(`/api/resultats/${id}`);
      if (arrete) return;
      const empreinte = JSON.stringify([resultat.complet, resultat.parSite.map((s) => s.campusId)]);
      if (empreinte === dejaAffiche) return;
      dejaAffiche = empreinte;
      afficherMessage(zoneMessage, '');
      await afficherResultat(resultat);
    } catch (erreur) {
      if (arrete) return;
      if (erreur.statut === 403) {
        // Pas encore dévoilé : on attend, en montrant la participation en direct.
        const scrutin = await api(`/api/scrutins/${id}`).catch(() => null);
        afficherAttente(scrutin);
      } else {
        afficherMessage(zoneMessage, erreur.message);
      }
    }
  }

  function afficherAttente(scrutin) {
    if (scrutin) remplirTitre(scrutin);
    const seances = scrutin ? scrutin.seances.filter((s) => s.statut !== 'attente') : [];
    zoneContenu.innerHTML = `
      <div class="bandeau section">
        <h2>Résultats pas encore dévoilés</h2>
        <p>Cet écran s’animera tout seul dès que le superviseur dévoilera les résultats.</p>
        <div class="participation-direct">
          ${seances.map((s) => `<div class="section"><h3>Séance de ${e(s.campus)}</h3>${blocSeance(s)}</div>`).join('')}
        </div>
      </div>`;
    appliquerLargeurs(zoneContenu);
  }

  const direct = ecouterDirect((etat) => {
    if (arrete) return;
    const zoneDirect = $('.participation-direct');
    if (zoneDirect) {
      const miennes = etat.seances.filter((s) => s.scrutinId === id);
      zoneDirect.innerHTML = miennes.map((s) => `<div class="section"><h3>Séance de ${e(s.campus)}</h3>${blocSeance(s)}</div>`).join('');
      if (miennes[0]) remplirTitre({ nomPoste: miennes[0].nomPoste, tour: miennes[0].tour, promotion: miennes[0].promotion });
      appliquerLargeurs(zoneDirect);
    }
    if (etat.versionResultats !== versionVue) {
      versionVue = etat.versionResultats;
      charger();
    }
  });

  async function afficherResultat(r) {
    remplirTitre(r.scrutin);
    if (boutonRejouer) boutonRejouer.classList.add('cache');

    if (r.eluDOffice) {
      const elu = r.candidats[0];
      zoneContenu.innerHTML = `
        <div class="carte section ligne-flex">
          <div class="ligne-flex">${photoCandidat(elu, 'photo-grande')}
            <div><h2>${e(elu.nom)}</h2><p>${e(r.places[0].nomPlace)} d’office : seul(e) candidat(e) à ce poste.</p></div>
          </div>
        </div>`;
      return;
    }

    if (!r.complet) {
      // Mode "par site" : on montre seulement les sites déjà dévoilés.
      zoneContenu.innerHTML = r.parSite.map((site) => `
        <section class="carte section">
          <h2>Site de ${e(site.campus)}</h2>
          <p>${site.votants} votants sur ${site.inscrits} inscrits (${pourcentage(site.votants, site.inscrits)} %)</p>
          <div class="barres">${lignesBarres(site.candidats, [])}</div>
        </section>`).join('') +
        '<p class="message">Résultats partiels : le total et les élus seront connus quand tous les sites auront voté.</p>';
      await animerBarres(zoneContenu);
      return;
    }

    const { votants, inscrits } = r.participation;
    zoneContenu.innerHTML = `
      <section class="bandeau section">
        <p>Participation</p>
        <p class="resultat-chiffre"><span class="compteur-votants">0</span> <span class="petit">votants sur ${inscrits} inscrits</span></p>
        <p class="taux cache">${pourcentage(votants, inscrits)} % de participation</p>
      </section>
      <section class="carte section">
        <h2>Voix par candidat</h2>
        <div class="barres">${lignesBarres(r.candidats, r.places)}</div>
        <div class="conclusion"></div>
      </section>
      ${r.parSite.length > 1 ? tableauParSite(r) : ''}
      ${boutonRejouer ? '' : '<p class="rangee-boutons section"><button class="bouton bouton-contour bouton-rejouer" type="button">Rejouer l’animation</button></p>'}`;

    // « Rejouer » : en haut de la fenêtre plein écran, ou en bas de la page.
    const rejouer = () => {
      dejaAffiche = null;
      afficherResultat(r);
    };
    if (boutonRejouer) {
      boutonRejouer.onclick = rejouer;
      boutonRejouer.classList.remove('cache');
    } else {
      $('.bouton-rejouer').addEventListener('click', rejouer);
    }

    await compter($('.compteur-votants'), votants, 1200);
    $('.taux').classList.remove('cache');
    await pause(500);
    await animerBarres(zoneContenu);
    $('.conclusion').innerHTML = conclusion(r);
    $('.conclusion').scrollIntoView({ block: 'nearest', behavior: sansAnimation ? 'auto' : 'smooth' });
  }

  charger();
  return () => { arrete = true; direct.close(); };
}

// --- La fenêtre plein écran ----------------------------------------------

let fenetre = null;
let arreterFenetre = null;

// La fenêtre est créée la première fois qu'on en a besoin, sur n'importe quelle page.
function creerFenetre() {
  fenetre = document.createElement('dialog');
  fenetre.className = 'plein-ecran';
  fenetre.setAttribute('aria-labelledby', 'plein-ecran-titre');
  fenetre.innerHTML = `
    <div class="plein-ecran-entete">
      <div class="plein-ecran-titres">
        <h1 id="plein-ecran-titre" class="titre-scrutin">Résultats</h1>
        <p class="sous-titre-scrutin"></p>
      </div>
      <div class="rangee-boutons">
        <button class="bouton bouton-contour bouton-petit rejouer-plein-ecran cache" type="button">Rejouer</button>
        <button class="bouton bouton-petit fermer-plein-ecran" type="button">Fermer ✕</button>
      </div>
    </div>
    <div class="plein-ecran-corps">
      <div class="message-resultat"></div>
      <div class="contenu-resultat"></div>
    </div>`;
  document.body.append(fenetre);
  fenetre.querySelector('.fermer-plein-ecran').addEventListener('click', fermerResultatPleinEcran);
  fenetre.addEventListener('close', fermerResultatPleinEcran);   // touche Échap
  // Un clic sur le fond sombre (en dehors de la fenêtre) la ferme aussi.
  fenetre.addEventListener('click', (evenement) => {
    if (evenement.target === fenetre) fermerResultatPleinEcran();
  });
}

export function ouvrirResultatPleinEcran(id) {
  if (!fenetre) creerFenetre();
  fenetre.querySelector('.titre-scrutin').textContent = 'Résultats';
  fenetre.querySelector('.sous-titre-scrutin').textContent = '';
  fenetre.querySelector('.contenu-resultat').innerHTML = '<p class="texte-doux">Chargement…</p>';
  document.documentElement.classList.add('sans-defilement');   // la page derrière ne bouge plus
  fenetre.showModal();
  fenetre.querySelector('.plein-ecran-corps').scrollTop = 0;
  arreterFenetre = afficherDetail(id, fenetre, { boutonRejouer: fenetre.querySelector('.rejouer-plein-ecran') });
}

export function fermerResultatPleinEcran() {
  if (arreterFenetre) arreterFenetre();
  arreterFenetre = null;
  document.documentElement.classList.remove('sans-defilement');
  if (fenetre && fenetre.open) fenetre.close();
}

// Dans « zone », un clic sur un lien <a data-resultat="12"> ouvre la fenêtre
// plein écran (Ctrl+clic ou clic du milieu ouvrent toujours la page dans un
// nouvel onglet).
export function brancherLiensResultats(zone) {
  zone.addEventListener('click', (evenement) => {
    const lien = evenement.target.closest('a[data-resultat]');
    if (!lien || evenement.ctrlKey || evenement.metaKey || evenement.shiftKey || evenement.button !== 0) return;
    evenement.preventDefault();
    ouvrirResultatPleinEcran(Number(lien.dataset.resultat));
  });
}

// Les candidats sont affichés du MOINS de voix au PLUS de voix : le suspense
// monte jusqu'au gagnant, qui apparaît en dernier.
function lignesBarres(candidats, places) {
  const maximum = Math.max(1, ...candidats.map((c) => c.voix));
  const placeDe = new Map(places.map((p) => [p.candidatId, p.nomPlace]));
  return [...candidats]
    .sort((a, b) => a.voix - b.voix)
    .map((c) => `
      <div class="barre-ligne ${placeDe.has(c.id) ? 'gagnant' : ''}">
        ${photoCandidat(c, 'petite')}
        <div>
          <div class="barre-entete">
            <span>${e(c.nom)}${placeDe.has(c.id) ? `<span class="badge-place">${e(placeDe.get(c.id))}</span>` : ''}</span>
            <span class="barre-voix" data-voix="${c.voix}">0</span>
          </div>
          <div class="barre-fond"><div class="barre-remplissage" data-largeur-finale="${Math.round((c.voix / maximum) * 100)}"></div></div>
        </div>
      </div>`).join('');
}

async function animerBarres(racine) {
  const lignes = [...racine.querySelectorAll('.barre-ligne')];
  for (const ligne of lignes) {
    ligne.classList.add('visible');
    // On garde à l'écran la barre qui s'anime.
    ligne.scrollIntoView({ block: 'nearest', behavior: sansAnimation ? 'auto' : 'smooth' });
    await pause(250);
    const barre = ligne.querySelector('.barre-remplissage');
    barre.style.width = `${barre.dataset.largeurFinale}%`;
    const voix = ligne.querySelector('.barre-voix');
    await compter(voix, Number(voix.dataset.voix), 1100);
    await pause(400);
  }
  for (const badge of racine.querySelectorAll('.badge-place')) badge.classList.add('visible');
}

// Fait défiler un nombre de 0 jusqu'à sa valeur finale.
function compter(element, valeurFinale, duree) {
  return new Promise((resolve) => {
    if (sansAnimation || valeurFinale === 0) {
      element.textContent = valeurFinale;
      resolve();
      return;
    }
    const debut = performance.now();
    const etape = (instant) => {
      const avancement = Math.min(1, (instant - debut) / duree);
      element.textContent = Math.round(valeurFinale * (1 - Math.pow(1 - avancement, 3)));
      if (avancement < 1) requestAnimationFrame(etape);
      else resolve();
    };
    requestAnimationFrame(etape);
  });
}

function conclusion(r) {
  const nomDe = (id) => r.candidats.find((c) => c.id === id)?.nom ?? '';
  let html = r.places.map((p) => `
    <div class="message message-ok"><strong>${e(p.nomPlace)} :</strong> ${e(nomDe(p.candidatId))}</div>`).join('');

  if (r.egalite) {
    const noms = r.egalite.candidatIds.map(nomDe).map(e).join(', ');
    html += `<div class="message"><strong>Égalité</strong> entre ${noms}. Un second tour départagera ces candidats.
      ${r.secondTourId ? ` <a href="/resultats?scrutin=${r.secondTourId}">Suivre le second tour</a>` : ''}</div>`;
  } else if (r.scrutin.poste === 'PRESIDENCE' && r.places.length < 2 && r.places.every((p) => p.rang === 1)) {
    html += '<div class="message">Vice-présidence : poste vacant (pas assez de candidats).</div>';
  }
  return html;
}

function tableauParSite(r) {
  const lignes = r.candidats.map((c) => `
    <tr><td>${e(c.nom)}</td>
      ${r.parSite.map((site) => `<td class="nombre">${site.candidats.find((x) => x.id === c.id)?.voix ?? 0}</td>`).join('')}
      <td class="nombre"><strong>${c.voix}</strong></td></tr>`).join('');
  return `
    <section class="carte section">
      <h2>Détail par site</h2>
      <div class="tableau-conteneur"><table>
        <thead><tr><th>Candidat</th>${r.parSite.map((s) => `<th class="nombre">${e(s.campus)}</th>`).join('')}<th class="nombre">Total</th></tr></thead>
        <tbody>${lignes}
          <tr class="total"><td>Votants</td>${r.parSite.map((s) => `<td class="nombre">${s.votants}</td>`).join('')}<td class="nombre">${r.participation.votants}</td></tr>
        </tbody>
      </table></div>
    </section>`;
}
