// Onglet « Nettoyage » (superviseur seulement) : remettre le site en ordre
// après des essais. Chaque nettoyage demande le mot de passe et le mot
// EFFACER ; le serveur revérifie tout, et note chaque nettoyage au journal.

import { api, e, afficherMessage } from '../commun.js';
import { confirmerNettoyage } from './dialogue.js';

// Les nettoyages proposés, dans l'ordre de l'écran.
const NETTOYAGES = [
  {
    action: 'votes_scrutin',
    titre: 'Effacer les votes d’un scrutin',
    texte: 'Le scrutin choisi revient « en préparation », comme avant son ouverture. Ses candidats sont gardés.',
    choix: 'scrutin',
  },
  {
    action: 'tous_les_votes',
    titre: 'Effacer tous les votes',
    texte: 'Tous les scrutins reviennent « en préparation ». Les seconds tours créés pendant les essais sont supprimés.',
  },
  {
    action: 'codes',
    titre: 'Annuler les codes remis',
    texte: 'Les étudiants restent dans les listes, mais leurs codes ne marchent plus : le distributeur devra leur en remettre un nouveau.',
    choix: 'promotion',
  },
  {
    action: 'sessions',
    titre: 'Déconnecter tout le monde',
    texte: 'Ferme toutes les sessions ouvertes, étudiants et officiels. Vous, vous restez connecté.',
  },
  {
    action: 'tout',
    titre: 'Tout remettre comme au départ',
    texte: 'Votes, codes, listes d’inscrits et candidats reviennent à l’état de la démonstration. À faire juste avant une présentation.',
    demo: true,
  },
];

function resumeLisible(action, r) {
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  if (action === 'votes_scrutin' || action === 'tous_les_votes') {
    let texte = `${pluriel(r.scrutins, 'scrutin')} remis à zéro, ${r.voix} voix effacée${r.voix > 1 ? 's' : ''}`;
    if (r.secondsTours) texte += `, ${pluriel(r.secondsTours, 'second tour')} supprimé${r.secondsTours > 1 ? 's' : ''}`;
    return `${texte}.`;
  }
  if (action === 'codes') return `${pluriel(r.codes, 'code')} annulé${r.codes > 1 ? 's' : ''}.`;
  if (action === 'sessions') return `${pluriel(r.sessions, 'session')} fermée${r.sessions > 1 ? 's' : ''}.`;
  return `Tout est remis comme au départ : ${r.etudiants} étudiants, ${r.candidats} candidats, ${r.codes} codes de démonstration.`;
}

export async function afficherNettoyage(conteneur) {
  const etat = await api('/api/admin/nettoyage');
  const nettoyages = NETTOYAGES.filter((n) => !n.demo || etat.modeDemo);
  const bloque = etat.voteOuvert;

  const optionsScrutins = etat.scrutins.length
    ? etat.scrutins.map((s) => `<option value="${s.id}">${e(s.libelle)} (${s.participations} votant${s.participations > 1 ? 's' : ''})</option>`).join('')
    : '<option value="">Aucun scrutin à remettre à zéro</option>';
  const optionsPromotions = `<option value="">Toutes les promotions</option>${etat.promotions
    .map((p) => `<option value="${p.id}">${e(p.libelle)} (${p.codesActifs} code${p.codesActifs > 1 ? 's' : ''})</option>`).join('')}`;

  conteneur.innerHTML = `<div id="page-nettoyage">
    <section class="carte carte-simple">
      <h2>Nettoyage</h2>
      <p class="texte-doux">Pour repartir de zéro après des essais. Chaque nettoyage demande votre mot de passe et le mot <strong>EFFACER</strong>.
        Le journal n’est jamais effacé : chaque nettoyage y est noté, avec votre nom et l’heure.</p>
      ${bloque ? `<div class="message message-erreur" role="alert">
        Un vote est ouvert en ce moment : le nettoyage est impossible jusqu’à sa fermeture (onglet <em>Candidats et séances</em>).
        <br><strong>${etat.votesOuverts.map(e).join(' ; ')}</strong></div>` : ''}
      <div id="message-nettoyage"></div>
    </section>
    <div class="liste-nettoyages">
      ${nettoyages.map((n) => `
        <section class="carte nettoyage${n.demo ? ' nettoyage-fort' : ''}" data-action="${n.action}">
          <h3>${e(n.titre)}</h3>
          <p class="texte-doux petit">${e(n.texte)}</p>
          ${n.choix === 'scrutin' ? `<div class="champ"><label for="choix-${n.action}">Scrutin</label><select id="choix-${n.action}">${optionsScrutins}</select></div>` : ''}
          ${n.choix === 'promotion' ? `<div class="champ"><label for="choix-${n.action}">Promotion</label><select id="choix-${n.action}">${optionsPromotions}</select></div>` : ''}
          ${n.action === 'sessions' ? `<p class="petit">${etat.sessionsOuvertes} session${etat.sessionsOuvertes > 1 ? 's' : ''} ouverte${etat.sessionsOuvertes > 1 ? 's' : ''}, la vôtre comprise.</p>` : ''}
          <button class="bouton bouton-danger" type="button" data-nettoyer="${n.action}"
            ${bloque || (n.choix === 'scrutin' && !etat.scrutins.length) ? 'disabled' : ''}>${e(n.titre)}</button>
        </section>`).join('')}
    </div></div>`;

  const zoneMessage = conteneur.querySelector('#message-nettoyage');

  // L'écoute est posée sur la page elle-même : elle disparaît avec elle
  // quand on réaffiche l'onglet (pas de double clic fantôme).
  conteneur.querySelector('#page-nettoyage').addEventListener('click', async (evenement) => {
    const bouton = evenement.target.closest('[data-nettoyer]');
    if (!bouton) return;
    const n = NETTOYAGES.find((x) => x.action === bouton.dataset.nettoyer);
    const corps = { action: n.action };

    // Ce qui sera nettoyé, en clair, dans la fenêtre de confirmation.
    let precision = '';
    const liste = conteneur.querySelector(`#choix-${n.action}`);
    if (n.choix === 'scrutin') {
      corps.scrutinId = Number(liste.value);
      precision = ` Scrutin : <strong>${e(liste.selectedOptions[0].textContent)}</strong>.`;
    }
    if (n.choix === 'promotion') {
      if (liste.value) corps.promotionId = Number(liste.value);
      precision = ` Promotion : <strong>${e(liste.selectedOptions[0].textContent)}</strong>.`;
    }

    const reponse = await confirmerNettoyage({ titre: n.titre, texte: `${e(n.texte)}${precision}` });
    if (!reponse) return;

    bouton.disabled = true;
    try {
      const { resume } = await api('/api/admin/nettoyage', { methode: 'POST', corps: { ...corps, ...reponse } });
      await afficherNettoyage(conteneur);   // on réaffiche avec l'état à jour
      afficherMessage(conteneur.querySelector('#message-nettoyage'), resumeLisible(n.action, resume), 'ok');
    } catch (erreur) {
      bouton.disabled = false;
      afficherMessage(zoneMessage, erreur.message);
    }
  });
}
