// Tests des corrections de la liste des inscrits (distributeur et superviseur) :
// corriger un nom, annuler un code, retirer un étudiant, changer de promotion.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  demarrerTest, officiel, etudiantDe, scrutinDe, campusId, candidatsDe, etudiantConnecte,
} from './aide.js';

const L2_LIN = { campus: 'LIN', niveau: 'L2' };
const L1_LIN = { campus: 'LIN', niveau: 'L1' };

let app, sql, fermer, distributeur, superviseur, observateur, lin;

before(async () => {
  ({ app, sql, fermer } = await demarrerTest());
  distributeur = await officiel(app, 'distributeur');
  superviseur = await officiel(app, 'superviseur');
  observateur = await officiel(app, 'observateur');
  lin = await campusId(sql, 'LIN');
});
after(() => fermer());

async function promotionDe(etudiantId) {
  const [e] = await sql`select promotion_id from etudiant where id = ${etudiantId}`;
  return e.promotion_id;
}

test('l’observateur ne corrige rien ; distributeur et superviseur, si', async () => {
  const etudiant = await etudiantDe(sql, L2_LIN, 0);
  const corps = { nom: 'Kalonji', prenom: 'Grâce' };
  assert.equal((await observateur.put(`/api/admin/etudiants/${etudiant}`, corps)).statut, 403);
  assert.equal((await observateur.post(`/api/admin/etudiants/${etudiant}/retirer`, { motif: 'essai' })).statut, 403);
  assert.equal((await observateur.post(`/api/admin/etudiants/${etudiant}/annuler-code`, { motif: 'essai' })).statut, 403);
  // Le superviseur corrige, mais ne crée toujours pas de code.
  assert.equal((await superviseur.post(`/api/admin/etudiants/${etudiant}/code`)).statut, 403);
});

test('corriger un nom (superviseur), avec contrôle des homonymes et des matricules', async () => {
  const etudiant = await etudiantDe(sql, L2_LIN, 1);
  const autre = await etudiantDe(sql, L2_LIN, 2);
  const [a] = await sql`select nom, prenom, matricule from etudiant where id = ${autre}`;

  // Le nom d'un autre étudiant de la promotion : le site prévient.
  const homonyme = await superviseur.put(`/api/admin/etudiants/${etudiant}`, { nom: a.nom, prenom: a.prenom });
  assert.equal(homonyme.statut, 409);
  assert.equal(homonyme.json.homonyme, true);
  // Le matricule d'un autre : refusé.
  const pris = await superviseur.put(`/api/admin/etudiants/${etudiant}`, { nom: 'Mabiala', prenom: 'Dorcas', matricule: a.matricule });
  assert.equal(pris.statut, 409);

  const r = await superviseur.put(`/api/admin/etudiants/${etudiant}`, { nom: '  Mabiala ', postnom: 'Nsiala', prenom: 'Dorcas', matricule: '' });
  assert.equal(r.statut, 200);
  assert.equal(r.json.nomComplet, 'Mabiala Nsiala Dorcas');
  const [apres] = await sql`select nom, postnom, prenom, matricule from etudiant where id = ${etudiant}`;
  assert.deepEqual({ ...apres }, { nom: 'Mabiala', postnom: 'Nsiala', prenom: 'Dorcas', matricule: null });

  const journal = await superviseur.get('/api/admin/journal?action=etudiant_corrige');
  assert.equal(journal.json.total, 1);
  assert.equal(journal.json.lignes[0].details.nom, 'Mabiala Nsiala Dorcas');
});

