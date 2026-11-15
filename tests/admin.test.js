// Tests de l'espace officiels : rôles, codes, candidats, dévoilement,
// second tour, journal.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  demarrerTest, visiteur, officiel, etudiantDe, scrutinDe, campusId, candidatsDe, etudiantConnecte, MOT_DE_PASSE,
} from './aide.js';

const L2_LIN = { campus: 'LIN', niveau: 'L2' };
const L1_LIN = { campus: 'LIN', niveau: 'L1' };
const L2_NDJI = { campus: 'NDJI', niveau: 'L2' };

let app, sql, fermer, distributeur, superviseur, observateur, lin, ndji;

before(async () => {
  ({ app, sql, fermer } = await demarrerTest());
  distributeur = await officiel(app, 'distributeur');
  superviseur = await officiel(app, 'superviseur');
  observateur = await officiel(app, 'observateur');
  lin = await campusId(sql, 'LIN');
  ndji = await campusId(sql, 'NDJI');
});
after(() => fermer());

test('chaque rôle ne fait que ce qui lui est permis', async () => {
  const etudiant = await etudiantDe(sql, L1_LIN, 0);
  const cp = await scrutinDe(sql, { ...L1_LIN, poste: 'CP' });

  // Personne de connecté : refusé.
  assert.equal((await visiteur(app).get('/api/admin/etudiants?recherche=ka')).statut, 401);
  // Le superviseur et l'observateur ne créent pas de codes.
  assert.equal((await superviseur.post(`/api/admin/etudiants/${etudiant}/code`)).statut, 403);
  assert.equal((await observateur.post(`/api/admin/etudiants/${etudiant}/code`)).statut, 403);
  // Le distributeur et l'observateur n'ouvrent pas de vote et ne touchent pas aux candidats.
  assert.equal((await distributeur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 5 })).statut, 403);
  assert.equal((await observateur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 5 })).statut, 403);
  assert.equal((await observateur.post(`/api/admin/scrutins/${cp}/candidats`, { nom: 'Intrus' })).statut, 403);
  // Le distributeur ne lit pas le journal ; l'observateur, si.
  assert.equal((await distributeur.get('/api/admin/journal')).statut, 403);
  assert.equal((await observateur.get('/api/admin/journal')).statut, 200);
});

test('mauvais mot de passe refusé, et blocage après 10 essais ratés', async () => {
  const v = visiteur(app);
  for (let i = 0; i < 10; i++) {
    const r = await v.post('/api/admin/connexion', { identifiant: 'superviseur', motDePasse: 'faux' });
    assert.equal(r.statut, 401);
  }
  const bloque = await v.post('/api/admin/connexion', { identifiant: 'superviseur', motDePasse: MOT_DE_PASSE });
  assert.equal(bloque.statut, 429);
  // On remet le compteur à zéro pour les tests suivants.
  app.limiteurAdmins.compteurs.clear();
});

test('un seul code par étudiant, montré une seule fois', async () => {
  const etudiant = await etudiantDe(sql, L1_LIN, 1);
  const premier = await distributeur.post(`/api/admin/etudiants/${etudiant}/code`);
  assert.equal(premier.statut, 200);
  assert.match(premier.json.code, /^L1INF-LIN-[A-Z2-9]{6}$/);

  assert.equal((await distributeur.post(`/api/admin/etudiants/${etudiant}/code`)).statut, 409);

  // La recherche indique "remis", sans jamais redonner le code.
  const recherche = await distributeur.get('/api/admin/etudiants?promotion=1');
  assert.ok(!JSON.stringify(recherche.json).includes(premier.json.code));
  // Et la base ne contient que l'empreinte.
  const [{ n }] = await sql`select count(*)::int as n from code_vote where empreinte = ${premier.json.code}`;
  assert.equal(n, 0);
});

