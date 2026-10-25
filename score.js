// Punti di ogni giocatore = somma dei suoi eventi bonus/malus.
export function playerScores(events) {
  const s = {};
  for (const e of events) s[e.playerId] = (s[e.playerId] || 0) + e.points;
  return s;
}

// Il capitano vale doppio, sia nei bonus che nei malus.
export const memberScore = (team, id, scores) => (scores[id] || 0) * (id === team.captain ? 2 : 1);

export const teamScore = (team, scores) => team.members.reduce((t, id) => t + memberScore(team, id, scores), 0);
