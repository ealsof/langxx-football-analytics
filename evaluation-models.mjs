
function factorial(n) {
    if (n <= 1) return 1;
  
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
  
    return result;
  }
  
  function poisson(lambda, k) {
    return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  }
  
  export function actualResult(home, away) {
    if (home > away) return "H";
    if (home === away) return "D";
    return "A";
  }
  
  export function predictedResult(prediction) {
    if (
      prediction.homeProb >= prediction.drawProb &&
      prediction.homeProb >= prediction.awayProb
    ) {
      return "H";
    }
  
    if (prediction.drawProb >= prediction.awayProb) return "D";
  
    return "A";
  }
  
  function leagueStats(competition, previous) {
    const matches = previous.filter(
      (match) => match.competition === competition
    );
  
    if (!matches.length) {
      return { homeGoals: 1.45, awayGoals: 1.15 };
    }
  
    let homeGoals = 0;
    let awayGoals = 0;
  
    for (const match of matches) {
      homeGoals += Number(match.home_score);
      awayGoals += Number(match.away_score);
    }
  
    return {
      homeGoals: homeGoals / matches.length,
      awayGoals: awayGoals / matches.length,
    };
  }
  
  function teamStats(team, competition, previous) {
    const matches = previous.filter(
      (match) =>
        match.competition === competition &&
        (match.home_team === team || match.away_team === team)
    );
  
    let goalsFor = 0;
    let goalsAgainst = 0;
  
    for (const match of matches) {
      if (match.home_team === team) {
        goalsFor += Number(match.home_score);
        goalsAgainst += Number(match.away_score);
      } else {
        goalsFor += Number(match.away_score);
        goalsAgainst += Number(match.home_score);
      }
    }
  
    return {
      games: matches.length,
      goalsFor,
      goalsAgainst,
    };
  }
  
  function poissonPrediction(homeGoals, awayGoals) {
    let homeProb = 0;
    let drawProb = 0;
    let awayProb = 0;
  
    for (let hg = 0; hg <= 7; hg++) {
      for (let ag = 0; ag <= 7; ag++) {
        const probability = poisson(homeGoals, hg) * poisson(awayGoals, ag);
  
        if (hg > ag) homeProb += probability;
        else if (hg === ag) drawProb += probability;
        else awayProb += probability;
      }
    }
  
    const total = homeProb + drawProb + awayProb;
  
    return {
      homeGoals,
      awayGoals,
      homeProb: homeProb / total,
      drawProb: drawProb / total,
      awayProb: awayProb / total,
    };
  }
  
  // V0.2: statistik seluruh pertandingan sebelumnya dalam kompetisi yang sama.
  export function predictV02(match, previous) {
    const league = leagueStats(match.competition, previous);
  
    const home = teamStats(match.home_team, match.competition, previous);
    const away = teamStats(match.away_team, match.competition, previous);
  
    const homeAttack =
      home.goalsFor / Math.max(league.homeGoals * home.games, 0.1);
  
    const awayAttack =
      away.goalsFor / Math.max(league.awayGoals * away.games, 0.1);
  
    const homeDefense =
      home.goalsAgainst / Math.max(league.awayGoals * home.games, 0.1);
  
    const awayDefense =
      away.goalsAgainst / Math.max(league.homeGoals * away.games, 0.1);
  
    let homeGoals = league.homeGoals * homeAttack * awayDefense;
    let awayGoals = league.awayGoals * awayAttack * homeDefense;
  
    homeGoals *= 1.05;
  
    homeGoals = Math.max(0.2, Math.min(homeGoals, 4.5));
    awayGoals = Math.max(0.2, Math.min(awayGoals, 4.5));
  
    return poissonPrediction(homeGoals, awayGoals);
  }
  
  function eloExpected(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }
  
  function buildEloRatings(previous) {
    const ratings = new Map();
  
    function getRating(team) {
      if (!ratings.has(team)) ratings.set(team, 1500);
      return ratings.get(team);
    }
  
    const chronological = [...previous].sort(
      (a, b) => new Date(a.kickoff) - new Date(b.kickoff)
    );
  
    for (const match of chronological) {
      const homeTeam = match.home_team;
      const awayTeam = match.away_team;
  
      const homeScore = Number(match.home_score);
      const awayScore = Number(match.away_score);
  
      let homeRating = getRating(homeTeam);
      let awayRating = getRating(awayTeam);
  
      const expectedHome = eloExpected(homeRating + 60, awayRating);
      const expectedAway = 1 - expectedHome;
  
      let actualHome;
      let actualAway;
  
      if (homeScore > awayScore) {
        actualHome = 1;
        actualAway = 0;
      } else if (homeScore === awayScore) {
        actualHome = 0.5;
        actualAway = 0.5;
      } else {
        actualHome = 0;
        actualAway = 1;
      }
  
      const goalDifference = Math.abs(homeScore - awayScore);
  
      let marginMultiplier = 1;
      if (goalDifference === 2) marginMultiplier = 1.25;
      else if (goalDifference >= 3) marginMultiplier = 1.5;
  
      const k = 25 * marginMultiplier;
  
      homeRating += k * (actualHome - expectedHome);
      awayRating += k * (actualAway - expectedAway);
  
      ratings.set(homeTeam, homeRating);
      ratings.set(awayTeam, awayRating);
    }
  
    return ratings;
  }
  
  // V0.4: Elo untuk kekuatan relatif, lalu estimasi gol dengan Poisson.
  export function predictV04(match, previous) {
    const ratings = buildEloRatings(previous);
    const league = leagueStats(match.competition, previous);
  
    const homeRating = ratings.has(match.home_team)
      ? ratings.get(match.home_team)
      : 1500;
  
    const awayRating = ratings.has(match.away_team)
      ? ratings.get(match.away_team)
      : 1500;
  
    const difference = homeRating + 60 - awayRating;
  
    const homeFactor = Math.max(
      0.65,
      Math.min(1.35, 1 + difference / 1000)
    );
  
    const awayFactor = Math.max(
      0.65,
      Math.min(1.35, 1 - difference / 1200)
    );
  
    let homeGoals = league.homeGoals * homeFactor;
    let awayGoals = league.awayGoals * awayFactor;
  
    homeGoals = Math.max(0.2, Math.min(homeGoals, 4.5));
    awayGoals = Math.max(0.2, Math.min(awayGoals, 4.5));
  
    return poissonPrediction(homeGoals, awayGoals);
  }