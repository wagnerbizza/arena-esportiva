/* PASSO 3 — Regras locais do placar no modo Spark.
   A proteção real está em firestore.rules, que valida novamente cada transição.
   Cada partida tem seu próprio documento; o histórico fica separado em audit. */
(function (root) {
  "use strict";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const need = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
  const text = (v, n = 500) =>
    String(v ?? "")
      .trim()
      .slice(0, n);
  function detail(type) {
    return {
      type,
      side: -1,
      value: 0,
      player: "",
      stage: "",
      text: "",
      reason: "",
      correctionOf: "",
      from: "",
      to: "",
      setIndex: 0,
    };
  }
  function applyMatch(current, a, original = null) {
    const m = clone(current),
      e = detail("");
    delete m.events;
    e.stage = m.stage;
    e.setIndex = m.sets.length;
    const locked = ["Encerrada", "Homologada"].includes(m.status);
    if (a.type === "status") {
      const moves = {
        Agendada: ["Ao vivo"],
        "Ao vivo": ["Pausada", "Encerrada"],
        Pausada: ["Ao vivo", "Encerrada"],
        Encerrada: ["Homologada", "Ao vivo"],
        Homologada: ["Ao vivo"],
      };
      need(
        moves[m.status]?.includes(a.status),
        "Transição de situação inválida.",
      );
      if (locked && a.status === "Ao vivo")
        need(text(a.reason), "Informe o motivo da reabertura.");
      Object.assign(e, {
        type: "status",
        from: m.status,
        to: a.status,
        reason: text(a.reason),
        text: m.status + " → " + a.status,
      });
      m.status = a.status;
    } else {
      need(
        !locked,
        "Partida encerrada. Reabertura exige administrador e justificativa.",
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
          "Tipo inválido.",
        );
        need([0, 1].includes(a.side), "Equipe inválida.");
        const value = a.kind === "ponto" ? Number(a.value) : 0;
        need(
          a.kind !== "ponto" ||
            (Number.isInteger(value) &&
              (m.sport === "Basquete" ? [1, 2, 3] : [1]).includes(value)),
          "Pontuação inválida.",
        );
        need(
          !a.player || m.rosterTeams[a.player] === [m.home, m.away][a.side],
          "Atleta não pertence à equipe da súmula.",
        );
        Object.assign(e, {
          type: a.kind,
          side: a.side,
          value,
          player: text(a.player, 150),
          text: text(a.text),
        });
        if (a.kind === "ponto") m.score[a.side] += value;
      } else if (a.type === "correct") {
        need(
          original &&
            original.entity === "matches" &&
            original.target === m.id &&
            original.detail.type === "ponto" &&
            original.detail.value > 0 &&
            !original.detail.correctionOf,
          "Selecione um ponto original.",
        );
        need(
          original.detail.setIndex === m.sets.length,
          "Set já fechado. Registre a retificação na súmula.",
        );
        need(text(a.reason), "Justificativa obrigatória.");
        Object.assign(e, {
          type: "ponto",
          side: original.detail.side,
          value: -original.detail.value,
          player: original.detail.player,
          correctionOf: a.eventId,
          text: text(a.reason),
          reason: text(a.reason),
        });
        m.score[e.side] += e.value;
        need(m.score[e.side] >= 0, "Placar inválido.");
      } else if (a.type === "stage") {
        need(text(a.stage, 40), "Informe a etapa.");
        m.stage = text(a.stage, 40);
        Object.assign(e, { type: "etapa", text: m.stage, to: m.stage });
      } else if (a.type === "notes") {
        m.notes = text(a.notes, 5000);
        Object.assign(e, { type: "súmula", text: m.notes });
      } else if (a.type === "set") {
        need(
          m.status === "Ao vivo" && m.sport.startsWith("Vôlei"),
          "Fechamento de set indisponível.",
        );
        need(m.score[0] !== m.score[1], "O set não pode terminar empatado.");
        Object.assign(e, { type: "set", text: m.score.join(" × ") });
        m.sets.push({ score: [...m.score], stage: m.stage });
        m.score = [0, 0];
        m.stage = String(m.sets.length + 1);
        e.to = m.stage;
      } else throw Error("Ação desconhecida.");
    }
    return { match: m, detail: e };
  }
  function publicTeam(t) {
    const { id, name, short, badge, category, _revision, _updatedAt } = t;
    return { id, name, short, badge, category, _revision, _updatedAt };
  }
  function publicSettings(t) {
    const { id, title, subtitle, color, banner, _revision, _updatedAt } = t;
    return { id, title, subtitle, color, banner, _revision, _updatedAt };
  }
  function publicMatch(m) {
    const {
      id,
      home,
      away,
      sport,
      date,
      place,
      competition,
      stage,
      status,
      sets,
      score,
      _revision,
      _updatedAt,
    } = m;
    return {
      id,
      home,
      away,
      sport,
      date,
      place,
      competition,
      stage,
      status,
      sets,
      score,
      _revision,
      _updatedAt,
    };
  }
  const api = { detail, applyMatch, publicTeam, publicSettings, publicMatch };
  if (typeof module !== "undefined") module.exports = api;
  else root.SparkModel = api;
})(typeof window !== "undefined" ? window : globalThis);
