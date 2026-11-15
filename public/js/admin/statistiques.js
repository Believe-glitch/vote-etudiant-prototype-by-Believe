// Onglet « Statistiques » : combien de codes ont été remis, par promotion,
// par faculté, par site et pour toute l'université.

import { api, e, pourcentage } from '../commun.js';

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

export async function afficherStatistiques(conteneur) {
  const stats = await api('/api/admin/statistiques');
  conteneur.innerHTML = `
    <p class="texte-doux">Un remplacement = un code perdu, annulé puis remplacé. Après le vote, comparez « codes remis » et votants : tout écart anormal se voit.</p>
    ${tableau('Université', ligne(stats.universite.nom, stats.universite, 'total'))}
    ${tableau('Par site', stats.parSite.map((t) => ligne(t.nom, t)).join(''))}
    ${tableau('Par faculté', stats.parFaculte.map((t) => ligne(t.nom, t)).join(''))}
    ${tableau('Par promotion', stats.promotions.map((p) => ligne(p.promotion, p)).join(''))}`;
}
