// Onglets « Remise des codes » (distributeur) et « Listes des inscrits »
// (superviseur et observateur, en lecture seule).
//
// Devant l'officiel, l'étudiant donne son nom, sa promotion et son site.
// Le distributeur l'inscrit dans la liste de sa promotion : son code est
// créé et affiché UNE seule fois. La liste se consulte, se filtre et
// s'imprime (liste d'émargement, avec une colonne pour la signature).

import { api, e, afficherMessage, formaterDateHeure } from '../commun.js';
import { confirmer, demanderTexte, montrer } from './dialogue.js';

const MEMOIRE = 'promotion-listes';

// Même règle que le serveur : minuscules, sans accents.
function pourComparer(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function afficherListes(conteneur, moi) {
  const estDistributeur = moi.role === 'distributeur';
  const structure = await api('/api/structure');

  conteneur.innerHTML = `
    <section class="carte carte-simple sans-impression">
      <h2>${estDistributeur ? '1. Choisir la promotion de l’étudiant' : 'Choisir une promotion'}</h2>
      <div class="grille-3">
        <div class="champ"><label for="choix-site">Site</label><select id="choix-site"></select></div>
        <div class="champ"><label for="choix-faculte">Faculté</label><select id="choix-faculte"></select></div>
        <div class="champ"><label for="choix-promo">Promotion</label><select id="choix-promo"></select></div>
      </div>
    </section>

    ${estDistributeur ? `
    <section class="carte section sans-impression">
      <h2>2. Inscrire l’étudiant et lui remettre son code</h2>
      <p class="texte-doux petit">L’étudiant doit être présent. Tapez son nom tel qu’il l’épelle ; le matricule est facultatif.</p>
      <form id="inscription" novalidate>
        <div class="grille-2">
          <div class="champ"><label for="nom">Nom *</label><input id="nom" type="text" maxlength="60" autocomplete="off" autocapitalize="characters"></div>
          <div class="champ"><label for="postnom">Postnom</label><input id="postnom" type="text" maxlength="60" autocomplete="off"></div>
          <div class="champ"><label for="prenom">Prénom</label><input id="prenom" type="text" maxlength="60" autocomplete="off"></div>
          <div class="champ"><label for="matricule">Matricule (facultatif)</label><input id="matricule" type="text" maxlength="40" autocomplete="off"></div>
        </div>
        <div id="message-inscription"></div>
        <button class="bouton bouton-accent" type="submit">Inscrire et remettre le code</button>
      </form>
    </section>` : ''}

    <section class="carte section" id="zone-liste">
      <div class="seulement-impression titre-impression">
        <p class="logo-mot sur-clair">URKIM<span class="logo-accent">eV</span>ote</p>
        <h1>Liste d’émargement</h1>
      </div>
      <div class="ligne-flex">
        <div>
          <h2 id="titre-liste">Liste de la promotion</h2>
          <p id="resume-liste" class="texte-doux petit"></p>
        </div>
        <button id="imprimer" class="bouton bouton-contour sans-impression" type="button">Imprimer la liste</button>
      </div>
      <div class="champ sans-impression">
        <label for="filtre-liste">Rechercher un nom dans la liste</label>
        <input id="filtre-liste" type="search" placeholder="ex. Matondo" autocomplete="off">
      </div>
      <div id="message-liste"></div>
      <div id="tableau-liste"></div>
      <p class="seulement-impression petit" id="date-impression"></p>
    </section>`;

  const selectSite = conteneur.querySelector('#choix-site');
  const selectFaculte = conteneur.querySelector('#choix-faculte');
  const selectPromo = conteneur.querySelector('#choix-promo');
  const zoneTableau = conteneur.querySelector('#tableau-liste');
  const zoneMessageListe = conteneur.querySelector('#message-liste');
  const champFiltre = conteneur.querySelector('#filtre-liste');
  let liste = null;
  let dernierInscrit = null;

  // --- Choix de la promotion (site → faculté → promotion) -------------------

  const options = (elements, texte) => elements.map((x) => `<option value="${x.id}">${e(texte(x))}</option>`).join('');

  function remplirFacultes() {
    const campusId = Number(selectSite.value);
    const facultes = structure.facultes.filter((f) =>
      structure.promotions.some((p) => p.campusId === campusId && p.faculteId === f.id));
    selectFaculte.innerHTML = options(facultes, (f) => f.nom);
    remplirPromotions();
  }
  function remplirPromotions() {
    const campusId = Number(selectSite.value);
    const faculteId = Number(selectFaculte.value);
    const promotions = structure.promotions.filter((p) => p.campusId === campusId && p.faculteId === faculteId);
    selectPromo.innerHTML = options(promotions, (p) => p.niveau + (p.filiere ? ` · ${p.filiere}` : ''));
    charger();
  }

  selectSite.innerHTML = options(structure.campus, (c) => c.nom);
  selectSite.addEventListener('change', remplirFacultes);
  selectFaculte.addEventListener('change', remplirPromotions);
  selectPromo.addEventListener('change', () => charger());

  // --- La liste ----------------------------------------------------------------

  async function charger() {
    const promotionId = Number(selectPromo.value);
    if (!promotionId) {
      zoneTableau.innerHTML = '<p class="texte-doux">Aucune promotion pour ce choix.</p>';
      return;
    }
    sessionStorage.setItem(MEMOIRE, String(promotionId));
    try {
      liste = await api(`/api/admin/promotions/${promotionId}/etudiants`);
      afficherMessage(zoneMessageListe, '');
    } catch (erreur) {
      afficherMessage(zoneMessageListe, erreur.message);
      return;
    }
    conteneur.querySelector('#titre-liste').textContent = liste.promotion.libelle;
    conteneur.querySelector('#resume-liste').textContent =
      `${liste.inscrits} étudiant${liste.inscrits > 1 ? 's' : ''} inscrit${liste.inscrits > 1 ? 's' : ''} · ${liste.codesRemis} code${liste.codesRemis > 1 ? 's' : ''} remis`;
    afficherTableau();
  }

  function afficherTableau() {
    const filtre = pourComparer(champFiltre.value);
    const visibles = liste.etudiants.filter((et) => !filtre || pourComparer(`${et.nomComplet} ${et.matricule ?? ''}`).includes(filtre));
    if (liste.etudiants.length === 0) {
      zoneTableau.innerHTML = '<p class="texte-doux">Personne n’est encore inscrit dans cette promotion.</p>';
      return;
    }
    if (visibles.length === 0) {
      zoneTableau.innerHTML = '<p class="texte-doux">Aucun nom ne correspond à la recherche.</p>';
      return;
    }
    zoneTableau.innerHTML = `
      <div class="tableau-conteneur"><table class="tableau-liste">
        <thead><tr>
          <th class="nombre">N°</th><th>Nom, postnom, prénom</th><th>Matricule</th><th>Code</th>
          ${estDistributeur ? '<th class="sans-impression">Action</th>' : ''}
          <th class="seulement-impression colonne-signature">Signature</th>
        </tr></thead>
        <tbody>${visibles.map((et) => `
          <tr${et.id === dernierInscrit ? ' class="ligne-nouvelle"' : ''}>
            <td class="nombre">${et.numero}</td>
            <td><strong>${e(et.nomComplet)}</strong>${et.inscritPar ? `<br><span class="petit texte-doux sans-impression">Inscrit par ${e(et.inscritPar)}</span>` : ''}</td>
            <td>${e(et.matricule ?? '—')}</td>
            <td>${et.codeRemisLe
              ? `Remis le ${e(formaterDateHeure(et.codeRemisLe))}${et.remplacements ? ` <span class="pastille">${et.remplacements} remplacement${et.remplacements > 1 ? 's' : ''}</span>` : ''}`
              : '<span class="texte-doux">Pas encore remis</span>'}</td>
            ${estDistributeur ? `<td class="sans-impression">${et.codeRemisLe
              ? `<button class="bouton bouton-contour bouton-petit" data-action="remplacer" data-id="${et.id}" type="button">Remplacer (perdu)</button>`
              : `<button class="bouton bouton-accent bouton-petit" data-action="generer" data-id="${et.id}" type="button">Remettre le code</button>`}</td>` : ''}
            <td class="seulement-impression colonne-signature"></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
    const nouvelle = zoneTableau.querySelector('.ligne-nouvelle');
    if (nouvelle) nouvelle.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  champFiltre.addEventListener('input', () => { if (liste) afficherTableau(); });

  conteneur.querySelector('#imprimer').addEventListener('click', () => {
    champFiltre.value = '';
    afficherTableau();
    conteneur.querySelector('#date-impression').textContent =
      `Imprimée le ${new Date().toLocaleString('fr-FR')} · ${liste.inscrits} inscrits · ${liste.codesRemis} codes remis. Les codes eux-mêmes ne figurent sur aucune liste.`;
    window.print();
  });

  // --- Affichage du code (une seule fois) ------------------------------------------

  async function montrerCode(nomComplet, code) {
    await montrer(`
      <h2>Code de ${e(nomComplet)}</h2>
      <p class="code-affiche">${e(code)}</p>
      <p>Montrez ou dictez ce code à l’étudiant, qui le recopie. <strong>Il ne sera plus jamais affiché</strong>, ni ici ni sur la liste imprimée.</p>`, 'Le code est remis');
  }

  // --- Inscription (distributeur) -----------------------------------------------

  if (estDistributeur) {
    const formulaire = conteneur.querySelector('#inscription');
    const zoneMessage = conteneur.querySelector('#message-inscription');

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      const identite = {
        nom: formulaire.querySelector('#nom').value.trim(),
        postnom: formulaire.querySelector('#postnom').value.trim(),
        prenom: formulaire.querySelector('#prenom').value.trim(),
        matricule: formulaire.querySelector('#matricule').value.trim(),
      };
      if (identite.nom.length < 2) return afficherMessage(zoneMessage, 'Indiquez le nom de l’étudiant.');
      if (!identite.postnom && !identite.prenom) return afficherMessage(zoneMessage, 'Indiquez aussi le postnom ou le prénom.');
      afficherMessage(zoneMessage, '');

      const nomComplet = [identite.nom, identite.postnom, identite.prenom].filter(Boolean).join(' ');
      const ok = await confirmer({
        titre: 'Vérifier avant d’inscrire',
        texte: `<strong>${e(nomComplet)}</strong><br>${e(liste?.promotion.libelle ?? '')}<br><br>L’orthographe est-elle juste, et l’étudiant est-il bien présent ?`,
        bouton: 'Oui, inscrire et créer le code',
      });
      if (!ok) return;

      const adresse = `/api/admin/promotions/${Number(selectPromo.value)}/inscrire`;
      let reponse;
      try {
        reponse = await api(adresse, { methode: 'POST', corps: identite });
      } catch (erreur) {
        if (erreur.statut !== 409 || !/déjà inscrit/.test(erreur.message)) {
          afficherMessage(zoneMessage, erreur.message);
          return;
        }
        // Même nom déjà dans la liste : on demande confirmation.
        const autrePersonne = await confirmer({
          titre: 'Nom déjà dans la liste',
          texte: e(erreur.message),
          bouton: 'C’est une autre personne, inscrire',
          danger: true,
        });
        if (!autrePersonne) return;
        try {
          reponse = await api(adresse, { methode: 'POST', corps: { ...identite, confirmerHomonyme: true } });
        } catch (erreur2) {
          afficherMessage(zoneMessage, erreur2.message);
          return;
        }
      }

      await montrerCode(reponse.nomComplet, reponse.code);
      formulaire.reset();
      dernierInscrit = reponse.etudiantId;
      afficherMessage(zoneMessage, `${reponse.nomComplet} est inscrit et a reçu son code.`, 'ok');
      await charger();
      formulaire.querySelector('#nom').focus();
    });

    zoneTableau.addEventListener('click', async (evenement) => {
      const bouton = evenement.target.closest('[data-action]');
      if (!bouton) return;
      const etudiant = liste.etudiants.find((et) => et.id === Number(bouton.dataset.id));
      const identite = `<strong>${e(etudiant.nomComplet)}</strong> (${e(liste.promotion.libelle)})`;
      let code;
      try {
        if (bouton.dataset.action === 'generer') {
          const ok = await confirmer({
            titre: 'Remettre le code',
            texte: `${identite} est-il bien présent ?`,
            bouton: 'Oui, créer son code',
          });
          if (!ok) return;
          ({ code } = await api(`/api/admin/etudiants/${etudiant.id}/code`, { methode: 'POST' }));
        } else {
          const motif = await demanderTexte({
            titre: 'Remplacer un code perdu',
            texte: `L’ancien code de ${identite} sera annulé. Les votes déjà faits avec lui restent comptés.`,
            etiquette: 'Motif (ex. « code perdu »)',
            bouton: 'Annuler l’ancien et créer le nouveau',
          });
          if (!motif) return;
          ({ code } = await api(`/api/admin/etudiants/${etudiant.id}/remplacer-code`, { methode: 'POST', corps: { motif } }));
        }
      } catch (erreur) {
        afficherMessage(zoneMessageListe, erreur.message);
        return;
      }
      await montrerCode(etudiant.nomComplet, code);
      dernierInscrit = etudiant.id;
      await charger();
    });
  }

  // Au démarrage : la dernière promotion choisie, sinon la première.
  const memoire = structure.promotions.find((p) => p.id === Number(sessionStorage.getItem(MEMOIRE)));
  if (memoire) {
    selectSite.value = memoire.campusId;
    remplirFacultes();
    selectFaculte.value = memoire.faculteId;
    remplirPromotions();
    selectPromo.value = memoire.id;
    await charger();
  } else {
    remplirFacultes();
  }
}
