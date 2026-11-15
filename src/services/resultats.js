// Calcul du résultat d'un scrutin, à partir des voix de chaque candidat.
//
// Un scrutin attribue une ou deux places :
//   CP, CPA, secrétaire : 1 place (l'élu) ;
//   présidence          : 2 places (1re = président, 2e = vice-président).
//
// Chaque place doit revenir à UN candidat. Si plusieurs candidats ont le même
// nombre de voix et qu'il faut les départager pour une place, on signale une
// égalité : il faudra un second tour entre eux, sans tirage au sort.
//
// Exemples pour la présidence (2 places) :
//   A 10, B 7, C 5      → A président, B vice-président
//   A 10, B 7, C 7      → A président ; égalité B/C pour la vice-présidence
//   A 10, B 10, C 5     → égalité A/B : le second tour désigne président et vice
//
// Cette fonction ne touche pas à la base : elle calcule seulement. C'est ce
// qui permet de la tester facilement (voir tests/resultats.test.js).

export const NOMS_POSTES = {
  CP: 'Chef de promotion (CP)',
  CPA: 'Chef de promotion adjoint (CPA)',
  SECRETAIRE: 'Secrétaire',
  PRESIDENCE: 'Présidence de l’université',
};

export function nomDeLaPlace(poste, rang) {
  if (poste === 'PRESIDENCE') return rang === 1 ? 'Président(e)' : 'Vice-président(e)';
  return 'Élu(e)';
}

export function calculerResultat({ candidats, premierePlace = 1, nombrePlaces = 1 }) {
  // Du plus de voix au moins de voix (ordre alphabétique en cas d'égalité,
  // seulement pour l'affichage : ça ne départage personne).
  const classement = [...candidats].sort(
    (a, b) => b.voix - a.voix || a.nom.localeCompare(b.nom, 'fr')
  );

  // On regroupe les candidats qui ont exactement le même nombre de voix.
  const groupes = [];
  for (const candidat of classement) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier[0].voix === candidat.voix) dernier.push(candidat);
    else groupes.push([candidat]);
  }

  const places = [];
  let egalite = null;
  let rang = premierePlace;
  let placesRestantes = nombrePlaces;

  for (const groupe of groupes) {
    if (placesRestantes === 0) break;
    if (groupe.length === 1) {
      places.push({ rang, candidat: groupe[0] });
      rang++;
      placesRestantes--;
    } else {
      // Plusieurs candidats à égalité pour la (ou les) place(s) suivante(s).
      egalite = {
        candidatIds: groupe.map((c) => c.id),
        premierePlace: rang,
        nombrePlaces: Math.min(groupe.length, placesRestantes),
      };
      break;
    }
  }

  return { classement, places, egalite };
}
