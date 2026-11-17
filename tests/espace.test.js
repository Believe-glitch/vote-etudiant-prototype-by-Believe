// L'espace de l'étudiant : la session dit quelle est sa promotion et
// combien de votes l'attendent (ouverts sur son site, pas encore votés).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerTest, officiel, visiteur, etudiantDe, scrutinDe, candidatsDe, etudiantConnecte, campusId } from './aide.js';

const L2_LIN = { campus: 'LIN', niveau: 'L2' };
let app, sql, fermer, superviseur, distributeur, lin;

before(async () => {
  ({ app, sql, fermer } = await demarrerTest());
  superviseur = await officiel(app, 'superviseur');
  distributeur = await officiel(app, 'distributeur');
  lin = await campusId(sql, 'LIN');
});
after(() => fermer());

test('un visiteur sans code n’est pas connecté', async () => {
  const r = await visiteur(app).get('/api/etudiant/session');
  assert.deepEqual(r.json, { connecte: false });
});

test('la session donne la promotion et le nombre de votes qui attendent l’étudiant', async () => {
  const etudiant = await etudiantDe(sql, L2_LIN, 0);
  const [{ promotion_id: promo }] = await sql`select promotion_id from etudiant where id = ${etudiant}`;
  const { v } = await etudiantConnecte(app, distributeur, etudiant);

  let s = (await v.get('/api/etudiant/session')).json;
  assert.equal(s.connecte, true);
  assert.equal(s.promotionId, promo);
  assert.equal(s.campusId, lin);
  assert.match(s.promotion, /^L2/);
  assert.equal(s.votesAFaire, 0);

  // Le CP et le CPA s'ouvrent : 2 votes l'attendent ; après un vote, 1.
  await superviseur.post(`/api/admin/promotions/${promo}/ouvrir-votes`, { postes: ['CP', 'CPA'], dureeMinutes: 5 });
  s = (await v.get('/api/etudiant/session')).json;
  assert.equal(s.votesAFaire, 2);
  const cp = await scrutinDe(sql, { ...L2_LIN, poste: 'CP' });
  const [candidat] = await candidatsDe(sql, cp);
  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: candidat })).statut, 200);
  s = (await v.get('/api/etudiant/session')).json;
  assert.equal(s.votesAFaire, 1);
  await superviseur.post(`/api/admin/promotions/${promo}/fermer-votes`);
  s = (await v.get('/api/etudiant/session')).json;
  assert.equal(s.votesAFaire, 0);
});
