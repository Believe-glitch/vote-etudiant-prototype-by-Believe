// Onglets « Inscription et codes » (distributeur) et « Listes des inscrits »
// (superviseur et observateur).
//
// Le distributeur et le superviseur peuvent corriger la liste (bouton
// « Corriger… ») : nom, code, retrait, promotion. L'observateur ne fait que lire.
//
// Devant l'officiel, l'étudiant donne son nom, sa promotion et son site.
// Le distributeur l'inscrit dans la liste de sa promotion : son code est
// créé et affiché UNE seule fois. La liste se consulte, se filtre et
// s'imprime (liste d'émargement, avec une colonne pour la signature).

import { api, e, afficherMessage, formaterDateHeure } from '../commun.js';
import { confirmer, demanderTexte, montrer, choisir, demanderFormulaire } from './dialogue.js';

const MEMOIRE = 'promotion-listes';

// Même règle que le serveur : minuscules, sans accents.
function pourComparer(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function afficherListes(conteneur, moi) {
  const estDistributeur = moi.role === 'distributeur';
  const peutCorriger = ['distributeur', 'superviseur'].includes(moi.role);
  const structure = await api('/api/structure');

  conteneur.innerHTML = `
    <p class="note-provisoire petit sans-impression" role="note">
      <strong>Méthode provisoire.</strong> Cette façon de remettre les codes sert à la démonstration.
      Elle sera améliorée après les essais (par exemple : partir de la liste officielle de chaque promotion
      et vérifier la carte d’étudiant).
    </p>
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
          ${peutCorriger ? '<th class="sans-impression">Actions</th>' : ''}
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
            ${peutCorriger ? `<td class="sans-impression"><div class="rangee-boutons">${!estDistributeur ? '' : et.codeRemisLe
              ? `<button class="bouton bouton-contour bouton-petit" data-action="remplacer" data-id="${et.id}" type="button">Remplacer (perdu)</button>`
              : `<button class="bouton bouton-accent bouton-petit" data-action="generer" data-id="${et.id}" type="button">Remettre le code</button>`}
              <button class="bouton bouton-contour bouton-petit" data-action="corriger" data-id="${et.id}" type="button">Corriger…</button></div></td>` : ''}
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
  }

  // --- Les boutons de la liste ---------------------------------------------------

  zoneTableau.addEventListener('click', async (evenement) => {
    const bouton = evenement.target.closest('[data-action]');
    if (!bouton) return;
    const etudiant = liste.etudiants.find((et) => et.id === Number(bouton.dataset.id));
    if (bouton.dataset.action === 'corriger') {
      await corriger(etudiant);
      return;
    }
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

  // --- Corriger la liste (distributeur et superviseur) ----------------------------

  // Envoie une correction ; si le serveur signale un homonyme, demande
  // confirmation et renvoie avec confirmerHomonyme.
  async function envoyerAvecHomonyme(adresse, methode, corps) {
    try {
      return await api(adresse, { methode, corps });
    } catch (erreur) {
      if (erreur.statut !== 409 || !/déjà inscrit/.test(erreur.message)) throw erreur;
      const autrePersonne = await confirmer({
        titre: 'Nom déjà dans la liste',
        texte: e(erreur.message),
        bouton: 'C’est une autre personne, continuer',
        danger: true,
      });
      if (!autrePersonne) return null;
      return api(adresse, { methode, corps: { ...corps, confirmerHomonyme: true } });
    }
  }

  async function corriger(etudiant) {
    const qui = `<strong>${e(etudiant.nomComplet)}</strong> · ${e(liste.promotion.libelle)}`;
    const choix = await choisir({
      titre: 'Corriger la liste',
      texte: qui,
      choix: [
        { valeur: 'nom', libelle: 'Corriger le nom ou le matricule', aide: 'Une faute de frappe à l’inscription.' },
        { valeur: 'promotion', libelle: 'Changer de promotion', aide: 'Inscrit dans la mauvaise promotion. Pas possible s’il a déjà voté.' },
        ...(etudiant.codeRemisLe ? [{ valeur: 'annuler', libelle: 'Annuler son code', aide: 'Le code ne marche plus. Le distributeur pourra en remettre un nouveau.', danger: true }] : []),
        { valeur: 'retirer', libelle: 'Retirer de la liste', aide: 'Inscrit par erreur. Pas possible s’il a déjà voté.', danger: true },
      ],
    });
    if (!choix) return;

    const adresse = `/api/admin/etudiants/${etudiant.id}`;
    let message = '';
    try {
      if (choix === 'nom') {
        const champ = (id, etiquette, valeur, max = 60) => `
          <div class="champ"><label for="${id}">${etiquette}</label>
          <input id="${id}" type="text" maxlength="${max}" autocomplete="off" value="${e(valeur ?? '')}"></div>`;
        const valeurs = await demanderFormulaire({
          titre: 'Corriger le nom',
          texte: qui,
          html: `<div class="grille-2">${champ('c-nom', 'Nom *', etudiant.nom)}${champ('c-postnom', 'Postnom', etudiant.postnom)}
            ${champ('c-prenom', 'Prénom', etudiant.prenom)}${champ('c-matricule', 'Matricule (facultatif)', etudiant.matricule, 40)}</div>`,
          lire: (f) => {
            const v = {
              nom: f.querySelector('#c-nom').value.trim(),
              postnom: f.querySelector('#c-postnom').value.trim(),
              prenom: f.querySelector('#c-prenom').value.trim(),
              matricule: f.querySelector('#c-matricule').value.trim(),
            };
            if (v.nom.length < 2) return 'Indiquez le nom de l’étudiant.';
            if (!v.postnom && !v.prenom) return 'Indiquez aussi le postnom ou le prénom.';
            return v;
          },
        });
        if (!valeurs) return;
        const r = await envoyerAvecHomonyme(adresse, 'PUT', valeurs);
        if (!r) return;
        message = `Nom corrigé : ${r.nomComplet}.`;
      }

      if (choix === 'promotion') {
        const valeurs = await demanderFormulaire({
          titre: 'Changer de promotion',
          texte: `${qui}<br><span class="petit">Son code actuel sera supprimé : le distributeur lui en remettra un nouveau pour sa nouvelle promotion.</span>`,
          html: `<div class="grille-3">
              <div class="champ"><label for="p-site">Site</label><select id="p-site"></select></div>
              <div class="champ"><label for="p-faculte">Faculté</label><select id="p-faculte"></select></div>
              <div class="champ"><label for="p-promo">Promotion</label><select id="p-promo"></select></div>
            </div>
            <div class="champ"><label for="p-motif">Motif</label><input id="p-motif" type="text" maxlength="200" placeholder="ex. inscrit en L1 au lieu de L2"></div>`,
          bouton: 'Changer de promotion',
          preparer: (f) => {
            const site = f.querySelector('#p-site');
            const faculte = f.querySelector('#p-faculte');
            const promo = f.querySelector('#p-promo');
            const remplirPromos = () => {
              const liste2 = structure.promotions.filter((p) => p.campusId === Number(site.value) && p.faculteId === Number(faculte.value));
              promo.innerHTML = options(liste2, (p) => p.niveau + (p.filiere ? ` · ${p.filiere}` : ''));
            };
            const remplirFacs = () => {
              const facs = structure.facultes.filter((fa) => structure.promotions.some((p) => p.campusId === Number(site.value) && p.faculteId === fa.id));
              faculte.innerHTML = options(facs, (fa) => fa.nom);
              remplirPromos();
            };
            site.innerHTML = options(structure.campus, (c) => c.nom);
            // On part de la promotion actuelle.
            const actuelle = structure.promotions.find((p) => p.id === liste.promotion.id);
            if (actuelle) site.value = actuelle.campusId;
            remplirFacs();
            if (actuelle) { faculte.value = actuelle.faculteId; remplirPromos(); }
            site.addEventListener('change', remplirFacs);
            faculte.addEventListener('change', remplirPromos);
          },
          lire: (f) => {
            const promotionId = Number(f.querySelector('#p-promo').value);
            const motif = f.querySelector('#p-motif').value.trim();
            if (!promotionId) return 'Choisissez la nouvelle promotion.';
            if (promotionId === liste.promotion.id) return 'Choisissez une autre promotion que l’actuelle.';
            if (motif.length < 3) return 'Indiquez le motif.';
            return { promotionId, motif };
          },
        });
        if (!valeurs) return;
        const r = await envoyerAvecHomonyme(`${adresse}/changer-promotion`, 'POST', valeurs);
        if (!r) return;
        message = `${etudiant.nomComplet} est maintenant en ${r.promotion}.${r.codeSupprime ? ' Son ancien code est supprimé : remettez-lui un nouveau code dans sa nouvelle promotion.' : ''}`;
      }

      if (choix === 'annuler' || choix === 'retirer') {
        const motif = await demanderTexte({
          titre: choix === 'annuler' ? 'Annuler le code' : 'Retirer de la liste',
          texte: choix === 'annuler'
            ? `Le code de ${qui} ne marchera plus, tout de suite. Ses votes déjà faits restent comptés. Le distributeur pourra lui remettre un nouveau code.`
            : `${qui} sera retiré de la liste, avec son code. Ce n’est possible que s’il n’a pas encore voté.`,
          etiquette: choix === 'annuler' ? 'Motif (ex. « code remis à la mauvaise personne »)' : 'Motif (ex. « inscrit deux fois »)',
          bouton: choix === 'annuler' ? 'Annuler le code' : 'Retirer de la liste',
        });
        if (!motif) return;
        await api(`${adresse}/${choix === 'annuler' ? 'annuler-code' : 'retirer'}`, { methode: 'POST', corps: { motif } });
        message = choix === 'annuler'
          ? `Le code de ${etudiant.nomComplet} est annulé.`
          : `${etudiant.nomComplet} est retiré de la liste.`;
      }
    } catch (erreur) {
      afficherMessage(zoneMessageListe, erreur.message);
      return;
    }
    if (choix === 'nom') dernierInscrit = etudiant.id;
    await charger();
    afficherMessage(zoneMessageListe, message, 'ok');
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
