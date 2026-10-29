/* PASSO 3 — Regras locais do placar no modo Spark.
   A proteção real está em firestore.rules, que valida novamente cada transição.
   Cada partida tem seu próprio documento; o histórico fica separado em audit. */
(function (root) {
  "use strict";
  // Preserva Timestamp do Firestore; JSON.stringify destruiria seu tipo.
  const clone = (v) =>
    Array.isArray(v)
      ? v.map(clone)
      : v && typeof v.toMillis === "function"
        ? v
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
          : v;
  function millis(v) {
    if (v == null) return null;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v === "number") return v;
    if (typeof v === "string") return Date.parse(v);
    if (typeof v.seconds === "number")
      return v.seconds * 1000 + (v.nanoseconds || 0) / 1e6;
    return null;
  }
  function emptyClock() {
    return {
      baseMs: 0,
      mode: "up",
      durationMs: 0,
      segments: {},
      current: "",
      running: false,
    };
  }
  function elapsed(m, now = Date.now()) {
    const c = m.clock || emptyClock();
    let value = c.baseMs;
    for (const segment of Object.values(c.segments)) {
      const start = millis(segment.start),
        end = millis(segment.end);
      if (start != null && Number.isFinite(start))
        value += Math.max(0, (end != null ? end : now) - start);
    }
    return Math.max(0, value);
  }
  function clockText(m, now = Date.now()) {
    const c = m.clock || emptyClock(),
      raw = elapsed(m, now),
      value = c.mode === "down" ? Math.max(0, c.durationMs - raw) : raw,
      total = Math.floor(value / 1000),
      hours = Math.floor(total / 3600),
      mins = Math.floor(total / 60) % 60,
      secs = total % 60;
    return (
      (hours ? String(hours).padStart(2, "0") + ":" : "") +
      String(mins).padStart(2, "0") +
      ":" +
      String(secs).padStart(2, "0")
    );
  }
  function runClock(m, stamp) {
    let c = clone(m.clock || emptyClock());
    if (c.running) return;
    m.clock = c;
    need(
      Object.keys(c.segments).length < 120,
      "Limite de pausas do cronômetro atingido. Ajuste o tempo com justificativa.",
    );
    const key = "s" + (Object.keys(c.segments).length + 1);
    c.segments[key] = { start: stamp, end: null };
    c.current = key;
    c.running = true;
  }
  function stopClock(m, stamp) {
    let c = clone(m.clock || emptyClock());
    m.clock = c;
    if (!c.running) return;
    c.segments[c.current] = { ...c.segments[c.current], end: stamp };
    c.current = "";
    c.running = false;
  }
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
  function applyMatch(
    current,
    a,
    original = null,
    stamp = new Date().toISOString(),
  ) {
    const m = clone(current),
      e = detail("");
    delete m.events;
    e.stage = m.stage;
    e.setIndex = m.sets.length;
    const locked = ["Encerrada", "Homologada", "Cancelada"].includes(m.status);
    if (a.type === "status") {
      const moves = {
        Agendada: ["Ao vivo", "Adiada", "Cancelada"],
        Adiada: ["Agendada", "Ao vivo", "Cancelada"],
        Cancelada: ["Agendada"],
        "Ao vivo": ["Pausada", "Suspensa", "Encerrada"],
        Pausada: ["Ao vivo", "Suspensa", "Encerrada"],
        Suspensa: ["Ao vivo", "Encerrada", "Cancelada"],
        Encerrada: ["Homologada", "Ao vivo"],
        Homologada: ["Ao vivo"],
      };
      need(
        moves[m.status]?.includes(a.status),
        "Transição de situação inválida.",
      );
      if (
        (locked && a.status !== "Homologada") ||
        ["Pausada", "Suspensa", "Adiada", "Cancelada"].includes(a.status)
      )
        need(text(a.reason), "Informe o motivo da reabertura.");
      Object.assign(e, {
        type: "status",
        from: m.status,
        to: a.status,
        reason: text(a.reason, 300),
        text: m.status + " → " + a.status,
      });
      if (a.status === "Ao vivo" && !locked) runClock(m, stamp);
      else stopClock(m, stamp);
      m.status = a.status;
      m.publicNotice = ["Pausada", "Suspensa", "Adiada", "Cancelada"].includes(
        a.status,
      )
        ? text(a.reason, 300)
        : "";
    } else {
      need(
        !locked,
        "Partida encerrada. Reabertura exige administrador e justificativa.",
      );
      if (a.type === "clock") {
        const c = m.clock || emptyClock();
        e.type = "cronômetro";
        e.reason = text(a.reason);
        e.from = a.command;
        if (a.command === "iniciar") {
          need(
            m.status === "Ao vivo" && !c.running,
            "O cronômetro só pode iniciar em partida ao vivo.",
          );
          runClock(m, stamp);
          e.text = "Cronômetro iniciado";
        } else if (a.command === "parar") {
          need(c.running, "O cronômetro já está parado.");
          stopClock(m, stamp);
          e.text = "Cronômetro parado";
        } else if (a.command === "ajustar") {
          need(!c.running, "Pare o cronômetro antes de ajustar.");
          need(text(a.reason), "Informe a justificativa do ajuste.");
          need(["up", "down"].includes(a.mode), "Modo inválido.");
          need(
            Number.isInteger(a.baseMs) && a.baseMs >= 0 && a.baseMs <= 21600000,
            "Tempo decorrido inválido.",
          );
          need(
            Number.isInteger(a.durationMs) &&
              a.durationMs >= 0 &&
              a.durationMs <= 21600000 &&
              (a.mode !== "down" || a.durationMs > 0),
            "Duração inválida.",
          );
          m.clock = {
            ...emptyClock(),
            baseMs: a.baseMs,
            mode: a.mode,
            durationMs: a.durationMs,
          };
          e.value = a.baseMs;
          e.text = "Ajuste do cronômetro: " + clockText(m);
        } else throw Error("Comando do cronômetro inválido.");
      } else if (a.type === "notice") {
        m.publicNotice = text(a.notice, 300);
        e.type = "aviso";
        e.text = m.publicNotice;
      } else if (a.type === "event") {
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
          reason: text(a.reason, 300),
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
      clock: m.clock || emptyClock(),
      publicNotice: m.publicNotice || "",
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
  const api = {
    detail,
    applyMatch,
    publicTeam,
    publicSettings,
    publicMatch,
    emptyClock,
    millis,
    elapsed,
    clockText,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.SparkModel = api;
})(typeof window !== "undefined" ? window : globalThis);
