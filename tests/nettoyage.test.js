// Tests du nettoyage par le superviseur : protections (rôle, mot de passe,
// mot EFFACER, vote ouvert), et effet de chaque nettoyage.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  demarrerTest, visiteur, officiel, etudiantDe, scrutinDe, campusId, candidatsDe, etudiantConnecte, MOT_DE_PASSE,
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

const nettoyer = (qui, action, autres = {}) =>
  qui.post('/api/admin/nettoyage', { action, motDePasse: MOT_DE_PASSE, confirmation: 'EFFACER', ...autres });

// Un vote complet sur le CP de L2 Lingwala : ouverture, un vote, fermeture.
async function voterAuCp(rang) {
  const cp = await scrutinDe(sql, { ...L2_LIN, poste: 'CP' });
  const [candidat] = await candidatsDe(sql, cp);
  const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, rang));
  assert.equal((await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 5 })).statut, 200);
  assert.equal((await v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: candidat })).statut, 200);
  return { cp, candidat, v };
}

test('seul le superviseur nettoie, avec son mot de passe et le mot EFFACER', async () => {
  assert.equal((await nettoyer(distributeur, 'sessions')).statut, 403);
  assert.equal((await nettoyer(observateur, 'sessions')).statut, 403);
  assert.equal((await observateur.get('/api/admin/nettoyage')).statut, 403);
  assert.equal((await nettoyer(visiteur(app), 'sessions')).statut, 401);

  const sansMot = await nettoyer(superviseur, 'tous_les_votes', { confirmation: 'oui' });
  assert.equal(sansMot.statut, 400);
  const mauvaisMdp = await nettoyer(superviseur, 'tous_les_votes', { motDePasse: 'faux' });
  assert.equal(mauvaisMdp.statut, 403);
  app.limiteurAdmins.compteurs.clear();

  const etat = await superviseur.get('/api/admin/nettoyage');
  assert.equal(etat.statut, 200);
  assert.equal(etat.json.modeDemo, true);
  assert.equal(etat.json.voteOuvert, false);
});

test('impossible de nettoyer pendant un vote ouvert ; ensuite, les votes du scrutin sont effacés', async () => {
  const { cp, candidat } = await voterAuCp(0);

  const pendant = await nettoyer(superviseur, 'votes_scrutin', { scrutinId: cp });
  assert.equal(pendant.statut, 409);
  assert.equal((await superviseur.get('/api/admin/nettoyage')).json.voteOuvert, true);

  assert.equal((await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/fermer`)).statut, 200);
  const etat = await superviseur.get('/api/admin/nettoyage');
  assert.ok(etat.json.scrutins.some((s) => s.id === cp && s.participations === 1));

  const r = await nettoyer(superviseur, 'votes_scrutin', { scrutinId: cp });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.json.resume, { scrutins: 1, voix: 1, secondsTours: 0 });

  const [scrutin] = await sql`select statut from scrutin where id = ${cp}`;
  assert.equal(scrutin.statut, 'preparation');
  const [seance] = await sql`select statut, fin from seance where scrutin_id = ${cp}`;
  assert.equal(seance.statut, 'attente');
  assert.equal(seance.fin, null);
  assert.equal((await sql`select * from voix where scrutin_id = ${cp}`).length, 0);
  assert.equal((await sql`select * from participation where scrutin_id = ${cp}`).length, 0);
  // Les candidats sont gardés.
  assert.ok((await candidatsDe(sql, cp)).includes(candidat));

  // Le journal garde la trace du nettoyage.
  const journal = await superviseur.get('/api/admin/journal?action=nettoyage_votes_scrutin');
  assert.equal(journal.json.total, 1);
  assert.equal(journal.json.lignes[0].details.scrutinId, cp);
});

test('effacer tous les votes supprime aussi les seconds tours', async () => {
  // Égalité 1-1 sur le CP de L1 Lingwala → second tour.
  const cp = await scrutinDe(sql, { ...L1_LIN, poste: 'CP' });
  const [a, b] = await candidatsDe(sql, cp);
  const e1 = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L1_LIN, 2));
  const e2 = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L1_LIN, 3));
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 5 });
  await e1.v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: a });
  await e2.v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: b });
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/fermer`);
  assert.equal((await superviseur.post(`/api/admin/scrutins/${cp}/devoiler`)).statut, 200);
  const tour2 = await superviseur.post(`/api/admin/scrutins/${cp}/second-tour`);
  assert.equal(tour2.statut, 200);

  const r = await nettoyer(superviseur, 'tous_les_votes');
  assert.equal(r.statut, 200);
  assert.equal(r.json.resume.secondsTours, 1);
  assert.equal(r.json.resume.voix, 2);

  const [{ secondsTours }] = await sql`select count(*)::int as "secondsTours" from scrutin where parent_id is not null`;
  assert.equal(secondsTours, 0);
  const [{ pasPrets }] = await sql`select count(*)::int as "pasPrets" from scrutin where statut <> 'preparation'`;
  assert.equal(pasPrets, 0);
  const [{ voix }] = await sql`select count(*)::int as voix from voix`;
  assert.equal(voix, 0);
});

test('annuler les codes : l’ancien code ne marche plus, et un votant ne peut pas revoter avec le nouveau', async () => {
  const { cp, candidat, v } = await voterAuCp(5);
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/fermer`);
  const etudiant = await etudiantDe(sql, L2_LIN, 5);
  const [promo] = await sql`select promotion_id as id from etudiant where id = ${etudiant}`;

  const r = await nettoyer(superviseur, 'codes', { promotionId: promo.id });
  assert.equal(r.statut, 200);
  assert.ok(r.json.resume.codes >= 2);   // les étudiants de L2 qui ont reçu un code

  // L'étudiant connecté est déconnecté.
  assert.equal((await v.get('/api/etudiant/moi')).statut, 401);
  // Les autres promotions gardent leurs codes.
  const [{ autres }] = await sql`
    select count(*)::int as autres from code_vote co join etudiant e on e.id = co.etudiant_id
    where co.statut = 'actif' and e.promotion_id <> ${promo.id}`;
  assert.ok(autres > 0);

  // Un code annulé par nettoyage ne compte pas comme un « remplacement ».
  const liste = await superviseur.get(`/api/admin/promotions/${promo.id}/etudiants`);
  const fiche = liste.json.etudiants.find((x) => x.id === etudiant);
  assert.equal(fiche.codeRemisLe, null);
  assert.equal(fiche.remplacements, 0);

  // Nouveau code : il hérite du vote déjà fait.
  const nouveau = await etudiantConnecte(app, distributeur, etudiant);
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 5 });
  const revote = await nouveau.v.post('/api/etudiant/voter', { scrutinId: cp, candidatId: candidat });
  assert.equal(revote.statut, 409);
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/fermer`);
});

