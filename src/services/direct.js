// Le "direct" : le serveur envoie à tous les navigateurs ouverts l'état des
// votes en cours (décompte, participation), dès que quelque chose change.
//
// Technique utilisée : Server-Sent Events (SSE). Le navigateur ouvre UNE
// connexion qui reste ouverte, et le serveur y écrit quand il a du nouveau.
// C'est bien plus léger que des centaines de téléphones qui redemandent
// l'état toutes les secondes.
//
// Ce qui est envoyé est public : la participation (« 20 votants sur 50 »),
// jamais les voix des candidats.

import { NOMS_POSTES } from './resultats.js';
import { compterVotants, compterInscrits, libellePromotion, fermerSeancesEchues } from './scrutins.js';

const DELAI_REGROUPEMENT_MS = 1000;   // au plus un envoi par seconde
const BATTEMENT_MS = 20000;            // message vide pour garder la connexion ouverte

export class Direct {
  constructor(sql, journal) {
    this.sql = sql;
    this.journal = journal;           // pour écrire les erreurs dans les logs
    this.clients = new Set();
    this.envoiPrevu = null;
    this.minuteries = [];
  }

  // Lance la surveillance : fermeture automatique des séances à l'heure,
  // et battement régulier.
  demarrer() {
    let verificationEnCours = false;
    this.minuteries.push(setInterval(async () => {
      if (verificationEnCours) return;
      verificationEnCours = true;
      try {
        if (await fermerSeancesEchues(this.sql)) this.signalerChangement();
      } catch (erreur) {
        this.journal.error(erreur, 'Erreur pendant la fermeture automatique des votes');
      } finally {
        verificationEnCours = false;
      }
    }, 1000));

    this.minuteries.push(setInterval(() => {
      for (const client of this.clients) client.write(': battement\n\n');
    }, BATTEMENT_MS));
  }

  arreter() {
    for (const minuterie of this.minuteries) clearInterval(minuterie);
    this.minuteries = [];
    clearTimeout(this.envoiPrevu);
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  async ajouterClient(reponseBrute) {
    reponseBrute.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',   // demande aux intermédiaires de ne pas retenir les messages
    });
    reponseBrute.write('retry: 3000\n\n'); // en cas de coupure, le navigateur se reconnecte après 3 s
    this.clients.add(reponseBrute);
    reponseBrute.on('close', () => this.clients.delete(reponseBrute));
    try {
      reponseBrute.write(this.#formater(await this.etatPublic()));
    } catch (erreur) {
      this.journal.error(erreur, 'Erreur pendant l’envoi de l’état initial');
    }
  }

  // Appelée après chaque vote ou action d'un officiel. Plusieurs changements
  // rapprochés ne donnent qu'un seul envoi.
  signalerChangement() {
    if (this.envoiPrevu) return;
    this.envoiPrevu = setTimeout(async () => {
      this.envoiPrevu = null;
      if (this.clients.size === 0) return;
      try {
        const message = this.#formater(await this.etatPublic());
        for (const client of this.clients) client.write(message);
      } catch (erreur) {
        this.journal.error(erreur, 'Erreur pendant la diffusion du direct');
      }
    }, DELAI_REGROUPEMENT_MS);
  }

  #formater(etat) {
    return `event: etat\ndata: ${JSON.stringify(etat)}\n\n`;
  }

  // L'état public : les séances ouvertes, et celles fermées en attente de
  // dévoilement. "maintenant" permet aux pages de caler leur décompte sur
  // l'horloge du serveur plutôt que sur celle du téléphone.
  async etatPublic() {
    const seances = await this.sql`
      select s.id as scrutin_id, s.poste, s.tour, s.statut as statut_scrutin, s.promotion_id,
        se.campus_id, c.nom as campus_nom, se.statut, se.fin, se.devoilee,
        pr.niveau, pr.filiere, f.nom as faculte_nom, cp.nom as campus_promotion
      from seance se
      join scrutin s on s.id = se.scrutin_id
      join campus c on c.id = se.campus_id
      left join promotion pr on pr.id = s.promotion_id
      left join faculte f on f.id = pr.faculte_id
      left join campus cp on cp.id = pr.campus_id
      where se.statut = 'ouverte'
         or (se.statut = 'fermee' and s.statut <> 'devoile' and not se.devoilee)
      order by se.fin`;

    const votants = await compterVotants(this.sql, [...new Set(seances.map((s) => s.scrutin_id))]);
    const inscrits = await compterInscrits(this.sql);
    // Change à chaque dévoilement (total ou par site) : les pages de résultats
    // savent ainsi qu'il y a du nouveau à afficher.
    const [{ versionResultats }] = await this.sql`
      select count(*)::int as "versionResultats" from seance where devoilee`;

    return {
      maintenant: new Date().toISOString(),
      versionResultats,
      seances: seances.map((s) => ({
        scrutinId: s.scrutin_id,
        poste: s.poste,
        nomPoste: NOMS_POSTES[s.poste],
        tour: s.tour,
        promotionId: s.promotion_id,
        promotion: s.promotion_id
          ? libellePromotion({ ...s, campus_nom: s.campus_promotion })
          : null,
        campusId: s.campus_id,
        campus: s.campus_nom,
        statut: s.statut,
        fin: s.fin,
        votants: votants.get(`${s.scrutin_id}-${s.campus_id}`) ?? 0,
        inscrits: s.promotion_id
          ? inscrits.parPromotion.get(s.promotion_id) ?? 0
          : inscrits.parCampus.get(s.campus_id) ?? 0,
      })),
    };
  }
}