test('code perdu : l’ancien est annulé, le nouveau garde les votes déjà faits', async () => {
  const cp = await scrutinDe(sql, { ...L1_LIN, poste: 'CP' });
  const [c1] = await candidatsDe(sql, cp);
  await superviseur.post(`/api/admin/scrutins/${cp}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });

  const etudiant = await etudiantDe(sql, L1_LIN, 2);
  const { v: ancienneSession, code: ancien } = await etudiantConnecte(app, distributeur, etudiant);
  assert.equal((await ancienneSession.post('/api/etudiant/voter', { scrutinId: cp, candidatId: c1 })).statut, 200);

  const remplacement = await distributeur.post(`/api/admin/etudiants/${etudiant}/remplacer-code`, { motif: 'code perdu' });
  assert.equal(remplacement.statut, 200);
  assert.notEqual(remplacement.json.code, ancien);

  // L'ancien code ne marche plus, et sa session ouverte est coupée.
  assert.equal((await visiteur(app).post('/api/etudiant/connexion', { code: ancien })).statut, 401);
  assert.equal((await ancienneSession.get('/api/etudiant/moi')).statut, 401);

  // Le nouveau marche, mais ne peut pas revoter pour le CP.
  const nouvelle = visiteur(app);
  assert.equal((await nouvelle.post('/api/etudiant/connexion', { code: remplacement.json.code })).statut, 200);
  const moi = await nouvelle.get('/api/etudiant/moi');
  assert.equal(moi.json.scrutins.find((s) => s.id === cp).aVote, true);
  assert.equal((await nouvelle.post('/api/etudiant/voter', { scrutinId: cp, candidatId: c1 })).statut, 409);

  // La participation compte toujours UN étudiant, pas deux codes.
  const scrutins = await visiteur(app).get('/api/scrutins?promotion=1');
  assert.equal(scrutins.json.find((s) => s.id === cp).seances[0].votants, 1);
});

test('candidats : modifiables avant le vote seulement', async () => {
  const cpa = await scrutinDe(sql, { ...L2_LIN, poste: 'CPA' });
  const ajout = await superviseur.post(`/api/admin/scrutins/${cpa}/candidats`, { nom: 'Nouveau Candidat', slogan: 'Test' });
  assert.equal(ajout.statut, 200);
  assert.equal((await superviseur.delete(`/api/admin/candidats/${ajout.json.id}`)).statut, 200);

  // Un nom piégé avec du HTML est accepté comme simple texte (les pages l'échappent).
  const piege = await superviseur.post(`/api/admin/scrutins/${cpa}/candidats`, { nom: '<img src=x onerror=alert(1)>' });
  assert.equal(piege.statut, 200);
  await superviseur.delete(`/api/admin/candidats/${piege.json.id}`);

  await superviseur.post(`/api/admin/scrutins/${cpa}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });
  const tardif = await superviseur.post(`/api/admin/scrutins/${cpa}/candidats`, { nom: 'Trop Tard' });
  assert.equal(tardif.statut, 409);
});

test('photo : seules de vraies images sont acceptées', async () => {
  const secretaire = await scrutinDe(sql, { ...L2_LIN, poste: 'SECRETAIRE' });
  const [candidat] = await candidatsDe(sql, secretaire);
  const adresse = `/api/admin/candidats/${candidat}/photo`;

  // Un faux fichier "image" qui contient en réalité du texte : refusé.
  const faux = await superviseur.envoyerImage(adresse, 'image/jpeg', Buffer.from('<script>alert(1)</script>'));
  assert.equal(faux.statut, 400);

  // Une vraie petite image PNG (1 × 1 pixel) : acceptée.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const vraie = await superviseur.envoyerImage(adresse, 'image/png', png);
  assert.equal(vraie.statut, 200);
  const scrutins = await visiteur(app).get('/api/scrutins?promotion=2');
  const photoId = scrutins.json.find((s) => s.id === secretaire).candidats.find((c) => c.id === candidat).photoId;
  const image = await app.inject({ method: 'GET', url: `/api/photos/${photoId}` });
  assert.equal(image.headers['content-type'], 'image/png');

  // L'observateur ne peut pas changer une photo.
  assert.equal((await observateur.envoyerImage(adresse, 'image/png', png)).statut, 403);
});

test('candidat unique : élu d’office ; aucun candidat : pas de vote', async () => {
  const secretaireGL = await scrutinDe(sql, { campus: 'LIN', niveau: 'L3', filiere: 'Génie logiciel', poste: 'SECRETAIRE' });
  assert.equal((await superviseur.post(`/api/admin/scrutins/${secretaireGL}/seances/${lin}/ouvrir`, { dureeMinutes: 10 })).statut, 409);
  assert.equal((await superviseur.post(`/api/admin/scrutins/${secretaireGL}/elu-d-office`)).statut, 200);
  const r = await visiteur(app).get(`/api/resultats/${secretaireGL}`);
  assert.equal(r.json.eluDOffice, true);
  assert.equal(r.json.places.length, 1);

  const cpaSante = await scrutinDe(sql, { campus: 'NDJI', niveau: 'L1', filiere: 'Santé publique', poste: 'CPA' });
  const ouverture = await superviseur.post(`/api/admin/scrutins/${cpaSante}/seances/${ndji}/ouvrir`, { dureeMinutes: 10 });
  assert.equal(ouverture.statut, 409);
  assert.match(ouverture.json.erreur, /vacant/);
});

