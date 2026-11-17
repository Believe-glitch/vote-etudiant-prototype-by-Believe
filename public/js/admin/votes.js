// Onglet « Votes » : candidats, ouverture et fermeture des séances,
// dévoilement des résultats, second tour.
// Le superviseur agit ; l'observateur voit la même chose sans les boutons.

import {
  api, e, photoCandidat, afficherMessage, ecouterDirect, blocSeance, appliquerLargeurs,
} from '../commun.js';
import { confirmer, montrer } from './dialogue.js';

const ORDRE_POSTES = { CP: 1, CPA: 2, SECRETAIRE: 3, PRESIDENCE: 4 };
const STATUTS = {
  preparation: ['En préparation', ''],
  en_cours: ['Vote en cours', 'pastille-ouvert'],
  termine: ['Vote terminé, résultats non dévoilés', 'pastille-ferme'],
  devoile: ['Résultats dévoilés', 'pastille-devoile'],
};

export async function afficherVotes(conteneur, moi) {
  const estSuperviseur = moi.role === 'superviseur';
  const structure = await api('/api/structure');

  const optionsPromotions = structure.campus.map((c) => `
    <optgroup label="${e(c.nom)}">
      ${structure.promotions.filter((p) => p.campusId === c.id)
        .map((p) => `<option value="${p.id}">${e(p.libelle)}</option>`).join('')}
    </optgroup>`).join('');

  conteneur.innerHTML = `
    <section class="carte carte-simple">
      <label for="choix-scrutins">Afficher les votes de</label>
      <select id="choix-scrutins">
        <option value="presidence">Présidence de l’université</option>
        ${optionsPromotions}
      </select>
      ${estSuperviseur ? '' : '<p class="texte-doux petit section">Mode observateur : vous voyez tout, sans pouvoir rien modifier.</p>'}
    </section>
    <div id="message-votes"></div>
    <div id="liste-votes" class="section"></div>`;

  const choix = conteneur.querySelector('#choix-scrutins');
  const zoneListe = conteneur.querySelector('#liste-votes');
  const zoneMessage = conteneur.querySelector('#message-votes');

  const memoire = sessionStorage.getItem('choix-scrutins');
  if (memoire && [...choix.options].some((o) => o.value === memoire)) choix.value = memoire;

  let scrutins = [];
  let resultats = new Map();     // résultats des scrutins dévoilés (pour égalité / second tour)
  let signature = '';

  async function charger() {
    const valeur = choix.value;
    sessionStorage.setItem('choix-scrutins', valeur);
    const adresse = valeur === 'presidence'
      ? '/api/admin/scrutins?presidence=oui'
      : `/api/admin/scrutins?promotion=${valeur}`;
    try {
      scrutins = (await api(adresse))
        .sort((a, b) => ORDRE_POSTES[a.poste] - ORDRE_POSTES[b.poste] || b.tour - a.tour);
      resultats = new Map();
      for (const s of scrutins.filter((x) => x.statut === 'devoile' && !x.eluDOffice)) {
        resultats.set(s.id, await api(`/api/resultats/${s.id}`));
      }
    } catch (erreur) {
      afficherMessage(zoneMessage, erreur.message);
      return;
    }
    const groupe = estSuperviseur && valeur !== 'presidence' ? blocGroupe() : '';
    zoneListe.innerHTML = groupe + scrutins.map(blocScrutin).join('');
    appliquerLargeurs(zoneListe);
  }

  // Ouverture groupée : CP, CPA et secrétaire de la promotion, même durée.
  const NOMS_GROUPE = { CP: 'CP', CPA: 'CPA', SECRETAIRE: 'Secrétaire' };
  function blocGroupe() {
    const unVoteOuvert = scrutins.some((s) => s.seances.some((se) => se.statut === 'ouverte'));
    return `
      <article class="carte groupe-promotion">
        <h2>Toute la promotion en une fois</h2>
        <p class="texte-doux petit">Ouvre les postes cochés en même temps, avec la même durée.
          Un vote qui ne peut pas s’ouvrir (un seul candidat, déjà ouvert…) est signalé et laissé de côté.</p>
        <form class="rangee-boutons" data-action="ouvrir-groupe">
          ${Object.entries(NOMS_GROUPE).map(([poste, nom]) => `
            <label class="case"><input type="checkbox" name="poste" value="${poste}" checked> ${nom}</label>`).join('')}
          <label class="case" for="duree-groupe">Durée (minutes)</label>
          <input id="duree-groupe" class="champ-duree" name="duree" type="number" min="1" max="240" value="20" required>
          <button class="bouton" type="submit">Ouvrir les votes cochés</button>
        </form>
        ${unVoteOuvert ? `<div class="rangee-boutons section">
          <button class="bouton bouton-danger bouton-petit" data-action="fermer-groupe" type="button">Fermer tous les votes ouverts de la promotion</button></div>` : ''}
      </article>`;
  }

  function blocScrutin(s) {
    const [texteStatut, classeStatut] = STATUTS[s.statut];
    const modifiable = estSuperviseur && s.statut === 'preparation' && s.parentId === null;
    const nombre = s.candidats.length;

    const candidats = nombre === 0
      ? '<p class="texte-doux">Aucun candidat : le poste est vacant.</p>'
      : `<div class="liste-candidats">${s.candidats.map((c) => `
          <div class="candidat">
            ${photoCandidat(c)}
            <div>
              <div class="candidat-nom">${e(c.nom)}</div>
              ${c.slogan ? `<p class="candidat-slogan">${e(c.slogan)}</p>` : ''}
              ${modifiable ? `
                <div class="rangee-boutons section">
                  <label class="bouton bouton-contour bouton-petit">Photo
                    <input class="cache" type="file" accept="image/*" data-action="photo" data-candidat="${c.id}">
                  </label>
                  <button class="bouton bouton-contour bouton-petit" data-action="retirer" data-candidat="${c.id}" type="button">Retirer</button>
                </div>` : ''}
            </div>
          </div>`).join('')}</div>`;

    const ajout = modifiable ? `
      <form class="grille-3 section" data-action="ajouter" data-scrutin="${s.id}">
        <div class="champ"><label for="nom-${s.id}">Nom du candidat</label>
          <input id="nom-${s.id}" name="nom" type="text" maxlength="80" required></div>
        <div class="champ"><label for="slogan-${s.id}">Slogan (facultatif)</label>
          <input id="slogan-${s.id}" name="slogan" type="text" maxlength="140"></div>
        <div class="champ"><label>&nbsp;</label>
          <button class="bouton bouton-large" type="submit">Ajouter le candidat</button></div>
      </form>` : '';

    const modePresidence = s.poste === 'PRESIDENCE' ? `
      <div class="section">
        <label for="mode-${s.id}">Dévoilement des résultats</label>
        ${estSuperviseur && s.statut === 'preparation' ? `
          <select id="mode-${s.id}" data-action="mode" data-scrutin="${s.id}">
            <option value="total" ${s.modeDevoilement === 'total' ? 'selected' : ''}>Seulement le total, après les deux sites</option>
            <option value="par_site" ${s.modeDevoilement === 'par_site' ? 'selected' : ''}>Chaque site à la fin de sa séance</option>
          </select>
          <p class="texte-doux petit">À choisir avant le vote : ce choix se verrouille à l’ouverture.</p>`
        : `<p>${s.modeDevoilement === 'total' ? 'Seulement le total, après les deux sites' : 'Chaque site à la fin de sa séance'} (verrouillé)</p>`}
      </div>` : '';

    const eluDOffice = estSuperviseur && s.statut === 'preparation' && nombre === 1 ? `
      <div class="message section">Un seul candidat : il n’y a pas de vote à organiser.
        <div class="section"><button class="bouton bouton-accent" data-action="elu-d-office" data-scrutin="${s.id}" type="button">Déclarer élu(e) d’office</button></div>
      </div>` : '';

    const seances = s.eluDOffice ? '' : s.seances.map((se) => blocSeanceAdmin(s, se, nombre)).join('');

    return `
      <article class="carte scrutin-admin">
        <div class="ligne-flex">
          <h2>${e(s.nomPoste)}${s.tour > 1 ? ` <span class="pastille">${s.tour}e tour</span>` : ''}</h2>
          <span class="pastille ${classeStatut}">${s.eluDOffice ? 'Élu(e) d’office' : texteStatut}</span>
        </div>
        <p class="texte-doux petit">${e(s.promotion ?? 'Toute l’université')}${s.parentId ? ' · candidats à égalité au tour précédent' : ''}</p>
        ${candidats}
        ${ajout}
        ${modePresidence}
        ${eluDOffice}
        ${seances}
        ${blocFin(s)}
      </article>`;
  }

  function blocSeanceAdmin(s, se, nombreCandidats) {
    let actions = '';
    if (estSuperviseur && se.statut === 'attente' && nombreCandidats >= 2) {
      actions = `
        <form class="rangee-boutons" data-action="ouvrir" data-scrutin="${s.id}" data-campus="${se.campusId}">
          <label for="duree-${s.id}-${se.campusId}">Durée (minutes)</label>
          <input id="duree-${s.id}-${se.campusId}" class="champ-duree" name="duree" type="number" min="1" max="240" value="20" required>
          <button class="bouton bouton-accent" type="submit">Ouvrir le vote</button>
        </form>`;
    } else if (estSuperviseur && se.statut === 'ouverte') {
      actions = `
        <div class="rangee-boutons">
          <button class="bouton bouton-contour bouton-petit" data-action="prolonger" data-scrutin="${s.id}" data-campus="${se.campusId}" type="button">+5 minutes</button>
          <button class="bouton bouton-danger bouton-petit" data-action="fermer" data-scrutin="${s.id}" data-campus="${se.campusId}" type="button">Fermer maintenant</button>
        </div>`;
    } else if (estSuperviseur && se.statut === 'fermee' && s.modeDevoilement === 'par_site' && !se.devoilee && s.statut !== 'devoile') {
      actions = `<button class="bouton bouton-accent" data-action="devoiler-site" data-scrutin="${s.id}" data-campus="${se.campusId}" type="button">Dévoiler les résultats de ${e(se.campus)}</button>`;
    }

    const etat = se.statut === 'attente'
      ? '<p class="texte-doux">Pas encore ouverte.</p>'
      : `<div data-seance="${s.id}-${se.campusId}">${blocSeance(se)}</div>`;

    return `
      <div class="seance-admin">
        <div class="ligne-flex"><h3>Séance de ${e(se.campus)}</h3>${se.devoilee && s.statut !== 'devoile' ? '<span class="pastille pastille-devoile">Site dévoilé</span>' : ''}</div>
        ${etat}
        ${actions}
      </div>`;
  }

  function blocFin(s) {
    const morceaux = [];
    if (estSuperviseur && s.statut === 'termine') {
      morceaux.push(`<button class="bouton bouton-accent" data-action="devoiler" data-scrutin="${s.id}" type="button">Dévoiler les résultats</button>`);
    }
    if (['termine', 'devoile'].includes(s.statut) && !s.eluDOffice) {
      morceaux.push(`<button class="bouton bouton-contour" data-action="votants" data-scrutin="${s.id}" type="button">Voir qui a voté</button>`);
    }
    if (s.statut === 'devoile') {
      morceaux.push(`<a class="bouton bouton-contour" href="/resultats?scrutin=${s.id}" target="_blank" rel="noopener">Résultats animés (projection)</a>`);
    }
    let resume = '';
    const r = resultats.get(s.id);
    if (r) {
      const nomDe = (id) => r.candidats.find((c) => c.id === id)?.nom ?? '';
      resume = r.places.map((p) => `<div class="message message-ok"><strong>${e(p.nomPlace)} :</strong> ${e(nomDe(p.candidatId))}</div>`).join('');
      if (r.egalite) {
        resume += `<div class="message"><strong>Égalité</strong> entre ${r.egalite.candidatIds.map(nomDe).map(e).join(', ')}.
          ${r.secondTourId ? 'Le second tour est créé (voir plus haut).' : ''}</div>`;
        if (!r.secondTourId && estSuperviseur) {
          morceaux.push(`<button class="bouton bouton-accent" data-action="second-tour" data-scrutin="${s.id}" type="button">Lancer le second tour</button>`);
        }
      }
    }
    if (morceaux.length === 0 && !resume) return '';
    return `<div class="section">${resume}<div class="rangee-boutons section">${morceaux.join('')}</div></div>`;
  }

  // --- Actions -----------------------------------------------------------------

  async function agir(appel, messageReussite) {
    try {
      await appel();
      afficherMessage(zoneMessage, messageReussite, 'ok');
    } catch (erreur) {
      afficherMessage(zoneMessage, erreur.message);
    }
    await charger();
  }

  const scrutinDe = (element) => Number(element.dataset.scrutin);
  const campusDe = (element) => Number(element.dataset.campus);

  zoneListe.addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    const formulaire = evenement.target;
    const id = scrutinDe(formulaire);

    if (formulaire.dataset.action === 'ajouter') {
      const nom = formulaire.elements.nom.value.trim();
      const slogan = formulaire.elements.slogan.value.trim();
      if (nom.length < 2) return afficherMessage(zoneMessage, 'Entrez le nom du candidat.');
      await agir(() => api(`/api/admin/scrutins/${id}/candidats`, { methode: 'POST', corps: { nom, slogan } }),
        `Candidat « ${nom} » ajouté.`);
    }

    if (formulaire.dataset.action === 'ouvrir-groupe') {
      const postes = [...formulaire.querySelectorAll('input[name="poste"]:checked')].map((x) => x.value);
      const dureeMinutes = Number(formulaire.elements.duree.value);
      if (postes.length === 0) return afficherMessage(zoneMessage, 'Cochez au moins un poste.');
      const promotion = choix.selectedOptions[0].textContent;
      const ok = await confirmer({
        titre: 'Ouvrir plusieurs votes',
        texte: `Tu vas ouvrir <strong>${postes.map((p) => NOMS_GROUPE[p]).join(', ')}</strong>
          pour <strong>${e(promotion)}</strong>, pendant <strong>${dureeMinutes} minutes</strong>.
          Les listes de candidats ne pourront plus changer.`,
        bouton: 'Ouvrir ces votes',
      });
      if (!ok) return;
      try {
        const r = await api(`/api/admin/promotions/${Number(choix.value)}/ouvrir-votes`, { methode: 'POST', corps: { postes, dureeMinutes } });
        const ouverts = r.ouverts.map((o) => NOMS_GROUPE[o.poste]).join(', ');
        const ignores = r.ignores.map((i) => `${NOMS_GROUPE[i.poste]} (${i.raison})`).join(' ; ');
        afficherMessage(zoneMessage,
          `${ouverts ? `Votes ouverts : ${ouverts}.` : 'Aucun vote ouvert.'}${ignores ? ` Laissé${r.ignores.length > 1 ? 's' : ''} de côté : ${ignores}` : ''}`,
          r.ouverts.length ? 'ok' : undefined);
      } catch (erreur) {
        afficherMessage(zoneMessage, erreur.message);
      }
      await charger();
    }

    if (formulaire.dataset.action === 'ouvrir') {
      const dureeMinutes = Number(formulaire.elements.duree.value);
      const scrutin = scrutins.find((x) => x.id === id);
      const seance = scrutin.seances.find((se) => se.campusId === campusDe(formulaire));
      const ok = await confirmer({
        titre: 'Ouvrir le vote',
        texte: `${e(scrutin.nomPoste)} · séance de ${e(seance.campus)}, pendant <strong>${dureeMinutes} minutes</strong>.
          La liste des candidats ne pourra plus changer.`,
        bouton: 'Ouvrir le vote',
      });
      if (!ok) return;
      await agir(() => api(`/api/admin/scrutins/${id}/seances/${seance.campusId}/ouvrir`, { methode: 'POST', corps: { dureeMinutes } }),
        'Le vote est ouvert. Le décompte a commencé.');
    }
  });

  zoneListe.addEventListener('change', async (evenement) => {
    const element = evenement.target;
    if (element.dataset.action === 'mode') {
      await agir(() => api(`/api/admin/scrutins/${scrutinDe(element)}/mode-devoilement`, { methode: 'PUT', corps: { mode: element.value } }),
        'Mode de dévoilement enregistré.');
    }
    if (element.dataset.action === 'photo' && element.files[0]) {
      const candidatId = Number(element.dataset.candidat);
      try {
        const image = await compresserImage(element.files[0]);
        await agir(() => api(`/api/admin/candidats/${candidatId}/photo`, {
          methode: 'PUT', corps: image, entetes: { 'Content-Type': 'image/jpeg' },
        }), 'Photo enregistrée.');
      } catch {
        afficherMessage(zoneMessage, 'Impossible de lire cette image. Essayez une photo JPEG ou PNG.');
      }
    }
  });

  zoneListe.addEventListener('click', async (evenement) => {
    const bouton = evenement.target.closest('button[data-action]');
    if (!bouton) return;
    const id = scrutinDe(bouton);
    const campusId = campusDe(bouton);

    switch (bouton.dataset.action) {
      case 'retirer': {
        const ok = await confirmer({ titre: 'Retirer ce candidat ?', texte: 'Il disparaîtra de la liste.', bouton: 'Retirer', danger: true });
        if (ok) await agir(() => api(`/api/admin/candidats/${bouton.dataset.candidat}`, { methode: 'DELETE' }), 'Candidat retiré.');
        break;
      }
      case 'fermer-groupe': {
        const ok = await confirmer({ titre: 'Fermer tous les votes ouverts ?', texte: 'Tous les votes ouverts de cette promotion seront fermés tout de suite.', bouton: 'Fermer les votes', danger: true });
        if (ok) {
          await agir(async () => {
            const r = await api(`/api/admin/promotions/${Number(choix.value)}/fermer-votes`, { methode: 'POST' });
            if (r.fermes.length === 0) throw new Error('Aucun vote n’était ouvert.');
          }, 'Les votes ouverts de la promotion sont fermés.');
        }
        break;
      }
      case 'prolonger':
        await agir(() => api(`/api/admin/scrutins/${id}/seances/${campusId}/prolonger`, { methode: 'POST', corps: { minutes: 5 } }),
          'Vote prolongé de 5 minutes.');
        break;
      case 'fermer': {
        const ok = await confirmer({ titre: 'Fermer le vote maintenant ?', texte: 'Plus aucun vote ne sera accepté pour cette séance.', bouton: 'Fermer le vote', danger: true });
        if (ok) await agir(() => api(`/api/admin/scrutins/${id}/seances/${campusId}/fermer`, { methode: 'POST' }), 'Le vote est fermé.');
        break;
      }
      case 'devoiler': {
        const ok = await confirmer({ titre: 'Dévoiler les résultats ?', texte: 'Ils seront visibles par tout le monde, tout de suite. Ouvrez d’abord la page de projection si vous voulez l’animation devant la salle.', bouton: 'Dévoiler' });
        if (ok) await agir(() => api(`/api/admin/scrutins/${id}/devoiler`, { methode: 'POST', corps: {} }), 'Résultats dévoilés.');
        break;
      }
      case 'devoiler-site': {
        const ok = await confirmer({ titre: 'Dévoiler ce site ?', texte: 'Les résultats de ce site seront visibles par tout le monde.', bouton: 'Dévoiler' });
        if (ok) await agir(() => api(`/api/admin/scrutins/${id}/devoiler`, { methode: 'POST', corps: { campusId } }), 'Résultats du site dévoilés.');
        break;
      }
      case 'second-tour': {
        const ok = await confirmer({ titre: 'Lancer le second tour ?', texte: 'Un nouveau vote est créé entre les seuls candidats à égalité. Les mêmes codes pourront revoter.', bouton: 'Créer le second tour' });
        if (ok) await agir(() => api(`/api/admin/scrutins/${id}/second-tour`, { methode: 'POST' }), 'Second tour créé : ouvrez son vote quand la salle est prête.');
        break;
      }
      case 'elu-d-office': {
        const ok = await confirmer({ titre: 'Déclarer élu(e) d’office ?', texte: 'Le seul candidat est élu sans vote. Cette décision est définitive.', bouton: 'Déclarer élu(e)' });
        if (ok) await agir(() => api(`/api/admin/scrutins/${id}/elu-d-office`, { methode: 'POST' }), 'Candidat élu d’office.');
        break;
      }
      case 'votants': {
        try {
          const liste = await api(`/api/admin/scrutins/${id}/votants`);
          const ont = liste.filter((l) => l.a_vote).length;
          await montrer(`
            <h2>Qui a voté</h2>
            <p>${ont} sur ${liste.length} inscrits. Cette liste ne dit rien du choix de chacun.</p>
            <div class="tableau-conteneur"><table>
              <thead><tr><th>Matricule</th><th>Nom</th><th>A voté</th></tr></thead>
              <tbody>${liste.map((l) => `<tr><td>${e(l.matricule)}</td><td>${e(`${l.nom} ${l.prenom}`)}</td><td>${l.a_vote ? 'Oui' : 'Non'}</td></tr>`).join('')}</tbody>
            </table></div>`);
        } catch (erreur) {
          afficherMessage(zoneMessage, erreur.message);
        }
        break;
      }
      default:
        break;
    }
  });

  choix.addEventListener('change', () => {
    afficherMessage(zoneMessage, '');
    charger();
  });

  // --- Direct : participation et changements d'état ------------------------------

  const source = ecouterDirect((etat) => {
    const affiches = new Set(scrutins.map((s) => s.id));
    const concernees = etat.seances.filter((s) => affiches.has(s.scrutinId));
    const nouvelle = `${etat.versionResultats}|${concernees.map((s) => `${s.scrutinId}-${s.campusId}:${s.statut}:${s.fin}`).sort().join(',')}`;
    if (signature && nouvelle !== signature) {
      signature = nouvelle;
      charger();
      return;
    }
    signature = nouvelle;
    for (const s of concernees) {
      const zone = zoneListe.querySelector(`[data-seance="${s.scrutinId}-${s.campusId}"]`);
      if (zone) {
        zone.innerHTML = blocSeance(s);
        appliquerLargeurs(zone);
      }
    }
  });

  await charger();
  return () => source.close();   // appelé quand on quitte l'onglet
}

// Réduit la photo à 600 pixels au plus et la convertit en JPEG : elle pèse
// alors quelques dizaines de Ko, et la page des candidats reste rapide sur téléphone.
async function compresserImage(fichier) {
  const image = await createImageBitmap(fichier);
  const echelle = Math.min(1, 600 / Math.max(image.width, image.height));
  const toile = document.createElement('canvas');
  toile.width = Math.round(image.width * echelle);
  toile.height = Math.round(image.height * echelle);
  toile.getContext('2d').drawImage(image, 0, 0, toile.width, toile.height);
  return new Promise((resolve, reject) => {
    toile.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('conversion'))), 'image/jpeg', 0.82);
  });
}
