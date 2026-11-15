// Données de démonstration : de faux étudiants et de faux candidats,
// pour montrer le site sans utiliser de vraies listes.
//
// Elles ne sont ajoutées que si DONNEES_DEMO=oui ET que la base est vide.
// Pour le vrai scrutin, on remplacera tout ça par les listes officielles.

const NOMS = [
  'Kalonji', 'Mbuyi', 'Ilunga', 'Tshibangu', 'Kabeya', 'Mukendi', 'Ngoy', 'Banza',
  'Lukusa', 'Kasongo', 'Mwamba', 'Nsimba', 'Lusamba', 'Makiese', 'Bokele', 'Ekofo',
  'Kanku', 'Mulumba', 'Tshala', 'Kayembe', 'Mbala', 'Nkulu', 'Kitenge', 'Lokwa',
];
const PRENOMS = [
  'Grace', 'Paul', 'Esther', 'David', 'Ruth', 'Joël', 'Divine', 'Patrick',
  'Merveille', 'Jonathan', 'Sarah', 'Christian', 'Gloire', 'Ornella', 'Junior', 'Naomie',
  'Héritier', 'Rachel', 'Fiston', 'Plamedi', 'Benedicte', 'Exaucé', 'Chancelvie', 'Trésor',
];
const SLOGANS = [
  'Une promotion unie, des résultats concrets',
  'À l’écoute de chacun, au service de tous',
  'Des notes à l’heure et des salles équipées',
  'Ensemble, plus forts',
  'La transparence avant tout',
  'Votre voix compte',
];

// Les promotions de la démonstration : [site, faculté, niveau, filière, nombre d'étudiants]
const PROMOTIONS_DEMO = [
  ['LIN', 'INF', 'L1', '', 12],
  ['LIN', 'INF', 'L2', '', 15],
  ['LIN', 'INF', 'L3', 'Génie logiciel', 10],
  ['LIN', 'INF', 'L3', 'Sciences informatiques', 10],
  ['LIN', 'DRO', 'L1', '', 12],
  ['LIN', 'MED', 'B1', '', 12],
  ['NDJI', 'INF', 'L2', '', 12],
  ['NDJI', 'SAN', 'L1', 'Santé publique', 10],
];

// Ajoute sites, facultés, promotions et étudiants.
export async function remplirStructureDemo(sql) {
  await sql.begin(async (tx) => {
    await tx`
      insert into campus (sigle, nom) values ('LIN', 'Lingwala'), ('NDJI', 'N’djili')
      on conflict (sigle) do nothing`;
    await tx`
      insert into faculte (sigle, nom) values
        ('INF', 'Sciences informatiques'), ('MED', 'Médecine'), ('DRO', 'Droit'),
        ('COM', 'Communication'), ('ECO', 'Sciences économiques'), ('SAN', 'Sciences de la santé')
      on conflict (sigle) do nothing`;

    let numeroEtudiant = 0;
    for (const [campus, faculte, niveau, filiere, effectif] of PROMOTIONS_DEMO) {
      const [promotion] = await tx`
        insert into promotion (campus_id, faculte_id, niveau, filiere)
        select c.id, f.id, ${niveau}, ${filiere}
        from campus c, faculte f
        where c.sigle = ${campus} and f.sigle = ${faculte}
        returning id`;

      for (let i = 0; i < effectif; i++) {
        numeroEtudiant++;
        // On combine noms et prénoms pour que chaque étudiant ait un nom différent
        // (jusqu'à 24 × 24 = 576 étudiants sans doublon).
        const nom = NOMS[numeroEtudiant % NOMS.length];
        const tourDeListe = Math.floor(numeroEtudiant / NOMS.length);
        const prenom = PRENOMS[(numeroEtudiant * 5 + tourDeListe) % PRENOMS.length];
        const matricule = `2026-${campus}-${String(numeroEtudiant).padStart(4, '0')}`;
        await tx`
          insert into etudiant (promotion_id, matricule, nom, prenom)
          values (${promotion.id}, ${matricule}, ${nom}, ${prenom})`;
      }
    }
  });
}

// Ajoute des candidats pris parmi les étudiants de chaque promotion.
// Quelques cas particuliers sont prévus exprès pour la démonstration :
//   - L3 Génie logiciel (Lingwala) : un seul candidat secrétaire (élu d'office) ;
//   - L1 Santé publique (N'djili) : aucun candidat CPA (poste vacant).
export async function ajouterCandidatsDemo(sql) {
  const [{ nombre }] = await sql`select count(*)::int as nombre from candidat`;
  if (nombre > 0) return;

  const scrutins = await sql`
    select s.id, s.poste, s.promotion_id, pr.niveau, pr.filiere, f.sigle as faculte, c.sigle as campus
    from scrutin s
    left join promotion pr on pr.id = s.promotion_id
    left join faculte f on f.id = pr.faculte_id
    left join campus c on c.id = pr.campus_id
    where s.tour = 1
    order by s.id`;

  let numeroSlogan = 0;
  for (const scrutin of scrutins) {
    let nombreCandidats = { CP: 3, CPA: 2, SECRETAIRE: 2, PRESIDENCE: 3 }[scrutin.poste];
    if (scrutin.poste === 'SECRETAIRE' && scrutin.filiere === 'Génie logiciel') nombreCandidats = 1;
    if (scrutin.poste === 'CPA' && scrutin.faculte === 'SAN') nombreCandidats = 0;
    if (nombreCandidats === 0) continue;

    // Pour une promotion : des étudiants de la promotion, différents pour chaque poste.
    // Pour la présidence : des étudiants de L2 et L3, des deux sites.
    const decalage = { CP: 0, CPA: 3, SECRETAIRE: 5, PRESIDENCE: 0 }[scrutin.poste];
    const etudiants = scrutin.promotion_id
      ? await sql`
          select nom, prenom from etudiant where promotion_id = ${scrutin.promotion_id}
          order by id offset ${decalage} limit ${nombreCandidats}`
      : await sql`
          select e.nom, e.prenom from etudiant e
          join promotion pr on pr.id = e.promotion_id
          where pr.niveau in ('L2', 'L3')
          order by e.id desc limit ${nombreCandidats}`;

    for (const etudiant of etudiants) {
      const slogan = SLOGANS[numeroSlogan++ % SLOGANS.length];
      await sql`
        insert into candidat (scrutin_id, nom, slogan)
        values (${scrutin.id}, ${`${etudiant.prenom} ${etudiant.nom}`}, ${slogan})`;
    }
  }
}
