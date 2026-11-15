// Lecture des réglages du site.
//
// Les réglages sensibles (mot de passe de la base, clé secrète des codes)
// ne sont jamais écrits dans le code : ils viennent des "variables
// d'environnement". Sur ton PC, elles sont dans le fichier .env ;
// sur Render, dans l'onglet "Environment" du service.

function lire(nom, { obligatoire = false, parDefaut = undefined } = {}) {
  const valeur = process.env[nom];
  if (valeur === undefined || valeur.trim() === '') {
    if (obligatoire) {
      throw new Error(
        `La variable ${nom} est manquante. Ajoute-la dans le fichier .env (sur ton PC) ` +
        `ou dans l'onglet Environment de Render. Voir LISEZMOI.md.`
      );
    }
    return parDefaut;
  }
  return valeur.trim();
}

export function chargerConfiguration() {
  const config = {
    // Adresse de la base PostgreSQL (fournie par Neon).
    adresseBase: lire('DATABASE_URL', { obligatoire: true }),

    // Clé secrète qui sert à "hacher" les codes de vote avant de les ranger
    // dans la base. Si quelqu'un vole la base, il ne peut pas retrouver les
    // codes sans cette clé. ATTENTION : si on la change, tous les codes déjà
    // distribués deviennent invalides.
    cleSecreteCodes: lire('CODE_SECRET', { obligatoire: true }),

    // Port d'écoute du serveur. Render le choisit lui-même.
    port: Number(lire('PORT', { parDefaut: '3000' })),

    // En production (sur Render), les cookies ne circulent qu'en HTTPS.
    enProduction: lire('NODE_ENV', { parDefaut: 'development' }) === 'production',

    // "oui" pour remplir une base vide avec les données de démonstration.
    donneesDemo: lire('DONNEES_DEMO', { parDefaut: 'non' }).toLowerCase() === 'oui',

    // Mot de passe des trois comptes admin de démonstration.
    motDePasseDemo: lire('DEMO_MOT_DE_PASSE'),
  };

  if (config.cleSecreteCodes.length < 32) {
    throw new Error('CODE_SECRET doit contenir au moins 32 caractères (voir LISEZMOI.md).');
  }
  if (config.motDePasseDemo !== undefined && config.motDePasseDemo.length < 8) {
    throw new Error('DEMO_MOT_DE_PASSE doit contenir au moins 8 caractères.');
  }
  return config;
}