test('déconnecter tout le monde, sauf le superviseur', async () => {
  const autreSuperviseur = await officiel(app, 'superviseur');
  const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 7));

  const r = await nettoyer(superviseur, 'sessions');
  assert.equal(r.statut, 200);
  assert.ok(r.json.resume.sessions >= 4);

  assert.equal((await superviseur.get('/api/admin/moi')).statut, 200);
  assert.equal((await autreSuperviseur.get('/api/admin/moi')).statut, 401);
  assert.equal((await distributeur.get('/api/admin/moi')).statut, 401);
  assert.equal((await observateur.get('/api/admin/moi')).statut, 401);
  assert.equal((await v.get('/api/etudiant/moi')).statut, 401);

  distributeur = await officiel(app, 'distributeur');
  observateur = await officiel(app, 'observateur');
});

test('tout remettre comme au départ', async () => {
  // Quelques essais : un étudiant inscrit, un candidat ajouté, un vote.
  const promo = (await sql`select promotion_id as id from etudiant where id = ${await etudiantDe(sql, L2_LIN, 0)}`)[0].id;
  const inscrit = await distributeur.post(`/api/admin/promotions/${promo}/inscrire`, { nom: 'Essai', prenom: 'Temporaire' });
  assert.equal(inscrit.statut, 200);
  const secretaire = await scrutinDe(sql, { ...L2_LIN, poste: 'SECRETAIRE' });
  assert.equal((await superviseur.post(`/api/admin/scrutins/${secretaire}/candidats`, { nom: 'Candidat d’essai' })).statut, 200);
  assert.equal((await nettoyer(superviseur, 'tous_les_votes')).statut, 200);   // le CP peut rouvrir
  await voterAuCp(9);
  await superviseur.post(`/api/admin/scrutins/${await scrutinDe(sql, { ...L2_LIN, poste: 'CP' })}/seances/${lin}/fermer`);

  const [{ avant }] = await sql`select count(*)::int as avant from journal`;
  const r = await nettoyer(superviseur, 'tout');
  assert.equal(r.statut, 200);
  assert.equal(r.json.resume.etudiants, 93);          // les étudiants de la démonstration
  assert.ok(r.json.resume.codes > 0);                  // leurs codes de démonstration

  const [{ essais }] = await sql`select count(*)::int as essais from etudiant where nom ilike 'essai'`;
  assert.equal(essais, 0);
  const [{ candidatsEssai }] = await sql`select count(*)::int as "candidatsEssai" from candidat where nom = 'Candidat d’essai'`;
  assert.equal(candidatsEssai, 0);
  const [{ sansPhoto }] = await sql`select count(*)::int as "sansPhoto" from candidat where photo_id is null`;
  assert.equal(sansPhoto, 0);                          // les portraits dessinés sont remis
  const [{ votes }] = await sql`select count(*)::int as votes from participation`;
  assert.equal(votes, 0);

  // Le journal n'a rien perdu : il a seulement une ligne de plus.
  const [{ apres }] = await sql`select count(*)::int as apres from journal`;
  assert.equal(apres, avant + 1);
  // Le superviseur est toujours connecté.
  assert.equal((await superviseur.get('/api/admin/moi')).statut, 200);
});

test('« Tout remettre comme au départ » est refusé hors démonstration', async () => {
  const ancien = app.config.donneesDemo;
  app.config.donneesDemo = false;
  try {
    const r = await nettoyer(superviseur, 'tout');
    assert.equal(r.statut, 403);
    assert.equal((await superviseur.get('/api/admin/nettoyage')).json.modeDemo, false);
  } finally {
    app.config.donneesDemo = ancien;
  }
});
