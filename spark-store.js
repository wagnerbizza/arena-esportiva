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
  // A mesma identidade está protegida nas regras do Firestore.
  const OWNER_UID = "mwYVHBGiEJSYfKimTiBUMzcWHhn1";
  const isOwner = () => session?.uid === OWNER_UID;
  const authorized = () => isOwner() || (profile?.role === "operator" && profile.enabled !== false && session?.emailVerified === true);
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
  authentication.languageCode = "pt-BR";
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
  let profileStop = () => {};
  let dataEpoch = 0;
  let state = D.fresh(),
    session = null,
    profile = null,
    stops = [],
    historyStop = null,
    historyId = "",
    cache = new Map(),
    generation = 0;
  const stop = () => {
    dataEpoch++;
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
    const epoch = dataEpoch;
    stops.push(
      F.onSnapshot(
        F.doc(database, path),
        { includeMetadataChanges: true },
        (snap) => {
          if (epoch !== dataEpoch) return;
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
  function watchCollection(name, assign, constraints = []) {
    const epoch = dataEpoch;
    stops.push(
      F.onSnapshot(
        constraints.length ? F.query(F.collection(database, name), ...constraints) : F.collection(database, name),
        (snap) => {
          if (epoch !== dataEpoch) return;
          assign(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
          publish();
        },
        message,
      ),
    );
  }
  function listen(full) {
    state = D.fresh();
    const ownerView = full && isOwner();
    watchDoc(ownerView ? "settings/main" : "publicSettings/main",
      (d) => (state.settings = d || D.fresh().settings));
    watchCollection(ownerView ? "teams" : "publicTeams", (d) => (state.teams = d));
    if (ownerView) {
      watchCollection("championships", (d) => (state.championships = d));
      watchCollection("players", (d) => (state.players = d));
      watchCollection("matches", (d) => (state.matches = d));
      watchCollection("users", (d) => (state.users = d));
      watchCollection("accessAudit", (d) => (state.accessAudit = d), [F.orderBy("at", "desc"), F.limit(50)]);
    } else if (!full) {
      watchCollection("publicMatches", (d) => (state.matches = d));
    } else {
      // Operador não consulta a coleção privada inteira: recebe cada partida autorizada.
      // Os jogadores disponíveis são os elencos congelados nessas partidas.
      const ids = [...new Set(profile?.matches || [])];
      for (const id of ids) {
        watchDoc("matches/" + id, (d) => {
          state.matches = state.matches.filter((m) => m.id !== id);
          if (d) state.matches.push(d);
          state.players = [...new Map(state.matches.flatMap((m) => m.roster || [])
            .map((p) => [p.id, p])).values()];
        });
      }
    }
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
    if (!isOwner()) throw Error("Histórico e auditoria são exclusivos do administrador principal.");
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
    if (!isOwner()) throw Error("Auditoria exclusiva do administrador principal.");
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
    if (!session || !authorized()) throw Error("Faça login com uma conta autorizada.");
    if (!isOwner() && (["team", "player", "settings", "match", "import", "correct", "championship", "championshipLink"].includes(action.type) ||
      !profile?.matches?.includes(action.matchId))) {
      throw Error("Sua conta não tem permissão para esta ação ou partida.");
    }
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
    if (["team", "player", "settings", "match", "championship"].includes(action.type)) {
      const checked = D.reduce(state, action, session.uid);
      entity = {
        championship: "championships",
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
        // Releitura na transação evita usar uma edição desatualizada do campeonato.
        const championshipId = prepared?.championshipId || (action.type === "championshipLink" ? action.championshipId : "");
        let championship = null;
        if (championshipId) {
          const snap = await tx.get(F.doc(database, "championships", championshipId));
          if (!snap.exists()) throw Error("Campeonato não encontrado.");
          championship = { ...snap.data(), id: snap.id };
          const sport = prepared?.sport || before?.sport;
          if (championship.sport !== sport) throw Error("Modalidades diferentes.");
          if (prepared && championship.status === "Encerrado") throw Error("O campeonato está encerrado para novas partidas.");
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
          if (entity === "matches" && championship) next.competition = championship.name + " • " + championship.season;
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
            { ...action, championship },
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
  // 7 — Cadastro e permissões: nenhuma senha é gravada no Firestore.
  const mainUID = OWNER_UID;
  async function requestAccess(name) {
    const u = authentication.currentUser;
    if (!u || u.uid === OWNER_UID) throw Error("Use uma conta de operador para solicitar acesso.");
    name = String(name || u.displayName || "").trim();
    if (!name || name.length > 100) throw Error("Informe seu nome, com até 100 caracteres.");
    const ref = F.doc(database, "users", u.uid);
    const aid = uid();
    await F.runTransaction(database, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists()) return;
      const after = { id: u.uid, name, email: u.email || "", role: "pending",
        enabled: false, matches: [], createdAt: F.serverTimestamp(),
        updatedAt: F.serverTimestamp(), revision: 1, auditId: aid };
      tx.set(ref, after);
      tx.set(F.doc(database, "accessAudit", aid), { actor: u.uid, target: u.uid,
        at: F.serverTimestamp(), action: "cadastro", reason: "Solicitação de acesso pelo próprio usuário",
        before: null, after });
    });
  }
  async function register({name, email, password}) {
    if (authentication.currentUser) throw Error("Saia da conta atual antes de criar outra conta.");
    name = String(name || "").trim();
    email = String(email || "").trim();
    if (!name || name.length > 100) throw Error("Informe seu nome, com até 100 caracteres.");
    if (String(password || "").length < 8) throw Error("Use uma senha com pelo menos 8 caracteres.");
    const {user: u} = await auth.createUserWithEmailAndPassword(authentication, email, password);
    // Se uma etapa falhar, o usuário pode entrar e concluir seu pedido sem criar outra conta.
    await auth.updateProfile(u, { displayName: name });
    await requestAccess(name);
    await auth.sendEmailVerification(u);
  }
  async function resendVerification() {
    const u = authentication.currentUser;
    if (!u) throw Error("Entre com seu e-mail e senha.");
    await auth.reload(u);
    if (u.emailVerified) return;
    await auth.sendEmailVerification(u);
  }
  async function refreshAccess() {
    const u = authentication.currentUser;
    if (!u) throw Error("Entre com seu e-mail e senha.");
    await auth.reload(u);
    await auth.getIdToken(u, true);
  }
  async function recoverPassword(email) {
    email = String(email || "").trim();
    if (!email) throw Error("Informe seu e-mail.");
    try { await auth.sendPasswordResetEmail(authentication, email); }
    catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  }
  async function manageUser({ userId, access, matches, reason }) {
    if (!isOwner()) throw Error("Somente o administrador principal gerencia usuários.");
    if (userId === OWNER_UID) throw Error("A conta principal está protegida e não pode ser alterada.");
    if (!["active", "blocked", "pending"].includes(access)) throw Error("Situação de acesso inválida.");
    reason = String(reason || "").trim();
    if (!reason || reason.length > 500) throw Error("Informe o motivo, com até 500 caracteres.");
    matches = access === "pending" ? [] : [...new Set(matches || [])];
    if (matches.length > 100 || matches.some((id) => !state.matches.some((m) => m.id === id)))
      throw Error("Selecione até 100 partidas existentes.");
    const ref = F.doc(database, "users", userId), aid = uid();
    await F.runTransaction(database, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw Error("Solicitação não encontrada.");
      const before = snap.data();
      const after = { id: userId, name: before.name || "Operador cadastrado", email: before.email || "",
        role: access === "pending" ? "pending" : "operator", enabled: access === "active", matches,
        createdAt: before.createdAt || F.serverTimestamp(), updatedAt: F.serverTimestamp(),
        revision: (before.revision || 0) + 1, auditId: aid };
      const action = access === "blocked" ? "bloqueio" : access === "pending" ? "pendente" :
        before.role !== "operator" || before.enabled === false ? "aprovação" : "permissões";
      tx.set(ref, after);
      tx.set(F.doc(database, "accessAudit", aid), { actor: session.uid, target: userId,
        at: F.serverTimestamp(), action, reason, before, after });
    });
  }
  if (!privateView) listen(false);
  else authStop = auth.onIdTokenChanged(authentication, (u) => {
    const current = ++generation;
    profileStop();
    profileStop = () => {};
    stop();
    session = u;
    profile = null;
    state = D.fresh();
    onSession(u, "", {status: "loading"});
    onData(state);
    if (!u) { onConnection("FIREBASE SPARK • pronto para entrar"); return; }
    if (u.uid === OWNER_UID) {
      // O titular não depende de um campo editável no documento users.
      onSession(u, "admin", {status: "owner"});
      listen(true);
      return;
    }
    profileStop = F.onSnapshot(F.doc(database, "users", u.uid), (snap) => {
      if (current !== generation) return;
      stop();
      state = D.fresh();
      profile = snap.exists() ? snap.data() : null;
      onConnection(snap.metadata.fromCache ? "FIREBASE SPARK • aguardando confirmação do servidor" : "FIREBASE SPARK • conectado");
      const ids = profile?.matches;
      const valid = u.emailVerified === true && profile?.role === "operator" && profile.enabled !== false &&
        (ids === undefined || (Array.isArray(ids) && ids.every((id) =>
          typeof id === "string" && id.length > 0 && !id.includes("/"))));
      const status = !profile ? "incomplete" : profile.role === "operator" && profile.enabled === false ? "blocked" :
        !u.emailVerified ? "verify" : profile.role === "pending" ? "pending" : valid ? "operator" : "unauthorized";
      onSession(u, valid ? "operator" : "", {status});
      onData(state);
      if (valid) listen(true);

    }, (e) => {
      if (current !== generation) return;
      stop();
      profile = null;
      state = D.fresh();
      onSession(u, "");
      onData(state);
      message(e);
    });
  });
  return {
    auth,
    authentication,
    database,
    F,
    send,
    mainUID,
    register,
    requestAccess,
    resendVerification,
    refreshAccess,
    recoverPassword,
    manageUser,
    loadHistory,
    stopHistory,
    auditRows,
    canOperate: (id) =>
      isOwner() || (authorized() && profile?.matches?.includes(id)),
    close: () => {
      stop();
      profileStop();
      authStop();
    },
  };
}
