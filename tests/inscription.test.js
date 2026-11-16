// Tests de l'inscription d'un étudiant au moment où il vient chercher son code.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerTest, visiteur, officiel } from './aide.js';

let app, sql, fermer, distributeur, superviseur, observateur, promotionId;

before(async () => {
  ({ app, sql, fermer } = await demarrerTest());
  distributeur = await officiel(app, 'distributeur');
  superviseur = await officiel(app, 'superviseur');
  observateur = await officiel(app, 'observateur');
  const [promo] = await sql`
    select pr.id from promotion pr join campus c on c.id = pr.campus_id
    where c.sigle = 'NDJI' and pr.niveau = 'L2'`;
  promotionId = promo.id;
});
after(() => fermer());

const adresse = () => `/api/admin/promotions/${promotionId}/inscrire`;

test('un étudiant sans matricule est inscrit et reçoit un code qui marche', async () => {
  const r = await distributeur.post(adresse(), { nom: 'Matondo', postnom: 'Lusala', prenom: 'Jonas' });
  assert.equal(r.statut, 200);
  assert.match(r.json.code, /^L2INF-NDJI-[A-Z2-9]{6}$/);
  assert.equal(r.json.nomComplet, 'Matondo Lusala Jonas');

  const etudiant = visiteur(app);
  assert.equal((await etudiant.post('/api/etudiant/connexion', { code: r.json.code })).statut, 200);
  const moi = await etudiant.get('/api/etudiant/moi');
  assert.equal(moi.json.prefixe, 'L2INF-NDJI');
});

test('la liste de la promotion montre l’étudiant, jamais son code', async () => {
  const r = await distributeur.post(adresse(), { nom: 'Nzuzi', prenom: 'Ange' });
  const liste = await distributeur.get(`/api/admin/promotions/${promotionId}/etudiants`);
  assert.equal(liste.statut, 200);
  const ligne = liste.json.etudiants.find((e) => e.nomComplet === 'Nzuzi Ange');
  assert.ok(ligne.codeRemisLe);
  assert.equal(ligne.inscritPar, 'Distributeur (démonstration)');
  assert.ok(!JSON.stringify(liste.json).includes(r.json.code));
  // Les numéros suivent l'ordre alphabétique.
  assert.deepEqual(liste.json.etudiants.map((e) => e.numero), liste.json.etudiants.map((_, i) => i + 1));
});

test('même nom dans la promotion : le site prévient, puis accepte si on confirme', async () => {
  const doublon = await distributeur.post(adresse(), { nom: 'MATONDO', postnom: 'lusala', prenom: 'Jonas' });
  assert.equal(doublon.statut, 409);
  assert.equal(doublon.json.homonyme, true);

  const confirme = await distributeur.post(adresse(), {
    nom: 'Matondo', postnom: 'Lusala', prenom: 'Jonas', confirmerHomonyme: true,
  });
  assert.equal(confirme.statut, 200);
});

test('nom obligatoire, et postnom ou prénom pour distinguer les étudiants', async () => {
  assert.equal((await distributeur.post(adresse(), { nom: '' })).statut, 400);
  assert.equal((await distributeur.post(adresse(), { nom: 'Kiese' })).statut, 400);
});

test('un matricule ne peut servir qu’à un seul étudiant', async () => {
  assert.equal((await distributeur.post(adresse(), { nom: 'Bena', prenom: 'Luc', matricule: 'MAT-77' })).statut, 200);
  assert.equal((await distributeur.post(adresse(), { nom: 'Diba', prenom: 'Eve', matricule: 'MAT-77' })).statut, 409);
});

test('seul le distributeur inscrit ; superviseur et observateur consultent la liste', async () => {
  assert.equal((await superviseur.post(adresse(), { nom: 'Intrus', prenom: 'Un' })).statut, 403);
  assert.equal((await observateur.post(adresse(), { nom: 'Intrus', prenom: 'Deux' })).statut, 403);
  assert.equal((await observateur.get(`/api/admin/promotions/${promotionId}/etudiants`)).statut, 200);
  assert.equal((await visiteur(app).get(`/api/admin/promotions/${promotionId}/etudiants`)).statut, 401);
});

test('l’inscription est notée au journal, sans le code', async () => {
  const journal = { json: (await observateur.get('/api/admin/journal')).json.lignes };
  const lignes = journal.json.filter((l) => l.action === 'etudiant_inscrit_code_remis');
  assert.ok(lignes.length >= 3);
  assert.ok(!/[A-Z][0-9][A-Z]{3}-[A-Z]{2,5}-[A-Z2-9]{6}/.test(JSON.stringify(journal.json)));
});
