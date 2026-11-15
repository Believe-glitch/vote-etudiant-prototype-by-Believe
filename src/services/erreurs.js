// Une "erreur métier", c'est une erreur prévue, qu'on explique à l'utilisateur :
// « vous avez déjà voté », « ce code n'existe pas »…
// Le chiffre est le code HTTP renvoyé au navigateur :
//   400 demande incorrecte, 401 pas connecté, 403 interdit,
//   404 introuvable, 409 conflit (ex. déjà voté), 429 trop d'essais.
export class ErreurMetier extends Error {
  constructor(message, statutHttp = 400) {
    super(message);
    this.name = 'ErreurMetier';
    this.statutHttp = statutHttp;
  }
}
