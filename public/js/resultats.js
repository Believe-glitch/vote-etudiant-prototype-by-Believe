// Page des résultats.
//   /resultats              : la liste des résultats dévoilés et de ceux en attente ;
//   /resultats?scrutin=12   : le détail d'un scrutin, avec l'animation du dévoilement.
//
// Pensée aussi pour être projetée dans la salle : quand le superviseur clique
// sur « Dévoiler », la page projetée lance l'animation toute seule.

import {
  api, e, photoCandidat, afficherMessage, ecouterDirect, blocSeance, appliquerLargeurs,
  pourcentage, lancerDecomptes, marquerPageCourante,
} from './commun.js';
import { brancherFiltrePromotion, pourComparer } from './filtres.js';

marquerPageCourante();
lancerDecomptes();

const scrutinId = Number(new URLSearchParams(location.search).get('scrutin'));
const sansAnimation = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, sansAnimation ? 0 : ms));

let versionConnue = null;

if (scrutinId) demarrerDetail();
else demarrerListe();

// ---------------------------------------------------------------------
// Vue liste
// ---------------------------------------------------------------------

async function demarrerListe() {
  document.querySelector('#vue-liste').classList.remove('cache');
  const zoneAttente = document.querySelector('#en-attente');
  const zoneDevoiles = document.querySelector('#devoiles');
  const champPoste = document.querySelector('#filtre-poste');
  const champTexte = document.querySelector('#filtre-texte');
  const zoneCompte = document.querySelector('#compte-filtre');

  let devoiles = [];      // résultats dévoilés (liste complète, avant filtre)
  let seances = [];       // votes en cours ou en attente (direct)

  // Le filtre : site → faculté → promotion, poste, et texte libre.
  // La présidence concerne tout le monde : elle reste visible quel que soit
  // le site, la faculté ou la promotion choisis (sauf si on filtre un poste).
  const structure = await api('/api/structure').catch(() => ({ campus: [], facultes: [], promotions: [] }));
  const filtre = brancherFiltrePromotion({
    site: document.querySelector('#filtre-site'),
    faculte: document.querySelector('#filtre-faculte'),
    promotion: document.querySelector('#filtre-promotion'),
  }, structure, afficher);
  champPoste.addEventListener('change', afficher);
  champTexte.addEventListener('input', afficher);
  document.querySelector('#filtres').addEventListener('submit', (evenement) => evenement.preventDefault());
  document.querySelector('#effacer-filtres').addEventListener('click', () => {
    filtre.reinitialiser();
    champPoste.value = '';
    champTexte.value = '';
    afficher();
  });

  function garde(element) {
    if (champPoste.value && element.poste !== champPoste.value) return false;
    if (element.promotionId !== null && !filtre.correspond(element.promotionId)) return false;
    const texte = pourComparer(champTexte.value);
    if (texte && !pourComparer(`${element.nomPoste} ${element.promotion ?? 'presidence universite'}`).includes(texte)) return false;
    return true;
  }

  function afficher() {
    const attente = seances.filter(garde);
    const resultats = devoiles.filter(garde);
    zoneAttente.innerHTML = attente.length === 0
      ? '<p class="texte-doux">Aucun vote en cours ni en attente pour ce choix.</p>'
      : attente.map((s) => `
          <a class="carte" href="/resultats?scrutin=${s.scrutinId}">
            <h3>${e(s.nomPoste)}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}</h3>
            <p class="texte-doux petit">${e(s.promotion ?? 'Toute l’université')} · séance de ${e(s.campus)}</p>
            ${blocSeance(s)}
          </a>`).join('');
    appliquerLargeurs(zoneAttente);
    zoneDevoiles.innerHTML = resultats.length === 0
      ? `<p class="texte-doux">${devoiles.length === 0 ? 'Aucun résultat dévoilé pour le moment.' : 'Aucun résultat ne correspond à ces filtres.'}</p>`
      : resultats.map((r) => `
          <a class="carte" href="/resultats?scrutin=${r.id}">
            <h3>${e(r.nomPoste)}${r.tour > 1 ? ` · ${r.tour}e tour` : ''}</h3>
            <p class="texte-doux petit">${e(r.promotion ?? 'Toute l’université')}</p>
            <span class="pastille pastille-devoile">${r.eluDOffice ? 'Élu(e) d’office' : r.complet ? 'Résultats complets' : 'Résultats partiels'}</span>
          </a>`).join('');
    zoneCompte.textContent = `${resultats.length} résultat${resultats.length > 1 ? 's' : ''} dévoilé${resultats.length > 1 ? 's' : ''} sur ${devoiles.length}`;
  }

  async function chargerListe() {
    devoiles = await api('/api/resultats').catch(() => []);
    afficher();
  }

  ecouterDirect((etat) => {
    seances = etat.seances;
    if (etat.versionResultats !== versionConnue) {
      versionConnue = etat.versionResultats;
      chargerListe();
    } else {
      afficher();
    }
  });
}

