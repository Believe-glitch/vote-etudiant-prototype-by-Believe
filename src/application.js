// Assemblage du serveur web : on crée l'application Fastify, on branche les
// protections, les fichiers des pages et toutes les routes de l'API.
//
// Cette fonction ne démarre pas le serveur : c'est serveur.js qui le fait.
// Les tests utilisent aussi cette fonction, sans ouvrir de port réseau.

import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fichiersStatiques from '@fastify/static';

import { ErreurMetier } from './services/erreurs.js';
import { Direct } from './services/direct.js';
import { LimiteurEchecs } from './services/limiteur.js';
import { lireSession, COOKIE_ETUDIANT, COOKIE_ADMIN, supprimerSessionsExpirees } from './services/sessions.js';
import { routesPubliques } from './routes/public.js';
import { routesEtudiant } from './routes/etudiant.js';
import { routesAdmin } from './routes/admin.js';
import { routesAdminCodes } from './routes/admin-codes.js';
import { routesAdminScrutins } from './routes/admin-scrutins.js';

const DOSSIER_PAGES = fileURLToPath(new URL('../public', import.meta.url));

export async function construireApplication({ config, sql, journalisation = true }) {
  const app = Fastify({
    // Les logs notent chaque demande (adresse, durée, résultat), jamais son contenu :
    // ni code, ni mot de passe, ni choix de vote n'y apparaissent.
    logger: journalisation ? { level: 'info' } : false,
    // Sur Render, les demandes passent par un relais : on lui fait confiance
    // pour connaître la vraie adresse de l'internaute (utile au limiteur).
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Ce dont toutes les routes ont besoin, accessible via app.sql, app.config…
  app.decorate('sql', sql);
  app.decorate('config', config);
  app.decorate('direct', new Direct(sql, app.log));
  app.decorate('limiteurEtudiants', new LimiteurEchecs({ maximum: 100, fenetreMinutes: 10 }));
  app.decorate('limiteurAdmins', new LimiteurEchecs({ maximum: 10, fenetreMinutes: 15 }));

  await app.register(cookie);

  // En-têtes de sécurité. La "Content Security Policy" n'autorise que les
  // scripts, styles et images venant de notre propre site : un script
  // injecté par un pirate ne s'exécuterait pas.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.enProduction ? [] : null,
      },
    },
    // En local (http://localhost), on ne force pas le HTTPS.
    strictTransportSecurity: config.enProduction,
  });

  // Les photos arrivent en binaire (déjà compressées par la page admin).
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 600 * 1024 },
    (requete, corps, termine) => termine(null, corps)
  );

  // Les pages du site (HTML, CSS, JavaScript, images).
  await app.register(fichiersStatiques, {
    root: DOSSIER_PAGES,
    extensions: ['html'],        // /candidats ouvre candidats.html
    maxAge: config.enProduction ? '1h' : 0,
  });

  // --- Contrôle des connexions -------------------------------------------

  // Avant une route réservée aux étudiants connectés.
  app.decorate('exigerEtudiant', async (requete) => {
    const codeId = await lireSession(sql, 'etudiant', requete.cookies[COOKIE_ETUDIANT]);
    if (!codeId) throw new ErreurMetier('Vous n’êtes pas connecté. Entrez votre code.', 401);
    requete.codeId = codeId;
  });

  // Avant une route réservée à certains rôles d'officiels.
  app.decorate('exigerRole', (...rolesAutorises) => async (requete) => {
    const adminId = await lireSession(sql, 'admin', requete.cookies[COOKIE_ADMIN]);
    if (!adminId) throw new ErreurMetier('Connectez-vous à l’espace officiels.', 401);
    const [compte] = await sql`
      select id, identifiant, nom_complet, role from compte_admin
      where id = ${adminId} and actif`;
    if (!compte) throw new ErreurMetier('Ce compte n’est plus actif.', 401);
    if (rolesAutorises.length > 0 && !rolesAutorises.includes(compte.role)) {
      throw new ErreurMetier('Votre rôle ne permet pas cette action.', 403);
    }
    requete.admin = compte;
  });

  // Les réponses de l'API ne doivent jamais être gardées en mémoire par le
  // navigateur ou un relais (un code de vote affiché une seule fois, par exemple).
  app.addHook('onSend', async (requete, reponse) => {
    if (requete.url.startsWith('/api/') && !reponse.hasHeader('Cache-Control')) {
      reponse.header('Cache-Control', 'no-store');
    }
  });

  // --- Erreurs -------------------------------------------------------------

  app.setErrorHandler((erreur, requete, reponse) => {
    if (erreur instanceof ErreurMetier) {
      return reponse.code(erreur.statutHttp).send({ erreur: erreur.message });
    }
    if (erreur.validation) {
      return reponse.code(400).send({ erreur: 'Les informations envoyées sont incomplètes ou incorrectes.' });
    }
    if (erreur.statusCode === 413) {
      return reponse.code(413).send({ erreur: 'Fichier trop lourd.' });
    }
    if (erreur.statusCode && erreur.statusCode < 500) {
      return reponse.code(erreur.statusCode).send({ erreur: 'Demande incorrecte.' });
    }
    requete.log.error(erreur);
    return reponse.code(500).send({ erreur: 'Erreur du serveur. Réessayez dans un instant.' });
  });

  app.setNotFoundHandler((requete, reponse) => {
    if (requete.url.startsWith('/api/')) {
      return reponse.code(404).send({ erreur: 'Adresse inconnue.' });
    }
    return reponse.code(404).sendFile('404.html');
  });

  // --- Routes ----------------------------------------------------------------

  await app.register(routesPubliques, { prefix: '/api' });
  await app.register(routesEtudiant, { prefix: '/api/etudiant' });
  await app.register(routesAdmin, { prefix: '/api/admin' });
  await app.register(routesAdminCodes, { prefix: '/api/admin' });
  await app.register(routesAdminScrutins, { prefix: '/api/admin' });

  // --- Tâches régulières --------------------------------------------------

  let menage;
  app.addHook('onReady', async () => {
    app.direct.demarrer();
    menage = setInterval(() => {
      app.limiteurEtudiants.nettoyer();
      app.limiteurAdmins.nettoyer();
      supprimerSessionsExpirees(sql).catch((erreur) => app.log.error(erreur));
    }, 10 * 60 * 1000);
  });
  app.addHook('onClose', async () => {
    clearInterval(menage);
    app.direct.arreter();
  });

  return app;
}
