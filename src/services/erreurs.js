// Une "erreur métier", c'est une erreur prévue, qu'on explique à l'utilisateur :
// « vous avez déjà voté », « ce code n'existe pas »…
// Le chiffre est le code HTTP renvoyé au navigateur :
//   400 demande incorrecte, 401 pas connecté, 403 interdit,
//   404 introuvable, 409 conflit (ex. déjà voté), 429 trop d'essais.
// "donnees" (facultatif) : informations en plus pour la page, par exemple
// { homonyme: true } quand un étudiant du même nom est déjà inscrit.
export class ErreurMetier extends Error {
  constructor(message, statutHttp = 400, donnees = undefined) {
    super(message);
    this.name = 'ErreurMetier';
    this.statutHttp = statutHttp;
    this.donnees = donnees;
  }
}
