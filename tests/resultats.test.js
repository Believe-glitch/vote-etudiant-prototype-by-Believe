// Tests du calcul des résultats (sans base de données).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerResultat } from '../src/services/resultats.js';

const c = (id, voix) => ({ id, nom: `Candidat ${id}`, voix });

test('CP : le candidat qui a le plus de voix est élu', () => {
  const r = calculerResultat({ candidats: [c(1, 3), c(2, 7), c(3, 5)] });
  assert.deepEqual(r.places.map((p) => [p.rang, p.candidat.id]), [[1, 2]]);
  assert.equal(r.egalite, null);
});

test('CP : égalité en tête → second tour entre les ex æquo', () => {
  const r = calculerResultat({ candidats: [c(1, 7), c(2, 7), c(3, 5)] });
  assert.equal(r.places.length, 0);
  assert.deepEqual(r.egalite, { candidatIds: [1, 2], premierePlace: 1, nombrePlaces: 1 });
});

test('CP : une égalité derrière le gagnant ne compte pas', () => {
  const r = calculerResultat({ candidats: [c(1, 9), c(2, 4), c(3, 4)] });
  assert.deepEqual(r.places.map((p) => p.candidat.id), [1]);
  assert.equal(r.egalite, null);
});

test('Présidence : le 1er est président, le 2e vice-président', () => {
  const r = calculerResultat({ candidats: [c(1, 10), c(2, 7), c(3, 5)], nombrePlaces: 2 });
  assert.deepEqual(r.places.map((p) => [p.rang, p.candidat.id]), [[1, 1], [2, 2]]);
  assert.equal(r.egalite, null);
});

test('Présidence : égalité pour la 2e place → second tour pour la vice-présidence seulement', () => {
  const r = calculerResultat({ candidats: [c(1, 10), c(2, 7), c(3, 7)], nombrePlaces: 2 });
  assert.deepEqual(r.places.map((p) => [p.rang, p.candidat.id]), [[1, 1]]);
  assert.deepEqual(r.egalite, { candidatIds: [2, 3], premierePlace: 2, nombrePlaces: 1 });
});

test('Présidence : égalité à deux en tête → le second tour désigne président et vice', () => {
  const r = calculerResultat({ candidats: [c(1, 10), c(2, 10), c(3, 5)], nombrePlaces: 2 });
  assert.equal(r.places.length, 0);
  assert.deepEqual(r.egalite, { candidatIds: [1, 2], premierePlace: 1, nombrePlaces: 2 });
});

test('Présidence : égalité à trois en tête → second tour à trois pour les deux places', () => {
  const r = calculerResultat({ candidats: [c(1, 4), c(2, 4), c(3, 4)], nombrePlaces: 2 });
  assert.deepEqual(r.egalite, { candidatIds: [1, 2, 3], premierePlace: 1, nombrePlaces: 2 });
});

test('Second tour de vice-présidence : le gagnant prend la 2e place', () => {
  const r = calculerResultat({ candidats: [c(2, 6), c(3, 9)], premierePlace: 2, nombrePlaces: 1 });
  assert.deepEqual(r.places.map((p) => [p.rang, p.candidat.id]), [[2, 3]]);
});
