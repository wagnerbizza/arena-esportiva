import json
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

key = os.environ.get("ARENA_FOOTBALL_KEY")
if not key:
    raise SystemExit("Configure o segredo ARENA_FOOTBALL_KEY.")
day = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
params = urlencode({"date": day, "timezone": "America/Sao_Paulo"})
request = Request("https://v3.football.api-sports.io/fixtures?" + params,
                  headers={"x-apisports-key": key})
with urlopen(request, timeout=25) as response:
    data = json.load(response)
if data.get("errors") or not isinstance(data.get("response"), list):
    raise SystemExit("A fonte de placares recusou a consulta. Confira o plano e a cota.")
competitions = {71: "Brasileirão Série A", 475: "Paulista", 13: "Libertadores"}
rows = []
for item in data["response"]:
    league, fixture, teams, goals = (item[key] for key in ("league", "fixture", "teams", "goals"))
    competition = competitions.get(league["id"])
    if not competition and league.get("country") == "Brazil" and league["name"] in {"Paulista - A1", "Paulista A1"}:
        competition = "Paulista"
    if not competition:
        continue
    rows.append({"league": competition, "round": league.get("round", ""),
                 "home": teams["home"]["name"], "away": teams["away"]["name"],
                 "date": fixture["date"], "status": fixture["status"]["short"],
                 "minute": fixture["status"].get("elapsed"),
                 "score": [goals["home"], goals["away"]]})
with open(sys.argv[1], "w", encoding="utf-8") as file:
    json.dump({"day": day, "updatedAt": datetime.now(timezone.utc).isoformat(),
               "games": sorted(rows, key=lambda row: row["date"])}, file, ensure_ascii=False)
