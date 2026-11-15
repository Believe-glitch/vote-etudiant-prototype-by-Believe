// Tests du vote lui-même : connexion avec le code et toutes les règles.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  demarrerTest, visiteur, officiel, etudiantDe, scrutinDe, campusId, candidatsDe, etudiantConnecte,
} from './aide.js';
import { fermerSeancesEchues } from '../src/services/scrutins.js';

const L2_LIN = { campus: 'LIN', niveau: 'L2' };
const L1_LIN = { campus: 'LIN', niveau: 'L1' };
const L2_NDJI = { campus: 'NDJI', niveau: 'L2' };

let app, sql, fermer, distributeur, superviseur;
let lin, ndji, cpL2, cpL1, presidence;

before(async () => {
  ({ app, sql, fermer } = await demarrerTest());
  distributeur = await officiel(app, 'distributeur');
  superviseur = await officiel(app, 'superviseur');
  lin = await campusId(sql, 'LIN');
  ndji = await campusId(sql, 'NDJI');
  cpL2 = await scrutinDe(sql, { ...L2_LIN, poste: 'CP' });
  cpL1 = await scrutinDe(sql, { ...L1_LIN, poste: 'CP' });
  presidence = await scrutinDe(sql, { poste: 'PRESIDENCE' });
});
after(() => fermer());

test('un code inventé est refusé, même s’il a la bonne forme', async () => {
  const v = visiteur(app);
  const r = await v.post('/api/etudiant/connexion', { code: 'L2INF-LIN-ABCDEF' });
  assert.equal(r.statut, 401);
  const r2 = await v.post('/api/etudiant/connexion', { code: "x' or 1=1 --" });
  assert.equal(r2.statut, 401);
});

test('le code fonctionne même tapé en minuscules avec des espaces', async () => {
  const id = await etudiantDe(sql, L2_LIN, 0);
  const { json } = await distributeur.post(`/api/admin/etudiants/${id}/code`);
  const v = visiteur(app);
  const r = await v.post('/api/etudiant/connexion', { code: `  ${json.code.toLowerCase()} ` });
  assert.equal(r.statut, 200);
  const moi = await v.get('/api/etudiant/moi');
  assert.equal(moi.json.prefixe, 'L2INF-LIN');
  // La partie secrète du code ne revient jamais du serveur.
  assert.ok(!JSON.stringify(moi.json).includes(json.code));
});

test('sans connexion, on ne peut pas voter', async () => {
  const r = await visiteur(app).post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: 1 });
  assert.equal(r.statut, 401);
});

test('on ne vote pas tant que le vote n’est pas ouvert', async () => {
  const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 1));
  const [candidat] = await candidatsDe(sql, cpL2);
  const r = await v.post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: candidat });
  assert.equal(r.statut, 409);
});

test('vote ouvert : un vote par poste, seulement dans sa promotion', async () => {
  const ouverture = await superviseur.post(`/api/admin/scrutins/${cpL2}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });
  assert.equal(ouverture.statut, 200);
  const [c1, c2] = await candidatsDe(sql, cpL2);
  const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 2));

  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: c1 })).statut, 200);

  // Deuxième vote pour le même poste : refusé, même pour un autre candidat.
  const encore = await v.post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: c2 });
  assert.equal(encore.statut, 409);
  assert.match(encore.json.erreur, /déjà voté/);

  // Le CP d'une autre promotion : refusé.
  await superviseur.post(`/api/admin/scrutins/${cpL1}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });
  const [autre] = await candidatsDe(sql, cpL1);
  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cpL1, candidatId: autre })).statut, 403);

  // Un candidat qui ne se présente pas à ce poste : refusé.
  const { v: v2 } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 3));
  assert.equal((await v2.post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: autre })).statut, 400);

  // La base ne contient qu'une voix (pour c1).
  const voix = await sql`select candidat_id, nombre from voix where scrutin_id = ${cpL2}`;
  assert.deepEqual(voix.map((l) => [l.candidat_id, l.nombre]), [[c1, 1]]);
});

