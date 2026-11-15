// Tests des codes de vote (sans base de données).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHABET_SECRET, LONGUEUR_SECRET, prefixeCode, tirerPartieSecrete,
  normaliserCode, aLaFormeDUnCode, empreinteCode,
} from '../src/services/codes.js';

test('le préfixe suit la forme promotion + faculté - site', () => {
  assert.equal(prefixeCode({ niveau: 'L2', sigleFaculte: 'INF', sigleCampus: 'NDJI' }), 'L2INF-NDJI');
  assert.equal(prefixeCode({ niveau: 'B2', sigleFaculte: 'MED', sigleCampus: 'LIN' }), 'B2MED-LIN');
});

test('l’alphabet secret ne contient aucun caractère ambigu', () => {
  assert.equal(ALPHABET_SECRET.length, 31);
  for (const ambigu of ['0', 'O', '1', 'I', 'L']) assert.ok(!ALPHABET_SECRET.includes(ambigu), ambigu);
});

test('la partie secrète est tirée au hasard et ne se répète pas', () => {
  const tirages = new Set();
  for (let i = 0; i < 5000; i++) {
    const secret = tirerPartieSecrete();
    assert.equal(secret.length, LONGUEUR_SECRET);
    for (const caractere of secret) assert.ok(ALPHABET_SECRET.includes(caractere));
    tirages.add(secret);
  }
  // Sur 5 000 tirages parmi ~887 millions, un doublon est quasi impossible.
  assert.ok(tirages.size >= 4999);
});

test('la saisie de l’étudiant est remise en forme', () => {
  assert.equal(normaliserCode(' l2inf-lin-k7m2qx '), 'L2INF-LIN-K7M2QX');
  assert.equal(normaliserCode('L2INF – LIN – K7M2QX'), 'L2INF-LIN-K7M2QX');
});

test('la forme d’un code est reconnue, sans suffire à le rendre valide', () => {
  assert.ok(aLaFormeDUnCode('L2INF-LIN-K7M2QX'));
  assert.ok(!aLaFormeDUnCode('L2INF-LIN-K7M2Q'));       // trop court
  assert.ok(!aLaFormeDUnCode('L2INF-LIN-K7M2Q0'));      // 0 n'existe pas dans l'alphabet
  assert.ok(!aLaFormeDUnCode("L2INF-LIN-' OR 1=1"));
});

test('l’empreinte dépend de la clé secrète et ne contient pas le code', () => {
  const a = empreinteCode('L2INF-LIN-K7M2QX', 'cle-numero-un');
  const b = empreinteCode('L2INF-LIN-K7M2QX', 'cle-numero-deux');
  assert.notEqual(a, b);
  assert.equal(a, empreinteCode('L2INF-LIN-K7M2QX', 'cle-numero-un'));
  assert.ok(!a.includes('K7M2QX'));
});
