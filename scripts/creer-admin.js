// Crée un compte officiel (superviseur, distributeur ou observateur).
//
// Utilisation, dans le terminal de VS Code :
//   npm run creer-admin -- jean.kabeya "Jean Kabeya" distributeur
// Le mot de passe est ensuite demandé au clavier (au moins 10 caractères).
//
// Le compte est créé dans la base indiquée par DATABASE_URL (fichier .env).

import { createInterface } from 'node:readline/promises';
import argon2 from 'argon2';
import { connecterBase } from '../src/base/connexion.js';

const ROLES = ['superviseur', 'distributeur', 'observateur'];
const [identifiantBrut, nomComplet, role] = process.argv.slice(2);

if (!identifiantBrut || !nomComplet || !ROLES.includes(role)) {
  console.log('Utilisation : npm run creer-admin -- <identifiant> "<Nom complet>" <rôle>');
  console.log(`Rôles possibles : ${ROLES.join(', ')}`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL est absente du fichier .env.');
  process.exit(1);
}

const identifiant = identifiantBrut.trim().toLowerCase();
const clavier = createInterface({ input: process.stdin, output: process.stdout });
const motDePasse = await clavier.question('Mot de passe (au moins 10 caractères) : ');
clavier.close();

if (motDePasse.length < 10) {
  console.log('Mot de passe trop court. Rien n’a été créé.');
  process.exit(1);
}

const sql = connecterBase(process.env.DATABASE_URL);
try {
  const empreinte = await argon2.hash(motDePasse, { type: argon2.argon2id });
  const [compte] = await sql`
    insert into compte_admin (identifiant, nom_complet, mot_de_passe_hache, role)
    values (${identifiant}, ${nomComplet}, ${empreinte}, ${role})
    on conflict (identifiant) do nothing
    returning id`;
  if (compte) console.log(`Compte « ${identifiant} » (${role}) créé.`);
  else console.log(`L’identifiant « ${identifiant} » existe déjà. Rien n’a été créé.`);
} finally {
  await sql.end();
}