test('annuler un code (distributeur) : il ne marche plus, les votes restent comptés', async () => {
  const etudiant = await etudiantDe(sql, L2_LIN, 3);
  const cp = await scrutinDe(sql, { ...L2_LIN, poste: 'CP' });
  const [candidat] = await candidatsDe(sql, cp);
  const { v } = await etudiantConnecte(app, distributeur, etudiant);
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 5 });
  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: candidat })).statut, 200);

  assert.equal((await distributeur.post(`/api/admin/etudiants/${etudiant}/annuler-code`, { motif: '' })).statut, 400);
  const r = await distributeur.post(`/api/admin/etudiants/${etudiant}/annuler-code`, { motif: 'Code donné à la mauvaise personne' });
  assert.equal(r.statut, 200);
  assert.equal((await v.get('/api/etudiant/moi')).statut, 401);
  // Plus rien à annuler.
  assert.equal((await distributeur.post(`/api/admin/etudiants/${etudiant}/annuler-code`, { motif: 'encore' })).statut, 409);

  // Nouveau code : le vote déjà fait le suit, pas de second vote.
  const nouveau = await etudiantConnecte(app, distributeur, etudiant);
  assert.equal((await nouveau.v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: candidat })).statut, 409);

  // Il a voté : on ne peut ni le retirer ni le changer de promotion.
  assert.equal((await distributeur.post(`/api/admin/etudiants/${etudiant}/retirer`, { motif: 'erreur' })).statut, 409);
  const autrePromo = await promotionDe(await etudiantDe(sql, L1_LIN, 0));
  assert.equal((await superviseur.post(`/api/admin/etudiants/${etudiant}/changer-promotion`, { promotionId: autrePromo, motif: 'erreur' })).statut, 409);
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/fermer`);
});

test('retirer un étudiant inscrit par erreur (distributeur)', async () => {
  const promo = await promotionDe(await etudiantDe(sql, L2_LIN, 0));
  const inscrit = await distributeur.post(`/api/admin/promotions/${promo}/inscrire`, { nom: 'Doublon', prenom: 'Essai' });
  assert.equal(inscrit.statut, 200);
  const id = inscrit.json.etudiantId;

  const r = await distributeur.post(`/api/admin/etudiants/${id}/retirer`, { motif: 'Inscrit deux fois' });
  assert.equal(r.statut, 200);
  assert.equal((await sql`select 1 from etudiant where id = ${id}`).length, 0);
  assert.equal((await sql`select 1 from code_vote where etudiant_id = ${id}`).length, 0);
  // Son code ne marche plus.
  const essai = await (await import('./aide.js')).visiteur(app).post('/api/etudiant/connexion', { code: inscrit.json.code });
  assert.equal(essai.statut, 401);

  const journal = await superviseur.get('/api/admin/journal?action=etudiant_retire');
  assert.equal(journal.json.lignes[0].details.motif, 'Inscrit deux fois');
});

test('changer de promotion (superviseur) : l’ancien code est supprimé, un nouveau code suit la nouvelle promotion', async () => {
  const promoL2 = await promotionDe(await etudiantDe(sql, L2_LIN, 0));
  const promoL1 = await promotionDe(await etudiantDe(sql, L1_LIN, 0));
  const inscrit = await distributeur.post(`/api/admin/promotions/${promoL2}/inscrire`, { nom: 'Mauvaise', prenom: 'Promo' });
  const id = inscrit.json.etudiantId;

  assert.equal((await superviseur.post(`/api/admin/etudiants/${id}/changer-promotion`, { promotionId: promoL2, motif: 'erreur' })).statut, 400);
  const r = await superviseur.post(`/api/admin/etudiants/${id}/changer-promotion`, { promotionId: promoL1, motif: 'Inscrit en L2 au lieu de L1' });
  assert.equal(r.statut, 200);
  assert.equal(r.json.codeSupprime, true);
  assert.match(r.json.promotion, /^L1/);
  assert.equal(await promotionDe(id), promoL1);
  assert.equal((await sql`select 1 from code_vote where etudiant_id = ${id}`).length, 0);

  // Le distributeur lui remet un code de sa nouvelle promotion.
  const code = await distributeur.post(`/api/admin/etudiants/${id}/code`);
  assert.equal(code.statut, 200);
  assert.match(code.json.code, /^L1INF-LIN-/);
});
