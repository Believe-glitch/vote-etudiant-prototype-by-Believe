// Page des résultats.
//   /resultats              : la liste des résultats dévoilés et de ceux en attente ;
//   /resultats?scrutin=12   : le détail d'un scrutin, avec l'animation du dévoilement.
//
// Pensée aussi pour être projetée dans la salle : quand le superviseur clique
// sur « Dévoiler », la page projetée lance l'animation toute seule.

import {
  api, e, ecouterDirect, blocSeance, appliquerLargeurs, lancerDecomptes, marquerPageCourante, sessionEtudiant,
} from './commun.js';
import { brancherFiltrePromotion, pourComparer } from './filtres.js';
import { afficherDetail, brancherLiensResultats } from './resultat-anime.js';

marquerPageCourante();
lancerDecomptes();

const scrutinId = Number(new URLSearchParams(location.search).get('scrutin'));

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
          <a class="carte" href="/resultats?scrutin=${s.scrutinId}" data-resultat="${s.scrutinId}">
            <h3>${e(s.nomPoste)}${s.tour > 1 ? ` · ${s.tour}e tour` : ''}</h3>
            <p class="texte-doux petit">${e(s.promotion ?? 'Toute l’université')} · séance de ${e(s.campus)}</p>
            ${blocSeance(s)}
          </a>`).join('');
    appliquerLargeurs(zoneAttente);
    zoneDevoiles.innerHTML = resultats.length === 0
      ? `<p class="texte-doux">${devoiles.length === 0 ? 'Aucun résultat dévoilé pour le moment.' : 'Aucun résultat ne correspond à ces filtres.'}</p>`
      : resultats.map((r) => `
          <a class="carte" href="/resultats?scrutin=${r.id}" data-resultat="${r.id}">
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

  // Étudiant connecté : on part de sa promotion (la présidence reste toujours
  // visible). Le bouton « Voir toute l'université » remet tous les filtres.
  const session = await sessionEtudiant();
  if (session.connecte) {
    filtre.choisir(session.promotionId);
    const blocPourVous = document.querySelector('#pour-vous');
    document.querySelector('#pour-vous-texte').textContent = `${session.promotion} + Présidence de l’université`;
    blocPourVous.classList.remove('cache');
    const toutVoir = () => blocPourVous.classList.add('cache');
    document.querySelector('#voir-tout').addEventListener('click', () => {
      filtre.reinitialiser();
      toutVoir();
      afficher();
    });
    // Dès qu'il change lui-même un filtre, le rappel « pour vous » disparaît.
    document.querySelector('#filtres').addEventListener('change', toutVoir);
  }
  afficher();   // la liste suit tout de suite le filtre choisi

  // Un clic sur un résultat ouvre la fenêtre plein écran.
  brancherLiensResultats(zoneAttente);
  brancherLiensResultats(zoneDevoiles);

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
// Vue détail : /resultats?scrutin=12 (lien direct, ou projection dans la salle)
// ---------------------------------------------------------------------

function demarrerDetail() {
  document.querySelector('#vue-detail').classList.remove('cache');
  afficherDetail(scrutinId, document.querySelector('#vue-detail'), { titreDuDocument: true });
}
