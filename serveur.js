// Point de départ du site : c'est ce fichier que lancent « npm run dev »
// (sur ton PC) et « npm start » (sur Render).

import { chargerConfiguration } from './src/configuration.js';
import { connecterBase } from './src/base/connexion.js';
import { preparerBase } from './src/base/installation.js';
import { construireApplication } from './src/application.js';

const config = chargerConfiguration();
const sql = connecterBase(config.adresseBase);

await preparerBase(sql, config);
const app = await construireApplication({ config, sql });

// 0.0.0.0 : le serveur accepte les connexions venant de l'extérieur
// (obligatoire sur Render ; sur ton PC, ouvre http://localhost:3000).
await app.listen({ port: config.port, host: '0.0.0.0' });

// Arrêt propre (Ctrl+C sur ton PC, ou redémarrage sur Render) : on termine
// les demandes en cours, puis on ferme la connexion à la base.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`Arrêt du serveur (${signal})…`);
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
