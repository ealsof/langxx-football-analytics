import "dotenv/config";

const token = process.env.FOOTBALL_DATA_API_TOKEN;

if (!token) {
  throw new Error("FOOTBALL_DATA_API_TOKEN tidak ditemukan.");
}

const tests = [
  {
    name: "Premier League Teams",
    url: "https://api.football-data.org/v4/competitions/PL/teams"
  },
  {
    name: "La Liga Teams",
    url: "https://api.football-data.org/v4/competitions/PD/teams"
  },
  {
    name: "Premier League Matches",
    url: "https://api.football-data.org/v4/competitions/PL/matches"
  },
  {
    name: "La Liga Matches",
    url: "https://api.football-data.org/v4/competitions/PD/matches"
  }
];

console.log("=== PROVIDER CAPABILITY AUDIT ===\n");

for (const test of tests) {

  try {

    const response = await fetch(test.url, {
      headers: {
        "X-Auth-Token": token
      }
    });

    const text = await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    console.log(`=== ${test.name} ===`);
    console.log(`HTTP: ${response.status}`);
    console.log(`OK  : ${response.ok}`);

    if (data) {

      if (Array.isArray(data.teams)) {
        console.log(`Teams: ${data.teams.length}`);
      }

      if (Array.isArray(data.matches)) {
        console.log(`Matches: ${data.matches.length}`);
      }

      if (data.message) {
        console.log(`Message: ${data.message}`);
      }

    } else {
      console.log("Response bukan JSON.");
    }

    console.log("");

  } catch (error) {

    console.log(`ERROR: ${error.message}\n`);

  }
}

console.log("=== END AUDIT ===");
