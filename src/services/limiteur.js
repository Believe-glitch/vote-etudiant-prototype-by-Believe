// Limiteur d'essais ratés, pour empêcher quelqu'un d'essayer des milliers
// de codes ou de mots de passe à la suite.
//
// Attention au vote en salle : tous les téléphones branchés sur le même
// Wi-Fi sortent souvent sur Internet avec la même adresse. On ne compte donc
// que les essais RATÉS, et on laisse une marge large pour les fautes de frappe.
//
// Les compteurs sont gardés en mémoire : ils repartent à zéro si le serveur
// redémarre, ce qui est suffisant pour notre usage.

export class LimiteurEchecs {
  constructor({ maximum, fenetreMinutes }) {
    this.maximum = maximum;
    this.fenetreMs = fenetreMinutes * 60 * 1000;
    this.compteurs = new Map(); // clé → { echecs, finFenetre }
  }

  #compteur(cle) {
    const maintenant = Date.now();
    let compteur = this.compteurs.get(cle);
    if (!compteur || compteur.finFenetre <= maintenant) {
      compteur = { echecs: 0, finFenetre: maintenant + this.fenetreMs };
      this.compteurs.set(cle, compteur);
    }
    return compteur;
  }

  estBloque(cle) {
    return this.#compteur(cle).echecs >= this.maximum;
  }

  noterEchec(cle) {
    this.#compteur(cle).echecs++;
  }

  // Ménage régulier pour que la mémoire ne grossisse pas indéfiniment.
  nettoyer() {
    const maintenant = Date.now();
    for (const [cle, compteur] of this.compteurs) {
      if (compteur.finFenetre <= maintenant) this.compteurs.delete(cle);
    }
  }
}

// Petite pause après un échec : ralentit encore plus les essais automatiques.
export function patienter(millisecondes) {
  return new Promise((resolve) => setTimeout(resolve, millisecondes));
}