// ---------------------------------------------------------------------
// Vue détail
// ---------------------------------------------------------------------

function demarrerDetail() {
  document.querySelector('#vue-detail').classList.remove('cache');
  const zoneContenu = document.querySelector('#contenu-resultat');
  const zoneMessage = document.querySelector('#message');
  let dejaAffiche = null;   // ce qu'on a déjà animé, pour ne pas rejouer sans raison

  async function charger() {
    try {
      const resultat = await api(`/api/resultats/${scrutinId}`);
      const empreinte = JSON.stringify([resultat.complet, resultat.parSite.map((s) => s.campusId)]);
      if (empreinte === dejaAffiche) return;
      dejaAffiche = empreinte;
      afficherMessage(zoneMessage, '');
      await afficherResultat(resultat);
    } catch (erreur) {
      if (erreur.statut === 403) {
        // Pas encore dévoilé : on attend, en montrant la participation en direct.
        const scrutin = await api(`/api/scrutins/${scrutinId}`).catch(() => null);
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
        <p>Cette page s’animera toute seule dès que le superviseur dévoilera les résultats.</p>
        <div id="participation-direct">
          ${seances.map((s) => `<div class="section"><h3>Séance de ${e(s.campus)}</h3>${blocSeance(s)}</div>`).join('')}
        </div>
      </div>`;
    appliquerLargeurs(zoneContenu);
  }

  ecouterDirect((etat) => {
    const zoneDirect = document.querySelector('#participation-direct');
    if (zoneDirect) {
      const miennes = etat.seances.filter((s) => s.scrutinId === scrutinId);
      zoneDirect.innerHTML = miennes.map((s) => `<div class="section"><h3>Séance de ${e(s.campus)}</h3>${blocSeance(s)}</div>`).join('');
      if (miennes[0]) remplirTitre({ nomPoste: miennes[0].nomPoste, tour: miennes[0].tour, promotion: miennes[0].promotion });
      appliquerLargeurs(zoneDirect);
    }
    if (etat.versionResultats !== versionConnue) {
      versionConnue = etat.versionResultats;
      charger();
    }
  });

  async function afficherResultat(r) {
    remplirTitre(r.scrutin);

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
        <p class="resultat-chiffre"><span id="compteur-votants">0</span> <span class="petit">votants sur ${inscrits} inscrits</span></p>
        <p id="taux" class="cache">${pourcentage(votants, inscrits)} % de participation</p>
      </section>
      <section class="carte section">
        <h2>Voix par candidat</h2>
        <div class="barres">${lignesBarres(r.candidats, r.places)}</div>
        <div id="conclusion"></div>
      </section>
      ${r.parSite.length > 1 ? tableauParSite(r) : ''}
      <p class="rangee-boutons section"><button id="rejouer" class="bouton bouton-contour" type="button">Rejouer l’animation</button></p>`;

    document.querySelector('#rejouer').addEventListener('click', () => {
      dejaAffiche = null;
      afficherResultat(r);
    });

    await compter(document.querySelector('#compteur-votants'), votants, 1200);
    document.querySelector('#taux').classList.remove('cache');
    await pause(500);
    await animerBarres(zoneContenu);
    document.querySelector('#conclusion').innerHTML = conclusion(r);
  }

  charger();
}

function remplirTitre(s) {
  document.querySelector('#titre-scrutin').textContent = `${s.nomPoste}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}`;
  document.querySelector('#sous-titre').textContent = s.promotion ?? 'Toute l’université · Lingwala et N’djili';
  document.title = `${s.nomPoste} – Résultats`;
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
