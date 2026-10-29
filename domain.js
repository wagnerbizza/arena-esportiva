/* REGRAS LOCAIS — usadas no modo demonstração e nos cadastros.
   Para acrescentar modalidades, altere SPORTS. Placar deriva dos eventos. */
(function (root) {
  "use strict";
  const SPORTS = [
    "Futebol",
    "Futsal",
    "Basquete",
    "Vôlei",
    "Vôlei de praia",
    "Handebol",
  ];
  const fresh = () => ({
    settings: {
      title: "Arena • Esporte ao vivo",
      subtitle: "Cada lance, uma história.",
      color: "#c8fa64",
      banner: "",
    },
    championships: [],
    teams: [],
    players: [],
    matches: [],
  });
  const id = () =>
    globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
          (
            c ^
            (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
          ).toString(16),
        );
  const str = (v, max = 150) =>
    String(v ?? "")
      .trim()
      .slice(0, max);
  function need(ok, msg) {
    if (!ok) throw Error(msg);
  }
  function team(s, i) {
    const t = s.teams.find((x) => x.id === i);
    need(t, "Equipe não encontrada.");
    return t;
  }
  function url(v) {
    v = String(v ?? "").trim();
    need(
      !v ||
        (/^https:\/\//i.test(v) && v.length <= 1500) ||
        (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) &&
          v.length <= 40000),
      "Use endereço HTTPS ou imagem compactada pelo painel (até 40 mil caracteres).",
    );
    return v;
  }
  function score(m) {
    if (Array.isArray(m.score)) return [...m.score];
    const result = [0, 0];
    for (const e of m.events || [])
      if (e.type === "ponto") result[e.side] += e.value;
    return result;
  }
  function reduce(input, action, who = "demo", now = new Date().toISOString()) {
    const s = JSON.parse(JSON.stringify(input));
    const a = action;
    s.championships ||= [];
    need(a && typeof a.type === "string", "Ação inválida.");
    if (a.type === "settings") {
      s.settings = {
        title: str(a.data.title, 100) || "Arena",
        subtitle: str(a.data.subtitle, 200),
        color: /^#[0-9a-f]{6}$/i.test(a.data.color) ? a.data.color : "#c8fa64",
        banner: url(a.data.banner),
      };
    } else if (a.type === "championship") {
      const d = a.data;
      const previous = s.championships.find((c) => c.id === d.id);
      need(!d.id || previous, "Campeonato não encontrado.");
      need(str(d.name, 100), "Informe o nome do campeonato.");
      need(str(d.season, 40), "Informe a edição ou temporada.");
      need(SPORTS.includes(d.sport), "Modalidade inválida.");
      need(["Planejado", "Em andamento", "Encerrado"].includes(d.status), "Situação do campeonato inválida.");
      need(!previous || previous.sport === d.sport, "A modalidade não pode mudar após o cadastro. Crie outra edição.");
      const updated = { id: d.id || id(), name: str(d.name, 100), season: str(d.season, 40), sport: d.sport, category: str(d.category), status: d.status };
      need(!s.championships.some((c) => c.id !== updated.id && c.name.toLocaleLowerCase() === updated.name.toLocaleLowerCase() && c.season.toLocaleLowerCase() === updated.season.toLocaleLowerCase() && c.sport === updated.sport && c.category.toLocaleLowerCase() === updated.category.toLocaleLowerCase()), "Esta edição, modalidade e categoria já estão cadastradas.");
      if (previous) s.championships[s.championships.indexOf(previous)] = updated;
      else s.championships.push(updated);
    } else if (a.type === "team") {
      const d = a.data;
      need(str(d.name), "Informe o nome da equipe.");
      need(
        !s.teams.some(
          (t) =>
            t.id !== d.id && t.name.toLowerCase() === str(d.name).toLowerCase(),
        ),
        "Equipe já cadastrada.",
      );
      if (d.id)
        need(
          s.teams.some((t) => t.id === d.id),
          "Equipe não encontrada.",
        );
      const updated = {
        id: d.id || id(),
        name: str(d.name),
        short: str(d.short, 12),
        coach: str(d.coach),
        category: str(d.category),
        badge: url(d.badge),
      };
      if (d.id) s.teams[s.teams.findIndex((t) => t.id === d.id)] = updated;
      else s.teams.push(updated);
    } else if (a.type === "player") {
      const d = a.data;
      team(s, d.team);
      need(str(d.name), "Informe o nome do jogador.");
      need(
        !s.players.some(
          (p) =>
            p.id !== d.id &&
            p.team === d.team &&
            p.name.toLowerCase() === str(d.name).toLowerCase(),
        ),
        "Jogador já cadastrado nesta equipe.",
      );
      if (d.id)
        need(
          s.players.some((p) => p.id === d.id),
          "Jogador não encontrado.",
        );
      const updated = {
        id: d.id || id(),
        team: d.team,
        name: str(d.name),
        number: str(d.number, 8),
        position: str(d.position, 50),
        reserve: !!d.reserve,
      };
      if (d.id) s.players[s.players.findIndex((p) => p.id === d.id)] = updated;
      else s.players.push(updated);
    } else if (a.type === "match") {
      const d = a.data;
      team(s, d.home);
      team(s, d.away);
      need(d.home !== d.away, "Escolha equipes diferentes.");
      need(SPORTS.includes(d.sport), "Modalidade inválida.");
      need(
        d.date && !isNaN(Date.parse(d.date)),
        "Informe data e horário válidos.",
      );
      const championship = d.championshipId ? s.championships.find((c) => c.id === d.championshipId) : null;
      need(!d.championshipId || championship, "Campeonato não encontrado.");
      need(!championship || championship.status !== "Encerrado", "Este campeonato está encerrado. Reabra seu cadastro antes de programar novas partidas.");
      need(!championship || championship.sport === d.sport, "A modalidade da partida deve ser a mesma do campeonato.");
      s.matches.push({
        ...(championship ? { championshipId: championship.id } : {}),
        id: id(),
        home: d.home,
        away: d.away,
        sport: d.sport,
        date: str(d.date),
        place: str(d.place),
        competition: championship ? championship.name + " • " + championship.season : str(d.competition),
        referees: str(d.referees, 500),
        stage: str(d.stage) || "1",
        status: "Agendada",
        events: [],
        sets: [],
        notes: "",
        roster: s.players
          .filter((p) => [d.home, d.away].includes(p.team))
          .map((p) => ({ ...p })),
        coaches: [team(s, d.home).coach, team(s, d.away).coach],
      });
    } else if (a.type === "import") {
      need(["team", "player"].includes(a.kind), "Tipo de importação inválido.");
      need(
        Array.isArray(a.rows) && a.rows.length > 0 && a.rows.length <= 300,
        "Importe de 1 a 300 linhas por lote.",
      );
      let current = s;
      for (const row of a.rows) {
        let d = { ...row };
        if (a.kind === "player") {
          const t = current.teams.find(
            (t) => t.name.toLowerCase() === str(d.teamName).toLowerCase(),
          );
          need(t, "Equipe não encontrada: " + d.teamName);
          d.team = t.id;
        }
        current = reduce(current, { type: a.kind, data: d }, who, now);
      }
      return current;
    } else {
      const m = s.matches.find((m) => m.id === a.matchId);
      need(m, "Partida não encontrada.");
      if (a.type === "championshipLink") {
        need(str(a.reason, 500), "Informe a justificativa do vínculo.");
        const c = a.championshipId ? s.championships.find((c) => c.id === a.championshipId) : null;
        need(!a.championshipId || c, "Campeonato não encontrado.");
        need(!c || c.sport === m.sport, "Modalidades diferentes.");
        m.championshipId = c?.id || "";
        if (c) m.competition = c.name + " • " + c.season;
      } else if (a.type === "status") {
        const allowed = {
          Agendada: ["Ao vivo"],
          "Ao vivo": ["Pausada", "Encerrada"],
          Pausada: ["Ao vivo", "Encerrada"],
          Encerrada: ["Homologada", "Ao vivo"],
          Homologada: ["Ao vivo"],
        };
        need(allowed[m.status]?.includes(a.status), "Transição inválida.");
        if (
          ["Encerrada", "Homologada"].includes(m.status) &&
          a.status === "Ao vivo"
        )
          need(str(a.reason), "Informe o motivo da reabertura.");
        m.events.push({
          id: id(),
          type: "status",
          text: m.status + " → " + a.status,
          reason: str(a.reason),
          actor: who,
          at: now,
        });
        m.status = a.status;
      } else {
        need(
          !["Encerrada", "Homologada"].includes(m.status),
          "Partida encerrada. Reabra com justificativa.",
        );
        if (a.type === "event") {
          need(m.status === "Ao vivo", "Inicie ou retome a partida.");
          need(
            [
              "ponto",
              "cartão amarelo",
              "cartão vermelho",
              "falta",
              "substituição",
              "tempo",
              "observação",
            ].includes(a.kind),
            "Evento inválido.",
          );
          need([0, 1].includes(a.side), "Escolha a equipe.");
          if (a.kind === "ponto")
            need(
              Number.isInteger(a.value) &&
                (m.sport === "Basquete" ? [1, 2, 3] : [1]).includes(a.value),
              "Pontuação inválida para a modalidade.",
            );
          need(
            !a.player ||
              m.roster.some(
                (p) => p.id === a.player && p.team === [m.home, m.away][a.side],
              ),
            "Atleta não pertence à equipe da súmula.",
          );
          m.events.push({
            id: id(),
            type: a.kind,
            side: a.side,
            value: a.kind === "ponto" ? a.value : 0,
            player: str(a.player),
            stage: m.stage,
            text: str(a.text, 500),
            actor: who,
            at: now,
          });
        } else if (a.type === "stage") {
          need(str(a.stage), "Informe a etapa.");
          m.stage = str(a.stage, 40);
          m.events.push({
            id: id(),
            type: "etapa",
            text: m.stage,
            actor: who,
            at: now,
          });
        } else if (a.type === "set") {
          need(
            m.sport.startsWith("Vôlei"),
            "Parciais de set apenas para vôlei.",
          );
          need(m.status === "Ao vivo", "Inicie a partida.");
          const sc = score(m);
          need(sc[0] !== sc[1], "O set não pode terminar empatado.");
          m.sets.push({ score: sc, stage: m.stage });
          m.events.push({
            id: id(),
            type: "set",
            text: sc.join(" × "),
            stage: m.stage,
            actor: who,
            at: now,
          });
          m.events.push(
            {
              id: id(),
              type: "ponto",
              side: 0,
              value: -sc[0],
              stage: m.stage,
              actor: who,
              at: now,
            },
            {
              id: id(),
              type: "ponto",
              side: 1,
              value: -sc[1],
              stage: m.stage,
              actor: who,
              at: now,
            },
          );
          m.stage = String(m.sets.length + 1);
        } else if (a.type === "correct") {
          const original = m.events.find(
            (e) =>
              e.id === a.eventId &&
              e.type === "ponto" &&
              !e.correctionOf &&
              e.value > 0,
          );
          need(original, "Selecione um ponto original.");
          need(
            !m.events.some((e) => e.correctionOf === original.id),
            "Este lançamento já foi estornado.",
          );
          need(str(a.reason), "Informe a justificativa.");
          need(
            !m.events.some((e) => e.type === "set" && e.at >= original.at),
            "Ponto pertence a set já fechado. Registre a retificação na súmula.",
          );
          m.events.push({
            id: id(),
            type: "ponto",
            side: original.side,
            value: -original.value,
            stage: original.stage,
            correctionOf: original.id,
            text: str(a.reason, 500),
            actor: who,
            at: now,
          });
        } else if (a.type === "notes") {
          m.notes = str(a.notes, 5000);
          m.events.push({
            id: id(),
            type: "súmula",
            text: m.notes,
            actor: who,
            at: now,
          });
        } else throw Error("Ação desconhecida.");
      }
    }
    return s;
  }
  const api = { SPORTS, fresh, reduce, score };
  if (typeof module !== "undefined") module.exports = api;
  else root.Domain = api;
})(typeof window !== "undefined" ? window : globalThis);
