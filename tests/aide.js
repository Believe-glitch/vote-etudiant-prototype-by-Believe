// Outils communs aux tests.
//
// Les tests utilisent une base À PART (TEST_DATABASE_URL), qui est
// entièrement vidée au début de chaque fichier de test. Ne mets JAMAIS
// l'adresse de ta vraie base dans TEST_DATABASE_URL.

import { connecterBase } from '../src/base/connexion.js';
import { preparerBase } from '../src/base/installation.js';
import { construireApplication } from '../src/application.js';

export const MOT_DE_PASSE = 'mot-de-passe-de-test';

export async function demarrerTest() {
  const adresse = process.env.TEST_DATABASE_URL;
  if (!adresse) {
    throw new Error('TEST_DATABASE_URL est absente du fichier .env : voir la section « Tests » de LISEZMOI.md.');
  }
  if (process.env.DATABASE_URL && adresse === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL doit être différente de DATABASE_URL : les tests vident la base !');
  }

  const sql = connecterBase(adresse);
  // On repart d'une base vide : toutes les tables sont supprimées.
  await sql.unsafe('drop schema public cascade; create schema public;');

  const config = {
    adresseBase: adresse,
    cleSecreteCodes: 'cle-secrete-pour-les-tests-uniquement-0123456789',
    port: 0,
    enProduction: false,
    donneesDemo: true,
    motDePasseDemo: MOT_DE_PASSE,
  };
  await preparerBase(sql, config);
  const app = await construireApplication({ config, sql, journalisation: false });
  await app.ready();

  const fermer = async () => {
    await app.close();
    await sql.end();
  };
  return { app, sql, fermer };
}

// Un "visiteur" garde ses cookies d'une demande à l'autre, comme un navigateur.
export function visiteur(app) {
  const cookies = {};
  async function demande(methode, url, corps) {
    const reponse = await app.inject({
      method: methode,
      url,
      cookies,
      ...(corps !== undefined ? { payload: corps } : {}),
    });
    for (const c of reponse.cookies) {
      if (c.value === '' || c.maxAge === 0) delete cookies[c.name];
      else cookies[c.name] = c.value;
    }
    let json = null;
    try { json = reponse.json(); } catch { /* pas du JSON */ }
    return { statut: reponse.statusCode, json };
  }
  // Envoi d'un fichier brut (photo), avec les cookies du visiteur.
  async function envoyerImage(url, typeMime, donnees) {
    const reponse = await app.inject({
      method: 'PUT', url, cookies, headers: { 'content-type': typeMime }, payload: donnees,
    });
    return { statut: reponse.statusCode, json: reponse.json() };
  }
  return {
    envoyerImage,
    get: (url) => demande('GET', url),
    post: (url, corps = {}) => demande('POST', url, corps),
    put: (url, corps = {}) => demande('PUT', url, corps),
    delete: (url) => demande('DELETE', url, {}),
  };
}

export async function officiel(app, identifiant) {
  const v = visiteur(app);
  const r = await v.post('/api/admin/connexion', { identifiant, motDePasse: MOT_DE_PASSE });
  if (r.statut !== 200) throw new Error(`Connexion de ${identifiant} impossible : ${JSON.stringify(r.json)}`);
  return v;
}

// Renvoie l'id d'un étudiant d'une promotion (la n-ième, pour en avoir plusieurs).
export async function etudiantDe(sql, { campus, niveau, filiere = '' }, rang = 0) {
  const [e] = await sql`
    select e.id from etudiant e
    join promotion pr on pr.id = e.promotion_id
    join campus c on c.id = pr.campus_id
    where c.sigle = ${campus} and pr.niveau = ${niveau} and pr.filiere = ${filiere}
    order by e.id offset ${rang} limit 1`;
  return e.id;
}

export async function scrutinDe(sql, { campus, niveau, filiere = '', poste }) {
  if (poste === 'PRESIDENCE') {
    const [s] = await sql`select id from scrutin where poste = 'PRESIDENCE' order by tour desc limit 1`;
    return s.id;
  }
  const [s] = await sql`
    select s.id from scrutin s
    join promotion pr on pr.id = s.promotion_id
    join campus c on c.id = pr.campus_id
    where c.sigle = ${campus} and pr.niveau = ${niveau} and pr.filiere = ${filiere} and s.poste = ${poste}
    order by s.tour desc limit 1`;
  return s.id;
}

export async function campusId(sql, sigle) {
  const [c] = await sql`select id from campus where sigle = ${sigle}`;
  return c.id;
}

export async function candidatsDe(sql, scrutinId) {
  return (await sql`select id from candidat where scrutin_id = ${scrutinId} order by id`).map((c) => c.id);
}

// Un étudiant reçoit son code (par le distributeur) et se connecte avec.
export async function etudiantConnecte(app, distributeur, etudiantId) {
  const r = await distributeur.post(`/api/admin/etudiants/${etudiantId}/code`);
  if (r.statut !== 200) throw new Error(`Code non généré : ${JSON.stringify(r.json)}`);
  const v = visiteur(app);
  const c = await v.post('/api/etudiant/connexion', { code: r.json.code });
  if (c.statut !== 200) throw new Error(`Connexion étudiant impossible : ${JSON.stringify(c.json)}`);
  return { v, code: r.json.code };
}
