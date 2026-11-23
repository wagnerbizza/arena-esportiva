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
    if (a.type === "championshipLink") {
      need(text(a.reason), "Informe a justificativa do vínculo.");
      need(!a.championshipId || a.championship?.id === a.championshipId, "Campeonato não encontrado.");
      need(!a.championship || a.championship.sport === m.sport, "Modalidades diferentes.");
      e.type = "campeonato";
      e.from = m.championshipId || "";
      e.to = a.championshipId || "";
      e.reason = text(a.reason);
      m.championshipId = e.to;
      if (a.championship) m.competition = a.championship.name + " • " + a.championship.season;
      e.text = e.to ? "Vínculo ao campeonato: " + m.competition : "Vínculo removido; nome histórico da competição preservado";
    } else if (a.type === "status") {
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
        !locked || (a.administrative === true && ["correct","notes"].includes(a.type)),
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
          need(c.mode !== "down" || elapsed(m) < c.durationMs,
            "Tempo esgotado. Ajuste o relógio ou decida a próxima etapa antes de iniciar.");
          runClock(m, stamp);
          e.text = "Cronômetro iniciado";
        } else if (a.command === "parar") {
          need(c.running, "O cronômetro já está parado.");
          stopClock(m, stamp);
          e.text = "Cronômetro parado";
        } else if (a.command === "iniciar-acrescimos") {
          const added = m.addedTime;
          need(m.sport === "Futebol" && m.status === "Ao vivo" && added?.stage === m.stage &&
            Number.isInteger(added.minutes) && added.minutes > 0 && added.minutes <= 30,
            "Publique os acréscimos desta etapa primeiro.");
          need(!c.running && !c.segments.acrescimos && added.phase !== "started",
            "Os acréscimos já foram iniciados ou o relógio normal ainda está em andamento.");
          m.clock = {
            ...emptyClock(),
            mode: "down",
            durationMs: added.minutes * 60000,
            segments: { acrescimos: { start: stamp, end: null } },
            current: "acrescimos",
            running: true,
          };
          m.addedTime = {stage:m.stage,minutes:added.minutes,phase:"started"};
          e.text = "Cronômetro dos acréscimos iniciado";
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
          const leavingAdded=m.addedTime?.phase==="started" || Object.hasOwn(c.segments||{},"acrescimos") || (m.addedTime?.stage===m.stage && m.addedTime.minutes>0);
          if(leavingAdded)m.addedTime={stage:m.stage,minutes:0,phase:"announced"};
          e.value = a.baseMs;
          e.text = "Ajuste do cronômetro: " + clockText(m)+(leavingAdded?"; retorno ao tempo normal, acréscimos retirados":"");
        } else throw Error("Comando do cronômetro inválido.");
      } else if (a.type === "addedTime") {
        need(m.sport === "Futebol" && m.status === "Ao vivo", "Acréscimos disponíveis para futebol ao vivo.");
        need(Number.isInteger(a.minutes) && a.minutes >= 0 && a.minutes <= 30, "Informe de 0 a 30 minutos.");
        const started = m.addedTime?.stage === m.stage &&
          (m.addedTime.phase === "started" || Object.hasOwn(m.clock?.segments || {},"acrescimos"));
        need(!(started && a.minutes===0),"Para sair dos acréscimos iniciados, pare o relógio e salve o ajuste do tempo normal.");
        m.addedTime = {stage:m.stage,minutes:a.minutes,phase:started ? "started" : "announced"};
        Object.assign(e, {type:"acréscimos", value:a.minutes, text:"Acréscimos: +" + a.minutes + " min"});
      } else if (a.type === "notice") {
        m.publicNotice = text(a.notice, 300);
        e.type = "aviso";
        e.text = m.publicNotice;
      } else if(a.type === "matchRosterAdd") {
        const p = a.rosterPlayer;
        const teams = [m.home,m.away];
        const destination = a.targetTeam || p?.team;
        const guest = p && p.team !== destination;
        need(p && teams.includes(destination) && (!guest || !teams.includes(p.team)),
          "Jogador não pertence à equipe selecionada ou já pertence à outra equipe desta partida.");
        const reason = text(a.reason,500);
        need(reason, "Informe o motivo da inclusão no elenco.");
        need(!m.roster.some(row=>row.id===p.id) && !Object.hasOwn(m.rosterTeams,p.id),"Este jogador já está no elenco da partida.");
        need(m.roster.length<80,"O elenco da partida já atingiu a capacidade existente de 80 jogadores.");
        const player = {id:p.id,name:p.name,team:destination,number:p.number||"",position:p.position||"",
          reserve:p.reserve===null?null:p.reserve===true};
        if (guest) Object.assign(player,{originTeam:p.team,rosterNote:reason});
        m.roster.push(player);
        m.rosterTeams[p.id] = destination;
        Object.assign(e,{type:"elenco",side:destination===m.home?0:1,player:p.id,from:p.id,to:destination,
          reason,text:(guest?"Reforço de outra equipe: ":"Inclusão no elenco da partida: ")+p.name});
      } else if (a.type === "matchRosterNote") {
        const p = m.roster.find(player => player.id === a.playerId);
        const note = text(a.note,500);
        need(p && Object.hasOwn(m.rosterTeams,p.id),"Selecione um jogador do elenco desta partida.");
        need(note,"Digite a observação interna.");
        m.rosterNotes = {...m.rosterNotes,[p.id]:note};
        Object.assign(e,{type:"observação de elenco",side:p.team===m.home?0:1,player:p.id,
          reason:note,text:"Observação interna do elenco: "+p.name});
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
        if(a.kind === "substituição"){
          const incoming=text(a.playerIn,100);
          need(a.player && incoming && incoming!==a.player && m.rosterTeams[incoming]===[m.home,m.away][a.side],"Selecione quem sai e quem entra, da mesma equipe.");
          e.from=a.player;e.to=incoming;
          const label=id=>{const p=m.roster.find(p=>p.id===id);return (p.number? p.number+" • ":"")+p.name;};
          e.text="Sai: "+label(e.from)+"; entra: "+label(e.to)+(a.goalkeeper?" (troca de goleiro)":"")+(e.text?" — "+e.text:"");
        }
        if (a.kind === "ponto") m.score[a.side] += value;
      } else if (a.type === "correct") {
        const goal=original?.detail;
        need(original && original.entity === "matches" && original.target === m.id && goal &&
          ["ponto","cartão amarelo","cartão vermelho","falta","substituição","tempo"].includes(goal.type) &&
          !goal.correctionOf && (goal.type !== "ponto" || goal.value > 0), "Selecione um lance original anulável.");
        need(text(a.reason), "Justificativa obrigatória.");
        Object.assign(e,{type:goal.type,side:goal.side,value:goal.type==="ponto"?-goal.value:0,
          player:goal.player,correctionOf:a.eventId,from:goal.from||"",to:goal.to||"",
          text:text(a.reason),reason:text(a.reason,300)});
        if(goal.type==="ponto"){
          if(goal.setIndex === m.sets.length){m.score[e.side]+=e.value;need(m.score[e.side]>=0,"Placar inválido.");}
          else{
            need(a.administrative === true,"Somente o administrador pode retificar um set já fechado.");
            const set=m.sets[goal.setIndex];need(set && goal.setIndex>=0,"Set original não encontrado.");
            set.score[e.side]+=e.value;need(set.score[e.side]>=0,"Placar do set inválido.");
          }
        }
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
    appendPublicEvent(m, e, a.publicId || String(Number(current._revision || 0) + 1));
    return { match: m, detail: e };
  }
  function appendPublicEvent(m, e, id) {
    if (
      ![
        "ponto",
        "cartão amarelo",
        "cartão vermelho",
        "falta",
        "substituição",
        "tempo",
      ].includes(e.type)
    )
      return;
    const athlete = (m.roster || []).find((p) => p.id === e.player);
    const event = {
      id,
      type: e.type,
      side: e.side,
      value: e.value,
      player: e.player,
      playerName: athlete?.name || "",
      number: String(athlete?.number || ""),
      correctionOf: e.correctionOf || "",
    };
    m.publicEvents = [...(m.publicEvents || []), event].slice(-5);
  }
  function publicTeam(t) {
    const { id, name, short, badge, category, _revision, _updatedAt } = t;
    return { id, name, short, badge, category, _revision, _updatedAt };
  }
  function publicSettings(t) {
    const { id, title, subtitle, color, banner, _revision, _updatedAt } = t;
    return { ...(Object.hasOwn(t, "logo") ? { logo: t.logo } : {}), ...(Object.hasOwn(t, "summaryLimit") ? {summaryLimit:t.summaryLimit} : {}), ...(Object.hasOwn(t, "historyPageSize") ? {historyPageSize:t.historyPageSize} : {}), id, title, subtitle, color, banner, _revision, _updatedAt };
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
      ...(Object.hasOwn(m, "championshipId") ? { championshipId: m.championshipId } : {}),
      clock: m.clock || emptyClock(),
      publicNotice: m.publicNotice || "",
      ...(Object.hasOwn(m,"addedTime") ? {addedTime:m.addedTime} : {}),
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
      publicEvents: m.publicEvents || [],
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
