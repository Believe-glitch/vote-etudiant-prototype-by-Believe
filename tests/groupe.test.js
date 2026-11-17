// Tests de l'ouverture groupée (une promotion) et du suivi « a voté »
// dans la liste des inscrits.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerTest, officiel, etudiantDe, scrutinDe, candidatsDe, etudiantConnecte } from './aide.js';

const L2_LIN = { campus: 'LIN', niveau: 'L2' };

let app, sql, fermer, superviseur, distributeur, observateur, promo;

before(async () => {
  ({ app, sql, fermer } = await demarrerTest());
  superviseur = await officiel(app, 'superviseur');
  distributeur = await officiel(app, 'distributeur');
  observateur = await officiel(app, 'observateur');
  const [e] = await sql`select promotion_id from etudiant where id = ${await etudiantDe(sql, L2_LIN, 0)}`;
  promo = e.promotion_id;
});
after(() => fermer());

test('seul le superviseur ouvre en groupe, avec des postes et une durée valables', async () => {
  const corps = { postes: ['CP', 'CPA', 'SECRETAIRE'], dureeMinutes: 10 };
  assert.equal((await distributeur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, corps)).statut, 403);
  assert.equal((await observateur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, corps)).statut, 403);
  assert.equal((await superviseur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, { postes: ['PRESIDENCE'], dureeMinutes: 10 })).statut, 400);
  assert.equal((await superviseur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, { postes: ['CP'], dureeMinutes: 0 })).statut, 400);
  assert.equal((await superviseur.post('/api/admin/promotions/99999/ouvrir-votes', corps)).statut, 404);
});

test('ouvrir les 3 votes d’une promotion en une fois, puis les fermer en une fois', async () => {
  // Un poste avec un seul candidat est laissé de côté, sans bloquer les autres.
  const sec = await scrutinDe(sql, { ...L2_LIN, poste: 'SECRETAIRE' });
  const [garder, ...autres] = await candidatsDe(sql, sec);
  if (autres.length) await sql`delete from candidat where id in ${sql(autres)}`;

  const r = await superviseur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, { postes: ['CP', 'CPA', 'SECRETAIRE'], dureeMinutes: 15 });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.json.ouverts.map((o) => o.poste), ['CP', 'CPA']);
  assert.equal(r.json.ignores.length, 1);
  assert.equal(r.json.ignores[0].poste, 'SECRETAIRE');
  assert.match(r.json.ignores[0].raison, /un seul candidat/i);
  assert.ok(garder);

  const ouvertes = await sql`
    select s.poste, se.fin - se.debut as duree from seance se join scrutin s on s.id = se.scrutin_id
    where s.promotion_id = ${promo} and se.statut = 'ouverte' order by s.poste`;
  assert.deepEqual(ouvertes.map((o) => o.poste), ['CP', 'CPA']);

  // Une deuxième fois : tout est déjà ouvert, rien ne casse.
  const encore = await superviseur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, { postes: ['CP'], dureeMinutes: 15 });
  assert.equal(encore.json.ouverts.length, 0);
  assert.match(encore.json.ignores[0].raison, /déjà ouvert/);

  const f = await superviseur.post(`/api/admin/promotions/${promo}/fermer-votes`);
  assert.equal(f.statut, 200);
  assert.equal(f.json.fermes.length, 2);
  const [{ restantes }] = await sql`
    select count(*)::int as restantes from seance se join scrutin s on s.id = se.scrutin_id
    where s.promotion_id = ${promo} and se.statut = 'ouverte'`;
  assert.equal(restantes, 0);
});

test('la liste montre SI un étudiant a voté (jamais pour qui)', async () => {
  const etudiant = await etudiantDe(sql, L2_LIN, 4);
  const cpa = await scrutinDe(sql, { ...L2_LIN, poste: 'CPA' });
  // Le CPA de la promotion a été fermé au test précédent : on le remet en
  // préparation pour cet essai.
  await sql`update seance set statut = 'attente', debut = null, fin = null where scrutin_id = ${cpa}`;
  await sql`update scrutin set statut = 'preparation' where id = ${cpa}`;
  const [candidat] = await candidatsDe(sql, cpa);
  const { v } = await etudiantConnecte(app, distributeur, etudiant);
  await superviseur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, { postes: ['CPA'], dureeMinutes: 5 });
  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cpa, candidatId: candidat })).statut, 200);

  const liste = await distributeur.get(`/api/admin/promotions/${promo}/etudiants`);
  const fiche = liste.json.etudiants.find((x) => x.id === etudiant);
  assert.deepEqual(fiche.postesVotes, ['CPA']);
  assert.ok(liste.json.votants >= 1);
  // Rien sur le choix : aucun champ ne parle de candidat.
  assert.equal(Object.keys(fiche).some((cle) => /candidat|voix/i.test(cle)), false);
  await superviseur.post(`/api/admin/promotions/${promo}/fermer-votes`);
});
