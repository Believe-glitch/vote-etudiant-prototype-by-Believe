// Filtre « site → faculté → promotion » réutilisable, avec l'option « Tous ».
//
// On lui donne trois listes déroulantes et la structure de l'université
// (/api/structure). Chaque fois que le choix change, il appelle quandChange().
// Il sait aussi dire si une promotion correspond au choix en cours.

import { e } from './commun.js';

export function brancherFiltrePromotion({ site, faculte, promotion }, structure, quandChange) {
  const options = (elements, tous, texte) =>
    `<option value="">${tous}</option>` +
    elements.map((x) => `<option value="${x.id}">${e(texte(x))}</option>`).join('');

  function remplirFacultes() {
    const campusId = Number(site.value) || null;
    const facultes = structure.facultes.filter((f) =>
      structure.promotions.some((p) => p.faculteId === f.id && (!campusId || p.campusId === campusId)));
    const avant = faculte.value;
    faculte.innerHTML = options(facultes, 'Toutes les facultés', (f) => f.nom);
    if ([...faculte.options].some((o) => o.value === avant)) faculte.value = avant;
    remplirPromotions();
  }

  function remplirPromotions() {
    const campusId = Number(site.value) || null;
    const faculteId = Number(faculte.value) || null;
    const promotions = structure.promotions.filter((p) =>
      (!campusId || p.campusId === campusId) && (!faculteId || p.faculteId === faculteId));
    const avant = promotion.value;
    promotion.innerHTML = options(promotions, 'Toutes les promotions', (p) => p.libelle);
    if ([...promotion.options].some((o) => o.value === avant)) promotion.value = avant;
  }

  site.innerHTML = options(structure.campus, 'Les deux sites', (c) => c.nom);
  site.addEventListener('change', () => { remplirFacultes(); quandChange(); });
  faculte.addEventListener('change', () => { remplirPromotions(); quandChange(); });
  promotion.addEventListener('change', quandChange);
  remplirFacultes();

  const promotionsParId = new Map(structure.promotions.map((p) => [p.id, p]));

  return {
    // Vrai si la promotion (son id) correspond aux choix faits.
    correspond(promotionId) {
      const p = promotionsParId.get(promotionId);
      if (!p) return false;
      if (site.value && p.campusId !== Number(site.value)) return false;
      if (faculte.value && p.faculteId !== Number(faculte.value)) return false;
      if (promotion.value && p.id !== Number(promotion.value)) return false;
      return true;
    },
    // Choisit une promotion précise (et son site et sa faculté).
    choisir(promotionId) {
      const p = promotionsParId.get(promotionId);
      if (!p) return;
      site.value = String(p.campusId);
      remplirFacultes();
      faculte.value = String(p.faculteId);
      remplirPromotions();
      promotion.value = String(p.id);
    },
    // Remet tous les choix sur « Tous ».
    reinitialiser() {
      site.value = '';
      remplirFacultes();
      faculte.value = '';
      remplirPromotions();
      promotion.value = '';
    },
  };
}

// Version "pour comparer" d'un texte : minuscules, sans accents.
export function pourComparer(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
