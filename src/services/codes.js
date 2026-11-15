// Tout ce qui concerne les codes de vote : fabrication, vérification, empreinte.
//
// Un code ressemble à  L2INF-LIN-K7M2QX
//   L2     : la promotion (le niveau)
//   INF    : la faculté
//   LIN    : le site
//   K7M2QX : la partie secrète, tirée au hasard
//
// Seule la partie secrète protège le vote. Le début est lisible exprès,
// pour que l'étudiant repère vite une faute de frappe.

import { randomInt, createHmac } from 'node:crypto';

// 31 caractères : on a retiré ceux qu'on confond facilement en lisant ou
// en recopiant (0 et O, 1 et I et L).
export const ALPHABET_SECRET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LONGUEUR_SECRET = 6;   // 31^6 ≈ 887 millions de combinaisons

// Forme générale d'un code. Elle sert seulement à rejeter tout de suite une
// saisie qui n'a rien à voir : un code bien formé n'est pas pour autant valide,
// il doit exister dans la base.
const FORME_CODE = new RegExp(
  `^[A-Z][0-9][A-Z]{3}-[A-Z]{2,5}-[${ALPHABET_SECRET}]{${LONGUEUR_SECRET}}$`
);

export function prefixeCode({ niveau, sigleFaculte, sigleCampus }) {
  return `${niveau}${sigleFaculte}-${sigleCampus}`;
}

// randomInt utilise le générateur cryptographique de Node.js : impossible
// de prévoir le prochain tirage, contrairement à Math.random().
export function tirerPartieSecrete() {
  let resultat = '';
  for (let i = 0; i < LONGUEUR_SECRET; i++) {
    resultat += ALPHABET_SECRET[randomInt(ALPHABET_SECRET.length)];
  }
  return resultat;
}

// Met en forme ce que l'étudiant a tapé : majuscules, sans espaces,
// tirets "longs" remplacés par des tirets normaux.
export function normaliserCode(saisie) {
  return String(saisie ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[‐-―−_]/g, '-');
}

export function aLaFormeDUnCode(code) {
  return FORME_CODE.test(code);
}

// L'empreinte est ce qu'on range dans la base à la place du code.
// HMAC-SHA-256 avec une clé secrète : sans la clé (CODE_SECRET), on ne
// peut ni retrouver le code à partir de l'empreinte, ni tester des codes
// au hasard contre une copie volée de la base.
export function empreinteCode(code, cleSecrete) {
  return createHmac('sha256', cleSecrete).update(code).digest('hex');
}
