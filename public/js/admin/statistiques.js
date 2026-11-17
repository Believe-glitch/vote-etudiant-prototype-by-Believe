// Onglet « Statistiques » : combien de codes ont été remis, par promotion,
// par faculté, par site et pour toute l'université.

import { api, e, pourcentage } from '../commun.js';
import { brancherFiltrePromotion, pourComparer } from '../filtres.js';

function ligne(nom, t, classe = '') {
  return `
    <tr class="${classe}">
      <td>${e(nom)}</td>
      <td class="nombre">${t.inscrits}</td>
      <td class="nombre">${t.codesActifs}</td>
      <td class="nombre">${pourcentage(t.codesActifs, t.inscrits)} %</td>
      <td class="nombre">${t.codesRemplaces}</td>
    </tr>`;
}

function tableau(titre, lignes) {
  return `
    <section class="carte section">
      <h2>${e(titre)}</h2>
      <div class="tableau-conteneur"><table>
        <thead><tr><th>${e(titre === 'Par promotion' ? 'Promotion' : 'Nom')}</th>
          <th class="nombre">Inscrits</th><th class="nombre">Codes remis</th>
          <th class="nombre">Part remise</th><th class="nombre">Remplacements</th></tr></thead>
        <tbody>${lignes}</tbody>
      </table></div>
    </section>`;
}

// Additionne les lignes de promotions, regroupées selon cleDe().
function totaliser(promotions, cleDe) {
  const totaux = new Map();
  for (const p of promotions) {
    const cle = cleDe(p);
    const t = totaux.get(cle) ?? { nom: cle, inscrits: 0, codesActifs: 0, codesRemplaces: 0 };
    t.inscrits += p.inscrits;
    t.codesActifs += p.codesActifs;
    t.codesRemplaces += p.codesRemplaces;
    totaux.set(cle, t);
  }
  return [...totaux.values()];
}

export async function afficherStatistiques(conteneur) {
  const [stats, structure] = await Promise.all([api('/api/admin/statistiques'), api('/api/structure')]);

  conteneur.innerHTML = `
    <p class="texte-doux">Un remplacement = un code perdu, annulé puis remplacé. Après le vote, comparez les codes remis et le nombre de votants : un écart anormal se voit tout de suite.</p>
    ${tableau('Université', ligne(stats.universite.nom, stats.universite, 'total'))}
    <form id="filtres-stats" class="carte carte-simple filtres section" role="search" aria-label="Filtrer les statistiques">
      <h2 class="petit-titre">Filtrer</h2>
      <div class="grille-filtres">
        <div class="champ"><label for="s-site">Site</label><select id="s-site"></select></div>
        <div class="champ"><label for="s-faculte">Faculté</label><select id="s-faculte"></select></div>
        <div class="champ"><label for="s-promotion">Promotion</label><select id="s-promotion"></select></div>
        <div class="champ"><label for="s-texte">Recherche</label><input id="s-texte" type="search" placeholder="ex. L2, Droit…" autocomplete="off"></div>
      </div>
      <button id="s-effacer" class="bouton bouton-contour bouton-petit" type="button">Effacer les filtres</button>
    </form>
    <div id="s-tableaux"></div>`;

  const texte = conteneur.querySelector('#s-texte');
  const zone = conteneur.querySelector('#s-tableaux');

  function afficher() {
    const cherche = pourComparer(texte.value);
    const choisies = stats.promotions.filter((p) =>
      filtre.correspond(p.promotionId) && (!cherche || pourComparer(p.promotion).includes(cherche)));
    if (choisies.length === 0) {
      zone.innerHTML = '<p class="texte-doux section">Aucune promotion ne correspond à ces filtres.</p>';
      return;
    }
    const filtreActif = choisies.length !== stats.promotions.length;
    const [selection] = totaliser(choisies, () => 'Total de la sélection');
    zone.innerHTML = `
      ${filtreActif ? tableau('Sélection', ligne(selection.nom, selection, 'total')) : ''}
      ${tableau('Par site', totaliser(choisies, (p) => p.campus).map((t) => ligne(t.nom, t)).join(''))}
      ${tableau('Par faculté', totaliser(choisies, (p) => `${p.faculte} · ${p.campus}`).map((t) => ligne(t.nom, t)).join(''))}
      ${tableau('Par promotion', choisies.map((p) => ligne(p.promotion, p)).join(''))}`;
  }

  const filtre = brancherFiltrePromotion({
    site: conteneur.querySelector('#s-site'),
    faculte: conteneur.querySelector('#s-faculte'),
    promotion: conteneur.querySelector('#s-promotion'),
  }, structure, afficher);
  texte.addEventListener('input', afficher);
  conteneur.querySelector('#filtres-stats').addEventListener('submit', (evenement) => evenement.preventDefault());
  conteneur.querySelector('#s-effacer').addEventListener('click', () => {
    filtre.reinitialiser();
    texte.value = '';
    afficher();
  });
  afficher();
}
