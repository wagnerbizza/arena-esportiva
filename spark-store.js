/* PASSO 2 — Conexão Firebase gratuita: Authentication + Cloud Firestore.
   Nenhuma função de servidor, Storage ou conta de faturamento é utilizada.
   NÃO altere as permissões para "allow write: if true"; publique firestore.rules. */
export async function connectSpark({
  config,
  privateView,
  onData,
  onSession,
  onError,
  onConnection,
}) {
  const version = "11.0.2";
  const [fb, auth, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(
      `https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`
    ),
  ]);
  const app = fb.initializeApp(config.firebase),
    database = F.getFirestore(app),
    authentication = auth.getAuth(app),
    M = window.SparkModel,
    D = window.Domain;
  const emulator = config.emulators;
  if (emulator?.enabled) {
    F.connectFirestoreEmulator(
      database,
      emulator.host || "127.0.0.1",
      emulator.firestorePort || 8080,
    );
    auth.connectAuthEmulator(
      authentication,
      `http://${emulator.host || "127.0.0.1"}:${emulator.authPort || 9099}`,
      { disableWarnings: true },
    );
  }
  let authStop = () => {};
  let state = D.fresh(),
    session = null,
    profile = null,
    stops = [],
    historyStop = null,
    historyId = "",
    cache = new Map(),
    generation = 0;
  const stop = () => {
    stops.forEach((f) => f());
    stops = [];
    historyStop?.();
    historyStop = null;
    historyId = "";
    cache.clear();
  };
  const message = (e) => {
    onConnection(
      e.code === "resource-exhausted"
        ? "COTA GRATUITA ATINGIDA • aguarde a renovação ou confira Uso no Firestore."
        : "FIREBASE • conexão ou permissão indisponível.",
    );
    onError(e);
  };
  function publish() {
    for (const m of state.matches) m.events = cache.get(m.id) || [];
    onData(state);
  }
  function watchDoc(path, assign) {
    stops.push(
      F.onSnapshot(
        F.doc(database, path),
        { includeMetadataChanges: true },
        (snap) => {
          assign(snap.exists() ? snap.data() : null);
          onConnection(
            snap.metadata.fromCache
              ? "FIREBASE SPARK • cache local; aguardando conexão com servidor."
              : "FIREBASE SPARK • conectado",
          );
          publish();
        },
        message,
      ),
    );
  }
  function watchCollection(name, assign) {
    stops.push(
      F.onSnapshot(
        F.collection(database, name),
        (snap) => {
          assign(snap.docs.map((d) => d.data()));
          publish();
        },
        message,
      ),
    );
  }
  function listen(full) {
    state = D.fresh();
    watchDoc(
      full ? "settings/main" : "publicSettings/main",
      (d) => (state.settings = d || D.fresh().settings),
    );
    watchCollection(full ? "teams" : "publicTeams", (d) => (state.teams = d));
    if (full) watchCollection("players", (d) => (state.players = d));
    watchCollection(
      full ? "matches" : "publicMatches",
      (d) => (state.matches = d),
    );
  }
  const events = (snap) =>
    snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.revision - b.revision)
      .map((a) => ({
        ...a.detail,
        id: a.id,
        actor: a.actor,
        at: a.at?.toDate?.().toISOString() || "",
        revision: a.revision,
        gameMs: a.after?.clock
          ? M.elapsed(a.after, a.at?.toMillis?.() || Date.now())
          : null,
      }));
  async function loadHistory(ids, { live = false } = {}) {
    if (!session || !profile)
      throw Error("Faça login para consultar o histórico.");
    historyStop?.();
    historyStop = null;
    historyId = "";
    for (const id of ids) {
      const q = F.query(
        F.collection(database, "audit"),
        F.where("target", "==", id),
      );
      const snap = await F.getDocsFromServer(q);
      cache.set(id, events(snap));
    }
    publish();
    if (live && ids.length === 1) {
      historyId = ids[0];
      const id = historyId,
        q = F.query(
          F.collection(database, "audit"),
          F.where("target", "==", id),
        );
      historyStop = F.onSnapshot(
        q,
        (snap) => {
          cache.set(id, events(snap));
          publish();
        },
        message,
      );
    }
  }
  function stopHistory() {
    historyStop?.();
    historyStop = null;
    historyId = "";
  }
  async function auditRows() {
    const snap = await F.getDocsFromServer(F.collection(database, "audit"));
    return snap.docs
      .map((d) => ({ ID: d.id, ...d.data() }))
      .sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0));
  }
  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : F.doc(F.collection(database, "audit")).id;
  async function send(action) {
    if (!session || !profile) throw Error("Faça login.");
    if (!navigator.onLine)
      throw Error("Sem conexão. Aguarde antes de lançar novamente.");
    if (action.type === "import") {
      // Cada linha tem transação e auditoria próprias; evita estourar o limite de regras por lote.
      let count = 0;
      for (const row of action.rows) {
        try {
          const data = { ...row };
          if (action.kind === "player") {
            const t = state.teams.find(
              (t) => t.name.toLowerCase() === data.teamName.toLowerCase(),
            );
            if (!t) throw Error("Equipe não encontrada: " + data.teamName);
            data.team = t.id;
          }
          await send({
            type: action.kind,
            data,
            importLabel: action.importLabel || "Importação manual",
          });
          count++;
        } catch (e) {
          throw Error(
            `Importação interrompida: ${count} de ${action.rows.length} linhas gravadas. ${e.message} Prepare outra prévia; os cadastros já salvos serão reconhecidos.`,
          );
        }
      }
      return;
    }
    let entity,
      target,
      prepared = null;
    if (["team", "player", "settings", "match"].includes(action.type)) {
      const checked = D.reduce(state, action, session.uid);
      entity = {
        team: "teams",
        player: "players",
        settings: "settings",
        match: "matches",
      }[action.type];
      if (entity === "settings") {
        target = "main";
        prepared = { id: target, ...checked.settings };
      } else {
        const list = checked[entity];
        prepared = action.data.id
          ? list.find((x) => x.id === action.data.id)
          : list[list.length - 1];
        target = prepared.id;
      }
      if (entity === "matches") {
        prepared.score = [0, 0];
        prepared.clock = M.emptyClock();
        prepared.publicNotice = "";
        prepared.rosterTeams = Object.fromEntries(
          prepared.roster.map((p) => [p.id, p.team]),
        );
        delete prepared.events;
      }
    } else {
      entity = "matches";
      target = action.matchId;
    }
    const actionId = uid(),
      reference = F.doc(database, entity, target),
      auditRef = F.doc(database, "audit", actionId),
      originalRef =
        action.type === "correct"
          ? F.doc(database, "audit", action.eventId)
          : null,
      correctionRef =
        action.type === "correct"
          ? F.doc(database, "corrections", action.eventId)
          : null;
    // O mesmo ID é reutilizado nas tentativas internas da transação; nunca some pontos fora da transação.
    let attemptedRevision = -1;
    const commit = () =>
      F.runTransaction(database, async (tx) => {
        const beforeSnap = await tx.get(reference);
        const before = beforeSnap.exists() ? beforeSnap.data() : null;
        attemptedRevision = before?._revision || 0;
        let original = null;
        if (originalRef) {
          const o = await tx.get(originalRef),
            c = await tx.get(correctionRef);
          if (c.exists()) throw Error("Este ponto já foi estornado.");
          original = o.data();
        }
        let next, detail;
        if (prepared) {
          if (action.type === "match" && before)
            throw Error("Partida já existe.");
          if (action.type !== "settings" && action.data.id && !before)
            throw Error("Cadastro não encontrado.");
          if (!action.data.id && action.type !== "settings" && before)
            throw Error("Cadastro já existe.");
          next = { ...prepared };
          for (const k of Object.keys(next))
            if (k.startsWith("_")) delete next[k];
          detail = M.detail(before ? "edição" : "cadastro");
          detail.text = String(action.importLabel || "Cadastro manual").slice(
            0,
            500,
          );
        } else {
          if (!before) throw Error("Partida não encontrada.");
          const result = M.applyMatch(
            before,
            action,
            original,
            F.serverTimestamp(),
          );
          next = result.match;
          detail = result.detail;
        }
        next._revision = (before?._revision || 0) + 1;
        next._audit = actionId;
        next._updatedBy = session.uid;
        next._updatedAt = F.serverTimestamp();
        // Uma partida não carrega o histórico inteiro. A súmula consulta audit sob demanda.
        if (JSON.stringify(next).length > 200000)
          throw Error("Cadastro muito grande para esta edição.");
        tx.set(reference, next);
        if (entity === "teams")
          tx.set(F.doc(database, "publicTeams", target), M.publicTeam(next));
        if (entity === "settings")
          tx.set(
            F.doc(database, "publicSettings", target),
            M.publicSettings(next),
          );
        if (entity === "matches")
          tx.set(F.doc(database, "publicMatches", target), M.publicMatch(next));
        tx.set(auditRef, {
          entity,
          target,
          actor: session.uid,
          at: F.serverTimestamp(),
          revision: next._revision,
          detail,
          before,
          after: next,
        });
        if (correctionRef)
          tx.set(correctionRef, {
            matchId: target,
            eventId: action.eventId,
            actionId,
            actor: session.uid,
            at: F.serverTimestamp(),
          });
      });
    // Uma regra pode rejeitar uma revisão antiga durante uma disputa entre dispositivos.
    // Só repetimos se o servidor confirmar que outra revisão foi gravada entretanto.
    for (let attempt = 0; ; attempt++) {
      try {
        await commit();
        break;
      } catch (error) {
        if (
          error.code !== "permission-denied" ||
          attempt >= 2 ||
          entity !== "matches" ||
          prepared
        )
          throw error;
        const latest = await F.getDocFromServer(reference);
        if (!latest.exists() || latest.data()._revision <= attemptedRevision)
          throw error;
      }
    }
  }
  if (!privateView) listen(false);
  else
    authStop = auth.onAuthStateChanged(authentication, async (u) => {
      const current = ++generation;
      stop();
      session = u;
      profile = null;
      state = D.fresh();
      onSession(u, "");
      onData(state);
      if (!u) return;
      try {
        const snap = await F.getDocFromServer(F.doc(database, "users", u.uid));
        if (current !== generation) return;
        profile = snap.data();
        if (!["admin", "operator"].includes(profile?.role))
          throw Error(
            "Conta sem autorização. Cadastre o perfil users/UID no console Firebase.",
          );
        onSession(u, profile.role);
        listen(true);
      } catch (e) {
        if (current === generation) {
          profile = null;
          message(e);
        }
      }
    });
  return {
    auth,
    authentication,
    database,
    F,
    send,
    loadHistory,
    stopHistory,
    auditRows,
    canOperate: (id) =>
      profile?.role === "admin" || profile?.matches?.includes(id),
    close: () => {
      stop();
      authStop();
    },
  };
}
