// Le journal garde une trace de chaque action importante d'un officiel :
// code remis, candidat ajouté, vote ouvert, résultats dévoilés…
// La base interdit de modifier ou d'effacer une ligne du journal.
//
// RÈGLE : on n'y écrit JAMAIS un code de vote ni un choix de vote.

export async function noterAuJournal(sql, adminId, action, details = {}) {
  await sql`
    insert into journal (admin_id, action, details)
    values (${adminId}, ${action}, ${sql.json(details)})`;
}