test('deux clics au même instant : un seul vote compte', async () => {
  const [c1] = await candidatsDe(sql, cpL2);
  const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 4));
  const reponses = await Promise.all(
    Array.from({ length: 5 }, () => v.post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: c1 }))
  );
  assert.equal(reponses.filter((r) => r.statut === 200).length, 1);
  assert.equal(reponses.filter((r) => r.statut === 409).length, 4);
});

test('présidence : chaque site ne vote que pendant SA séance', async () => {
  const [c1] = await candidatsDe(sql, presidence);
  const { v: etuLin } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 5));
  const { v: etuNdji } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_NDJI, 0));

  await superviseur.post(`/api/admin/scrutins/${presidence}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });
  assert.equal((await etuLin.post('/api/etudiant/voter', { scrutinId: presidence, candidatId: c1 })).statut, 200);
  // N'djili n'a pas encore ouvert sa séance.
  assert.equal((await etuNdji.post('/api/etudiant/voter', { scrutinId: presidence, candidatId: c1 })).statut, 409);

  await superviseur.post(`/api/admin/scrutins/${presidence}/seances/${ndji}/ouvrir`, { dureeMinutes: 30 });
  assert.equal((await etuNdji.post('/api/etudiant/voter', { scrutinId: presidence, candidatId: c1 })).statut, 200);
});

test('les résultats restent cachés avant le dévoilement, même pour le superviseur', async () => {
  assert.equal((await visiteur(app).get(`/api/resultats/${cpL2}`)).statut, 403);
  assert.equal((await superviseur.get(`/api/resultats/${cpL2}`)).statut, 403);
  // Impossible de dévoiler tant que le vote est ouvert.
  assert.equal((await superviseur.post(`/api/admin/scrutins/${cpL2}/devoiler`, {})).statut, 409);
  // Et la liste « qui a voté » n'est pas visible pendant le vote.
  assert.equal((await superviseur.get(`/api/admin/scrutins/${cpL2}/votants`)).statut, 403);
});

test('à la fin du décompte, le vote se ferme tout seul et plus personne ne vote', async () => {
  // On fait comme si l'heure de fin était passée.
  await sql`update seance set fin = now() - interval '1 second' where scrutin_id = ${cpL2}`;
  assert.equal(await fermerSeancesEchues(sql), true);

  const [c1] = await candidatsDe(sql, cpL2);
  const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 6));
  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cpL2, candidatId: c1 })).statut, 409);

  const [scrutin] = await sql`select statut from scrutin where id = ${cpL2}`;
  assert.equal(scrutin.statut, 'termine');
});

test('après dévoilement : résultats publics, exacts, et liste des votants', async () => {
  assert.equal((await superviseur.post(`/api/admin/scrutins/${cpL2}/devoiler`, {})).statut, 200);
  const r = await visiteur(app).get(`/api/resultats/${cpL2}`);
  assert.equal(r.statut, 200);
  assert.equal(r.json.complet, true);
  assert.equal(r.json.participation.votants, 2);   // les étudiants n° 2 et n° 4
  const [c1] = await candidatsDe(sql, cpL2);
  assert.equal(r.json.candidats.find((c) => c.id === c1).voix, 2);
  assert.equal(r.json.places[0].candidatId, c1);

  const votants = await superviseur.get(`/api/admin/scrutins/${cpL2}/votants`);
  assert.equal(votants.statut, 200);
  assert.equal(votants.json.filter((l) => l.a_vote).length, 2);
});

test('aucune trace ne relie un vote à un code (pas d’heure, pas de bulletin)', async () => {
  const colonnes = await sql`
    select table_name, column_name from information_schema.columns
    where table_name in ('participation', 'voix')`;
  const noms = colonnes.map((c) => `${c.table_name}.${c.column_name}`).sort();
  assert.deepEqual(noms, [
    'participation.code_id', 'participation.scrutin_id',
    'voix.campus_id', 'voix.candidat_id', 'voix.nombre', 'voix.scrutin_id',
  ]);
});