test('égalité → second tour entre les ex æquo, avec les mêmes codes', async () => {
  const secretaire = await scrutinDe(sql, { ...L2_LIN, poste: 'SECRETAIRE' });
  const [c1, c2] = await candidatsDe(sql, secretaire);
  await superviseur.post(`/api/admin/scrutins/${secretaire}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });

  const { v: a } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 0));
  const { v: b } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 1));
  await a.post('/api/etudiant/voter', { scrutinId: secretaire, candidatId: c1 });
  await b.post('/api/etudiant/voter', { scrutinId: secretaire, candidatId: c2 });

  await superviseur.post(`/api/admin/scrutins/${secretaire}/seances/${lin}/fermer`);
  await superviseur.post(`/api/admin/scrutins/${secretaire}/devoiler`, {});
  const resultat = await visiteur(app).get(`/api/resultats/${secretaire}`);
  assert.deepEqual(resultat.json.egalite.candidatIds, [c1, c2]);

  const tour2 = await superviseur.post(`/api/admin/scrutins/${secretaire}/second-tour`);
  assert.equal(tour2.statut, 200);
  assert.equal((await superviseur.post(`/api/admin/scrutins/${secretaire}/second-tour`)).statut, 409);
  const id2 = tour2.json.id;
  const candidats2 = await candidatsDe(sql, id2);
  assert.equal(candidats2.length, 2);

  await superviseur.post(`/api/admin/scrutins/${id2}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });
  assert.equal((await a.post('/api/etudiant/voter', { scrutinId: id2, candidatId: candidats2[0] })).statut, 200);
  assert.equal((await b.post('/api/etudiant/voter', { scrutinId: id2, candidatId: candidats2[0] })).statut, 200);
  await superviseur.post(`/api/admin/scrutins/${id2}/seances/${lin}/fermer`);
  await superviseur.post(`/api/admin/scrutins/${id2}/devoiler`, {});
  const final = await visiteur(app).get(`/api/resultats/${id2}`);
  assert.equal(final.json.places[0].candidatId, candidats2[0]);
  assert.equal(final.json.scrutin.tour, 2);
});

test('présidence « par site » : chaque site dévoilé à part, puis le total', async () => {
  const presidence = await scrutinDe(sql, { poste: 'PRESIDENCE' });
  const [p1, p2, p3] = await candidatsDe(sql, presidence);
  assert.equal((await superviseur.put(`/api/admin/scrutins/${presidence}/mode-devoilement`, { mode: 'par_site' })).statut, 200);

  await superviseur.post(`/api/admin/scrutins/${presidence}/seances/${lin}/ouvrir`, { dureeMinutes: 30 });
  // Le mode est verrouillé dès l'ouverture.
  assert.equal((await superviseur.put(`/api/admin/scrutins/${presidence}/mode-devoilement`, { mode: 'total' })).statut, 409);

  const votesLin = [p1, p1, p2];
  for (let i = 0; i < votesLin.length; i++) {
    const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_LIN, 5 + i));
    assert.equal((await v.post('/api/etudiant/voter', { scrutinId: presidence, candidatId: votesLin[i] })).statut, 200);
  }
  await superviseur.post(`/api/admin/scrutins/${presidence}/seances/${lin}/fermer`);
  assert.equal((await superviseur.post(`/api/admin/scrutins/${presidence}/devoiler`, { campusId: lin })).statut, 200);

  const partiel = await visiteur(app).get(`/api/resultats/${presidence}`);
  assert.equal(partiel.json.complet, false);
  assert.equal(partiel.json.parSite.length, 1);
  assert.equal(partiel.json.places.length, 0);   // pas d'élu tant que N'djili n'a pas voté

  await superviseur.post(`/api/admin/scrutins/${presidence}/seances/${ndji}/ouvrir`, { dureeMinutes: 30 });
  const votesNdji = [p3, p2, p2];
  for (let i = 0; i < votesNdji.length; i++) {
    const { v } = await etudiantConnecte(app, distributeur, await etudiantDe(sql, L2_NDJI, i));
    assert.equal((await v.post('/api/etudiant/voter', { scrutinId: presidence, candidatId: votesNdji[i] })).statut, 200);
  }
  await superviseur.post(`/api/admin/scrutins/${presidence}/seances/${ndji}/fermer`);
  await superviseur.post(`/api/admin/scrutins/${presidence}/devoiler`, { campusId: ndji });

  // Les deux sites dévoilés : le total l'est automatiquement.
  const total = await visiteur(app).get(`/api/resultats/${presidence}`);
  assert.equal(total.json.complet, true);
  // Total : p1 = 2, p2 = 3, p3 = 1 → p2 président, p1 vice-président.
  assert.deepEqual(total.json.places.map((p) => [p.nomPlace, p.candidatId]), [['Président(e)', p2], ['Vice-président(e)', p1]]);
});

test('le journal note les actions, ne contient aucun code, et ne s’efface pas', async () => {
  const journal = await observateur.get('/api/admin/journal');
  const actions = new Set(journal.json.map((l) => l.action));
  for (const attendu of ['code_remis', 'code_remplace', 'vote_ouvert', 'resultats_devoiles', 'second_tour_cree', 'elu_d_office']) {
    assert.ok(actions.has(attendu), attendu);
  }
  assert.ok(!/[A-Z][0-9][A-Z]{3}-[A-Z]{2,5}-[A-Z2-9]{6}/.test(JSON.stringify(journal.json)));

  await assert.rejects(sql`delete from journal`, /ni modifié ni effacé/);
  await assert.rejects(sql`update journal set action = 'falsifie'`, /ni modifié ni effacé/);
  await assert.rejects(sql`truncate journal`, /ni modifié ni effacé/);
});
