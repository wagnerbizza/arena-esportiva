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
  const administratorUIDs = new Set([OWNER_UID, "WLMZmXFVXFS8lJUG1KSN2sfEtq13"]);
  const isOwner = () => administratorUIDs.has(session?.uid);
  const authorized = () => isOwner() || (profile?.role === "operator" && profile.enabled !== false && session?.emailVerified === true);
  // Permissão parcial de cadastro: não dá acesso à administração.
  function canOperateMatch(id) {
    if (isOwner()) return true;
    if (!authorized()) return false;
    const match = state.matches.find(item => item.id === id);
    if (!match || match.testData) return false;
    if ((profile?.matches || []).includes(id)) return true;
    return Boolean(match?.championshipId &&
      (profile?.operatedChampionships || []).includes(match.championshipId));
  }
  const canEditMatchPhases = championshipId => isOwner() || (authorized() &&
    (profile?.permissions || []).includes("editMatchPhases") &&
    (profile?.operatedChampionships || []).includes(championshipId));
  const canCorrectMatch = id => canOperateMatch(id) && (isOwner() || (profile?.permissions || []).includes("historyCorrections"));
  const canManageRosters = () => isOwner() || (authorized() && Array.isArray(profile?.permissions) && profile.permissions.includes("rosters"));
  const canCreateMatches = () => isOwner() || (authorized() && Array.isArray(profile?.permissions) && profile.permissions.includes("matchesCreate"));
  const canManageChampionships = () => isOwner() || (authorized() && Array.isArray(profile?.permissions) && profile.permissions.includes("championships"));
  const canViewAllGames = () => isOwner() || (authorized() && Array.isArray(profile?.permissions) && profile.permissions.includes("gamesView"));
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
  let publicBranding = null;
  let brandingStop = () => {};
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
        error => {
          if(epoch !== dataEpoch)return;
          if((path.startsWith("matches/") || path.startsWith("championships/")) && !isOwner() && error.code === "permission-denied") {
            assign(null); publish(); return;
          }
          message(error);
        },
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
        error => {if(epoch === dataEpoch)message(error);},
      ),
    );
  }
  function listen(full) {
    state = D.fresh();
    if (full && isOwner()) {
      // A coleção de fases é independente das partidas e do status da conexão.
      const phaseEpoch=dataEpoch;
      stops.push(F.onSnapshot(F.collection(database,"arenaMatchPhases"), snapshot=>{
        if(phaseEpoch!==dataEpoch)return;
        state.matchPhases=snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));
        publish();
      },()=>{}));
    }
    if (publicBranding) state.settings = publicBranding;
    const ownerView = full && isOwner();
    watchDoc("publicBranding/partners", data => { state.partners = data; });
    watchDoc(ownerView ? "settings/main" : "publicSettings/main",
      (d) => (state.settings = d || D.fresh().settings));
    watchCollection(ownerView || (full && canManageRosters()) ? "teams" : "publicTeams", (d) => (state.teams = d), !ownerView && full && canManageRosters() ? [F.where("testData","==",false)] : []);
    if (ownerView) {
      watchCollection("championships", (d) => (state.championships = d));
      watchCollection("players", (d) => (state.players = d));
      watchCollection("matches", (d) => (state.matches = d));
      watchCollection("users", (d) => (state.users = d));
      watchCollection("accountMethods", (d) => (state.accountMethods = d));
      watchCollection("accessAudit", (d) => (state.accessAudit = d), [F.orderBy("at", "desc"), F.limit(50)]);
    } else if (!full) {
      watchCollection("publicMatches", (d) => (state.matches = d));
    } else {
      // Operador não consulta a coleção privada inteira: recebe cada partida autorizada.
      // A lista pública é somente leitura; os documentos privados autorizados preservam os detalhes operacionais.
      const publicGames = new Map(), assignedGames = new Map(), championshipGames = new Map();
      const listedChampionships = new Map(), assignedChampionships = new Map(), championshipWatches = new Set();
      const publishChampionships = () => {
        const rows = new Map(listedChampionships);
        for(const [id,row] of assignedChampionships)rows.set(id,row);
        state.championships=[...rows.values()].filter(row=>row.testData!==true);
      };
      const watchAssignedChampionship = id => {
        if(typeof id!=="string" || !id || id.includes("/") || championshipWatches.has(id))return;
        if(!canManageChampionships() && !(profile?.operatedChampionships || []).includes(id))return;
        championshipWatches.add(id);
        // Leitura pontual também contempla cadastros antigos sem o campo testData.
        watchDoc("championships/"+id,row=>{
          if(row && row.testData!==true)assignedChampionships.set(id,row);
          else assignedChampionships.delete(id);
          publishChampionships();
        });
      };
      const publishOperatorGames = () => {
        const visibleGames = new Map(publicGames);
        for (const games of championshipGames.values())
          for (const game of games) visibleGames.set(game.id,game);
        for (const [id, game] of assignedGames) visibleGames.set(id, game);
        state.matches = [...visibleGames.values()];
        for(const game of state.matches)if(game.testData!==true)watchAssignedChampionship(game.championshipId);
        if (!canManageRosters()) state.players = [...new Map(
          [...championshipGames.values()].flat().concat([...assignedGames.values()])
            .flatMap(m => m.roster || []).filter(p => p && typeof p === "object")
            .map(p => [p.id,p])).values()];
      };
      // Os jogadores disponíveis são os elencos congelados nessas partidas.
      if(canManageRosters())watchCollection("players",d=>state.players=d,[F.where("testData","==",false)]);
      if(canManageChampionships())watchCollection("championships",rows=>{listedChampionships.clear();for(const row of rows)listedChampionships.set(row.id,row);publishChampionships();},[F.where("testData","==",false)]);
      for(const id of profile?.operatedChampionships || [])watchAssignedChampionship(id);
      if(canViewAllGames())watchCollection("publicMatches",d=>{publicGames.clear();for(const game of d)publicGames.set(game.id,game);publishOperatorGames();});
      else {
        for (const edition of profile?.followedEditions || []) {
          const previous = new Set();
          watchCollection("publicMatches", (games) => {
            for (const id of previous) publicGames.delete(id);
            previous.clear();
            for (const game of games) {
              if (!game.championshipId) continue;
              previous.add(game.id);
              publicGames.set(game.id, game);
            }
            publishOperatorGames();
          }, [F.where("competition", "==", edition)]);
        }
      }
      for (const championshipId of [...new Set(profile?.operatedChampionships || [])]) {
        if(canEditMatchPhases(championshipId)){
          const phaseEpoch=dataEpoch;
          const query=F.query(F.collection(database,"arenaMatchPhases"),F.where("championshipId","==",championshipId));
          stops.push(F.onSnapshot(query,snapshot=>{
            if(phaseEpoch!==dataEpoch)return;
            const others=(state.matchPhases||[]).filter(item=>item.championshipId!==championshipId);
            state.matchPhases=[...others,...snapshot.docs.map(doc=>({...doc.data(),id:doc.id}))];
            publish();
          },()=>{}));
        }
        watchCollection("matches", games => {
          championshipGames.set(championshipId,games);
          publishOperatorGames();
        }, [F.where("championshipId","==",championshipId),F.where("testData","==",false)]);
      }
      const ids = [...new Set(profile?.matches || [])];
      for (const id of ids) {
        watchDoc("matches/" + id, (d) => {
          if(d)assignedGames.set(id,d);else assignedGames.delete(id);
          publishOperatorGames();

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
        actorName: a.actorName || "",
        actorRole: a.actorRole || "",
        at: a.at?.toDate?.().toISOString() || "",
        revision: a.revision,
        gameMs: a.after?.clock
          ? M.elapsed(a.after, a.at?.toMillis?.() || Date.now())
          : null,
      }));
  const timelineTypes = new Set(["ponto","cartão amarelo","cartão vermelho","falta","substituição","tempo","status","etapa","set","acréscimos","cronômetro"]);
  function timelineEntry(id, audit) {
    if (audit.entity !== "matches" || !timelineTypes.has(audit.detail?.type)) return null;
    const e = audit.detail;
    const recent = audit.after.publicEvents || [];
    const last = recent.at(-1);
    const athlete = last?.id === id ? last : null;
    return {id, type:e.type, side:e.side, value:e.value, stage:e.stage,
      from:e.from, to:e.to, correctionOf:e.correctionOf,
      playerName:athlete?.playerName || "", number:athlete?.number || "",
      at:audit.at, revision:audit.revision};
  }
  function operationEvent(id, audit) {
    if(audit.entity!=="matches" || !timelineTypes.has(audit.detail?.type))return null;
    const e=audit.detail,reason=e.correctionOf?e.reason:"";
    return {id,entity:"matches",target:audit.target,revision:audit.revision,at:audit.at,
      detail:{type:e.type,side:e.side,value:e.value,player:e.player,stage:e.stage,setIndex:e.setIndex,
        correctionOf:e.correctionOf,from:e.from,to:e.to,text:reason,reason}};
  }
  function operationalHistory(matchId) {
    return privateView && !isOwner() && authorized() && canOperateMatch(matchId);
  }
  function timelineRows(snap,matchId) {
    const match=state.matches.find(m=>m.id===matchId);
    return snap.docs.map(doc=>{
      const row=doc.data();
      if(!row.detail)return row;
      const athlete=(match?.roster||[]).find(p=>p.id===row.detail.player);
      return {...row.detail,id:row.id,revision:row.revision,at:row.at,operational:true,
        playerName:athlete?.name||"",number:String(athlete?.number||"")};
    });
  }
  function historyPageSize() {
    const size = state.settings.historyPageSize ?? 20;
    return Number.isInteger(size) && size >= 1 && size <= 50 ? size : 20;
  }
  function timelineQuery(matchId, cursor = null) {
    return F.query(operationalHistory(matchId) ? F.collection(database,"matches",matchId,"operationEvents") : F.collection(database, "publicMatches", matchId, "timeline"),
      F.orderBy("revision","desc"), ...(cursor ? [F.startAfter(cursor)] : []), F.limit(historyPageSize()));
  }
  async function loadTimeline(matchId, cursor = null) {
    const snap = await F.getDocsFromServer(timelineQuery(matchId,cursor));
    return { rows:timelineRows(snap,matchId), cursor:snap.docs.at(-1) || null, more:snap.size === historyPageSize() };
  }
  function watchTimeline(matchId, update, error) {
    return F.onSnapshot(timelineQuery(matchId), snap => update({
      rows:timelineRows(snap,matchId), cursor:snap.docs.at(-1) || null, more:snap.size === historyPageSize(),
    }), error);
  }
  async function publishTimeline(matchId) {
    if (!isOwner()) throw Error("Somente o administrador publica os lances antigos.");
    const snap = await F.getDocsFromServer(F.query(F.collection(database,"audit"),F.where("target","==",matchId)));
    const existing = await F.getDocsFromServer(F.collection(database,"publicMatches",matchId,"timeline"));
    const known = new Set(existing.docs.map(doc => doc.id));
    // O histórico operacional é uma projeção separada da auditoria privada.
    const operationSnap=await F.getDocsFromServer(F.collection(database,"matches",matchId,"operationEvents"));
    const operationKnown=new Set(operationSnap.docs.map(doc=>doc.id));
    const operations=snap.docs.filter(doc=>!operationKnown.has(doc.id))
      .map(doc=>operationEvent(doc.id,doc.data())).filter(Boolean);
    for(let offset=0;offset<operations.length;offset+=5){
      const batch=F.writeBatch(database);
      for(const entry of operations.slice(offset,offset+5))batch.set(F.doc(database,"matches",matchId,"operationEvents",entry.id),entry);
      await batch.commit();
    }
    const entries = snap.docs.filter(doc => !known.has(doc.id))
      .map(doc => timelineEntry(doc.id,doc.data())).filter(Boolean);
    for (let offset=0; offset<entries.length; offset+=5) {
      const batch = F.writeBatch(database);
      for (const entry of entries.slice(offset,offset+5))
        batch.set(F.doc(database,"publicMatches",matchId,"timeline",entry.id),entry);
      await batch.commit();
    }
    return new Set([...entries,...operations].map(entry=>entry.id)).size;
  }
  async function publishPublicEvents(matchId, history) {
    const publicTypes = new Set([
      "ponto",
      "cartão amarelo",
      "cartão vermelho",
      "falta",
      "substituição",
      "tempo",
    ]);
    const reference = F.doc(database, "matches", matchId),
      actionId = uid(),
      auditRef = F.doc(database, "audit", actionId),
      publicRef = F.doc(database, "publicMatches", matchId);
    await F.runTransaction(database, async (tx) => {
      const snap = await tx.get(reference);
      if (!snap.exists()) return;
      const before = snap.data();
      if (history.at(-1)?.revision !== before._revision) return;
      const publicEvents = history
        .filter((e) => publicTypes.has(e.type))
        .map((e) => {
          const athlete = (before.roster || []).find((p) => p.id === e.player);
          return {
            id: e.id,
            type: e.type,
            side: e.side,
            value: e.value,
            player: e.player,
            playerName: athlete?.name || "",
            number: String(athlete?.number || ""),
            correctionOf: e.correctionOf || "",
          };
        })
        .slice(-5);
      if (JSON.stringify(publicEvents) === JSON.stringify(before.publicEvents || []))
        return;
      const next = {
        ...before,
        publicEvents,
        _revision: before._revision + 1,
        _audit: actionId,
        _updatedBy: session.uid,
        _updatedAt: F.serverTimestamp(),
      };
      const detail = M.detail("publicação de lances");
      detail.stage = before.stage;
      detail.setIndex = before.sets.length;
      detail.text = "Atualização dos lances publicados no placar";
      tx.set(reference, next);
      if (!next.publicHidden && !next.testData) tx.set(publicRef, M.publicMatch(next));
      tx.set(auditRef, {
        entity: "matches",
        target: matchId,
        actor: session.uid,
        at: F.serverTimestamp(),
        revision: next._revision,
        detail,
        before,
        after: next,
      });
    });
  }
  async function loadHistory(ids, { live = false } = {}) {
    if (!isOwner()) throw Error("Histórico e auditoria são exclusivos do administrador principal.");
    historyStop?.();
    historyStop = null;
    historyId = "";
    const epoch=generation;
    for (const id of ids) {
      const q = F.query(
        F.collection(database, "audit"),
        F.where("target", "==", id),
      );
      const snap = await F.getDocsFromServer(q);
      if(!isOwner()||epoch!==generation)return;
      cache.set(id, events(snap));
    }
    // Abrir detalhes é somente leitura; publicar lances exige uma ação explícita.
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
    const removed=await F.getDocsFromServer(F.collection(database,"cleanupAudit"));
    const access=await F.getDocsFromServer(F.collection(database,"accessAudit"));
    return [...snap.docs.map(d=>({ID:d.id,...d.data()})),...removed.docs.map(d=>{
      const r=d.data();return {ID:"limpeza-"+d.id,...r,revision:(r.before._revision||0)+1,
        detail:{type:"exclusão de teste",text:"Partida removida da central e do público. Histórico preservado.",reason:r.reason}};
    }),...access.docs.map(d=>{
      const r=d.data();return {ID:"acesso-"+d.id,entity:"users",target:r.target,actor:r.actor,at:r.at,
        revision:r.after?.revision||0,detail:{type:r.action,text:"Alteração de acesso e permissões.",reason:r.reason},
        before:r.before,after:r.after};
    })]
      .sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0));
  }
  // 17 — Limpeza de UMA partida, com cópia e log imutável na mesma transação.
  const cleanupBlocked = m => ["Ao vivo","Pausada","Suspensa"].includes(m.status) || m.clock?.running;
  async function previewCleanup(matchId) {
    if (!isOwner()) throw Error("Limpeza exclusiva do administrador principal.");
    const snap = await F.getDocFromServer(F.doc(database,"matches",matchId));
    if (!snap.exists()) throw Error("A partida já não existe. Atualize a lista.");
    const before=snap.data();
    if(before.championshipId)throw Error("Partidas vinculadas a campeonatos são preservadas na limpeza de testes.");
    if(cleanupBlocked(before))throw Error("Encerre ou cancele a partida antes da limpeza.");
    const history=await F.getDocsFromServer(F.query(F.collection(database,"audit"),F.where("target","==",matchId)));
    return {matchId,revision:before._revision,before,createdAt:Date.now(),
      backup:{format:"arena-limpeza-partida-v1",exportedAt:new Date().toISOString(),
        match:before,teams:state.teams.filter(t=>[before.home,before.away].includes(t.id)),
        players:state.players.filter(p=>[before.home,before.away].includes(p.team)),
        audit:history.docs.map(d=>({ID:d.id,...d.data()}))}};
  }
  async function deleteTestMatch(plan,reason,confirmation) {
    if(!isOwner())throw Error("Limpeza exclusiva do administrador principal.");
    reason=String(reason||"").trim();
    if(confirmation!=="LIXEIRA"||reason.length<5||reason.length>500)throw Error("Digite LIXEIRA e informe um motivo de 5 a 500 caracteres.");
    if(!plan||Date.now()-plan.createdAt>600000)throw Error("Prévia expirada. Gere uma nova prévia e cópia.");
    const ref=F.doc(database,"matches",plan.matchId), log=F.doc(database,"cleanupAudit",plan.matchId);
    await F.runTransaction(database,async tx=>{
      const snap=await tx.get(ref),oldLog=await tx.get(log);
      if(!snap.exists())throw Error("Partida já excluída. Nenhuma outra partida foi alterada.");
      const before=snap.data();
      if(oldLog.exists())throw Error("Este identificador já tem registro de limpeza.");
      if(before._revision!==plan.revision||JSON.stringify(before)!==JSON.stringify(plan.before))throw Error("A partida mudou após a prévia. Gere nova prévia e cópia antes de excluir.");
      if(before.championshipId)throw Error("Partidas vinculadas a campeonatos são preservadas na limpeza de testes.");
      if(cleanupBlocked(before))throw Error("Partida em operação. Limpeza bloqueada.");
      tx.set(log,{target:plan.matchId,entity:"matches",actor:session.uid,at:F.serverTimestamp(),reason,before,after:null,
        state:"lixeira",expiresAt:new Date(Date.now()+30*24*60*60*1000),home:before.home,away:before.away,
        sport:before.sport,competition:before.competition||"",status:before.status,score:before.score});
      tx.delete(ref);
      if (!before.publicHidden && !before.testData) tx.delete(F.doc(database,"publicMatches",plan.matchId));
    });
    cache.delete(plan.matchId);
  }
  async function restoreDeletedMatch(matchId, reason) {
    if (!isOwner()) throw Error("Somente o administrador principal pode recuperar partidas.");
    reason=String(reason||"").trim();
    if(reason.length<5||reason.length>500)throw Error("Informe uma justificativa de 5 a 500 caracteres.");
    const cleanupRef=F.doc(database,"cleanupAudit",matchId),matchRef=F.doc(database,"matches",matchId),publicRef=F.doc(database,"publicMatches",matchId),auditId=uid(),auditRef=F.doc(database,"audit",auditId);
    await F.runTransaction(database,async tx=>{
      const cleanupSnap=await tx.get(cleanupRef),matchSnap=await tx.get(matchRef),publicSnap=await tx.get(publicRef);
      if(!cleanupSnap.exists())throw Error("A partida não está mais na lixeira.");
      if(matchSnap.exists()||publicSnap.exists())throw Error("Já existe uma partida ativa com este identificador.");
      const archived=cleanupSnap.data(),expiresAt=archived.expiresAt?.toMillis?.()||new Date(archived.expiresAt||0).getTime();
      if(archived.state!=="lixeira"||!archived.before)throw Error("Esta partida não pode ser recuperada no estado atual.");
      if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error("O prazo de recuperação terminou. A partida pode ser purgada definitivamente.");
      const before=archived.before,after={...before,_revision:before._revision+1,_audit:auditId,_updatedBy:session.uid,_updatedAt:F.serverTimestamp()};
      const detail=M.detail("recuperação");detail.stage=before.stage;detail.setIndex=before.sets.length;detail.reason=reason;detail.text="Partida recuperada da lixeira";
      tx.set(matchRef,after);
      if (!after.publicHidden && !after.testData) tx.set(publicRef,M.publicMatch(after));
      tx.set(auditRef,{entity:"matches",target:matchId,actor:session.uid,at:F.serverTimestamp(),revision:after._revision,detail,before:null,after});
      tx.update(cleanupRef,{...archived,before:null,after:null,state:"restaurada",restoredBy:session.uid,restoredAt:F.serverTimestamp(),restoredAuditId:auditId});
    });
  }
  async function purgeDeletedMatch(matchId, reason) {
    if (!isOwner()) throw Error("Somente o administrador principal pode purgar partidas.");
    reason=String(reason||"").trim();
    const cleanupRef=F.doc(database,"cleanupAudit",matchId);
    let snap=await F.getDocFromServer(cleanupRef);
    if(!snap.exists())throw Error("Registro da lixeira não encontrado.");
    let record=snap.data();
    if(record.state==="lixeira"){
      const expiresAt=record.expiresAt?.toMillis?.()||new Date(record.expiresAt||0).getTime();
      if(!Number.isFinite(expiresAt)||expiresAt>Date.now())throw Error("A recuperação só termina após 30 dias.");
      if(reason.length<5||reason.length>500)throw Error("Informe a justificativa de purga, entre 5 e 500 caracteres.");
      await F.runTransaction(database,async tx=>{
        const current=await tx.get(cleanupRef);
        if(!current.exists()||current.data().state!=="lixeira")throw Error("O estado da lixeira mudou. Atualize e tente novamente.");
        const archived=current.data();
        if(archived.before?.championshipId)throw Error("O histórico de uma partida vinculada a campeonato deve ser preservado.");
        tx.update(cleanupRef,{...archived,before:null,after:null,state:"purgando",purgeReason:reason,purgeStartedBy:session.uid,purgeStartedAt:F.serverTimestamp()});
      });
      snap=await F.getDocFromServer(cleanupRef);record=snap.data();
    }
    if(record.state!=="purgando"&&record.state!=="purgado")throw Error("A partida não está pronta para purga.");
    if(record.state==="purgando"&&reason&&reason!==record.purgeReason)throw Error("Use a mesma justificativa registrada para retomar esta purga.");
    if(record.state==="purgado")return;
    const history=await F.getDocsFromServer(F.query(F.collection(database,"audit"),F.where("target","==",matchId)));
    for(let offset=0;offset<history.docs.length;offset+=400){
      const batch=F.writeBatch(database);
      for(const row of history.docs.slice(offset,offset+400))batch.delete(row.ref);
      await batch.commit();
    }
    const remaining=await F.getDocsFromServer(F.query(F.collection(database,"audit"),F.where("target","==",matchId)));
    if(!remaining.empty)throw Error("A purga foi interrompida. Use Retomar purga para concluir.");
    const corrections=await F.getDocsFromServer(F.query(F.collection(database,"corrections"),F.where("matchId","==",matchId)));
    for(let offset=0;offset<corrections.docs.length;offset+=400){
      const batch=F.writeBatch(database);
      for(const row of corrections.docs.slice(offset,offset+400))batch.delete(row.ref);
      await batch.commit();
    }
    const remainingCorrections=await F.getDocsFromServer(F.query(F.collection(database,"corrections"),F.where("matchId","==",matchId)));
    if(!remainingCorrections.empty)throw Error("A purga foi interrompida. Use Retomar purga para concluir.");
    await F.runTransaction(database,async tx=>{
      const current=await tx.get(cleanupRef);
      if(!current.exists()||current.data().state!=="purgando")throw Error("O estado da purga mudou. Atualize o histórico.");
      const archived=current.data();
      tx.update(cleanupRef,{...archived,state:"purgado",purgedBy:session.uid,purgedAt:F.serverTimestamp()});
    });
  }
  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : F.doc(F.collection(database, "audit")).id;
  async function send(action) {
    if (!session || !authorized()) throw Error("Faça login com uma conta autorizada.");
    if(action.type==="correct" && !canCorrectMatch(action.matchId))throw Error("O administrador precisa autorizar anulações de lances para esta conta e esta partida.");
    if (action.type === "notes" && !isOwner()) {
      throw Error("Somente o administrador pode editar as observações da súmula.");
    }
    if(["matchRosterAdd","matchRosterNote"].includes(action.type)&&!canManageRosters())throw Error("A organização precisa incluir o novo jogador no elenco desta partida.");
    const rosterAction=canManageRosters()&&(["team","player"].includes(action.type)||(action.type==="import"&&["team","player"].includes(action.kind)));
    const matchCreation = action.type === "match" && !action.data?.id && canCreateMatches();
    const championshipAction = action.type === "championship" && canManageChampionships();
    if (!isOwner() && !rosterAction && !matchCreation && !championshipAction && (["team", "player", "settings", "match", "import", "championship", "championshipLink","teamArchive"].includes(action.type) ||
      !canOperateMatch(action.matchId))) {
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
      const activeState={...state};for(const entity of ["matches","teams","players","championships"])activeState[entity]=(state[entity]||[]).filter(r=>!r.testData && (entity!=="players" || r.archived!==true));
      const checked = D.reduce(activeState, action, session.uid);
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
        prepared.publicEvents = [];
        prepared.rosterTeams = Object.fromEntries(
          prepared.roster.map((p) => [p.id, p.team]),
        );
        delete prepared.events;
      }
    } else if(action.type==="playerArchive"){
      if(!isOwner())throw Error("Somente o administrador pode remover jogadores.");
      const reason=String(action.reason||"").trim();
      if(reason.length<5||reason.length>500)throw Error("Informe o motivo (5 a 500 caracteres).");
      entity="players";target=action.playerId;
    } else if(action.type==="teamArchive"){
      if(!isOwner())throw Error("Somente o administrador principal arquiva ou reativa equipes.");
      if(typeof action.archived!=="boolean"||String(action.reason||"").trim().length<5||String(action.reason||"").trim().length>500)throw Error("Informe o motivo (5 a 500 caracteres).");
      entity="teams";target=action.teamId;
    } else {
      entity = "matches";
      target = action.matchId;
    }
    const actionId = uid(),
      reference = F.doc(database, entity, target),
      auditRef = F.doc(database, "audit", actionId),
      originalRef =
        action.type === "correct"
          ? (isOwner() ? F.doc(database, "audit", action.eventId) : F.doc(database,"matches",target,"operationEvents",action.eventId))
          : null,
      correctionRef =
        action.type === "correct"
          ? F.doc(database, "corrections", action.eventId)
          : null;
    const explainDeniedEvent = async (error) => {
      if (action.type !== "event" || error.code !== "permission-denied")
        return error;
      try {
        const snap = await F.getDocFromServer(reference);
        if (!snap.exists()) return new Error("A partida não existe mais no servidor.");
        const latest = snap.data();
        let modelCheck = "válida";
        try {
          M.applyMatch(latest, { ...action, publicId: "diagnostic" });
        } catch (validationError) {
          modelCheck = validationError.message;
        }
        const events = latest.publicEvents ?? [];
        const publicEventsValid = Array.isArray(events) && events.length <= 5 && events.every((event) =>
          event && ["id","type","side","value","player","playerName","number","correctionOf"].every((key) => Object.hasOwn(event, key)));
        const expectedTeam = [latest.home, latest.away][action.side];
        const athleteMatches = !action.player || latest.rosterTeams?.[action.player] === expectedTeam;
        const status = latest.status || "não informado";
        const publicCount = Array.isArray(events) ? `${events.length}/5` : "lista inválida";
        const diagnostic = new Error(`O Firebase recusou o lance; nada foi salvo. Servidor: ${status}, etapa ${latest.stage || "?"}, atleta compatível ${athleteMatches ? "sim" : "não"}, lances públicos ${publicCount} (${publicEventsValid ? "estrutura válida" : "estrutura antiga/inválida"}), validação do lance ${modelCheck}. Atualize a página antes de tentar novamente.`);
        diagnostic.code = error.code;
        return diagnostic;
      } catch {
        return error;
      }
    };
    // O mesmo ID é reutilizado nas tentativas internas da transação; nunca some pontos fora da transação.
    let attemptedRevision = -1;
    const commit = () =>
      F.runTransaction(database, async (tx) => {
        const beforeSnap = await tx.get(reference);
        const before = beforeSnap.exists() ? beforeSnap.data() : null;
        attemptedRevision = before?._revision || 0;
        if (action.type === "status" && action.status === "Encerrada") {
          if (!before) throw Error("Partida não encontrada.");
          if (["Encerrada", "Homologada"].includes(before.status)) {
            return {endedMatch: before, alreadyEnded: true};
          }
          if (!["Ao vivo", "Pausada", "Suspensa"].includes(before.status)) {
            throw Error("A situação no servidor é " + before.status + ". Atualize o painel antes de tentar encerrar.");
          }
        }
        let original = null;
        if (originalRef) {
          const o = await tx.get(originalRef),
            c = await tx.get(correctionRef);
          if (c.exists()) throw Error("Este lance já foi anulado.");
          if(!o.exists())throw Error("Lance antigo ainda não disponível para anulação. Peça ao administrador para abrir Ver lances anteriores nesta partida e sincronizar o histórico.");
          original = o.data();
        }
        let rosterPlayer=null;
        if(action.type==="matchRosterAdd"){
          if(typeof action.playerId!=="string"||!action.playerId||action.playerId.includes("/"))throw Error("Selecione um jogador cadastrado.");
          const snap=await tx.get(F.doc(database,"players",action.playerId));
          if(!snap.exists()||snap.data().testData===true||snap.data().archived===true)throw Error("Jogador indisponível.");
          rosterPlayer={...snap.data(),id:snap.id};
          const team=await tx.get(F.doc(database,"teams",rosterPlayer.team));
          if(!team.exists()||team.data().archived===true||team.data().testData===true)throw Error("Equipe indisponível para novas inclusões.");
          if (action.targetTeam && action.targetTeam !== rosterPlayer.team) {
            if (!before || ![before.home,before.away].includes(action.targetTeam)) throw Error("Escolha uma equipe desta partida.");
            const destination = await tx.get(F.doc(database,"teams",action.targetTeam));
            if (!destination.exists() || destination.data().archived === true || destination.data().testData === true)
              throw Error("Equipe de destino indisponível.");
          }
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
          const optionalFields = entity === "teams" ? ["school", "className", "manager"]
            : entity === "players" ? ["className"] : [];
          for (const field of optionalFields) {
            if (Object.hasOwn(action.data, field)) continue;
            if (Object.hasOwn(before || {}, field)) next[field] = before[field];
            else delete next[field];
          }
          if (entity === "matches" && championship) next.competition = championship.name + " • " + championship.season;
          for (const k of Object.keys(next))
            if (k.startsWith("_")) delete next[k];
          detail = M.detail(before ? "edição" : "cadastro");
          detail.text = String(action.importLabel || "Cadastro manual").slice(
            0,
            500,
          );
        } else if(action.type==="playerArchive"){
          if(!before||before.team!==action.teamId||before.archived===true||before.testData===true)throw Error("Jogador indisponível nesta equipe.");
          next={...before,archived:true};
          detail=M.detail("arquivamento");detail.reason=String(action.reason).trim();
          detail.text="Jogador removido do elenco atual";
        } else if(action.type==="teamArchive"){
          if(!before)throw Error("Equipe não encontrada.");
          if((before.archived||false)===action.archived)throw Error("A equipe já está nesta situação.");
          next={...before,archived:action.archived};detail=M.detail(action.archived?"arquivamento":"reativação");detail.reason=String(action.reason).trim();detail.text=action.archived?"Equipe retirada de novos cadastros e jogos":"Equipe disponível novamente";
        } else if (action.type === "matchVisibility") {
          if (!isOwner()) throw Error("Somente o administrador principal controla a publicação.");
          if (!before || !["Encerrada", "Homologada", "Cancelada"].includes(before.status))
            throw Error("Selecione uma partida finalizada.");
          const current = before.publicHidden === true;
          if (typeof action.hidden !== "boolean" || current === action.hidden)
            throw Error("A visibilidade já mudou. Atualize a lista.");
          next = { ...before, publicHidden: action.hidden };
          detail = M.detail("visibilidade pública");
          detail.stage = before.stage;
          detail.setIndex = before.sets.length;
          detail.text = action.hidden ? "Partida ocultada do painel público" : "Partida republicada";
        } else {
          if (!before) throw Error("Partida não encontrada.");
          const result = M.applyMatch(
            before,
            { ...action, rosterPlayer, administrative:isOwner(), publicId: actionId, championship },
            original,
            F.serverTimestamp(),
          );
          next = result.match;
          detail = result.detail;
        }
        if (["matches","teams","players","championships"].includes(entity) && (prepared || Object.hasOwn(before || {},"testData"))) next.testData = before?.testData === true;
        next._revision = (before?._revision || 0) + 1;
        next._audit = actionId;
        next._updatedBy = session.uid;
        next._updatedAt = F.serverTimestamp();
        // Uma partida não carrega o histórico inteiro. A súmula consulta audit sob demanda.
        if (JSON.stringify(next).length > 200000)
          throw Error("Cadastro muito grande para esta edição.");
        tx.set(reference, next);
        if (entity === "teams") {
          const publicTeam=F.doc(database,"publicTeams",target);
          if(next.testData)tx.delete(publicTeam);else tx.set(publicTeam,M.publicTeam(next));
        }
        if (entity === "settings")
          tx.set(
            F.doc(database, "publicSettings", target),
            M.publicSettings(next),
          );
        if (entity === "matches") {
          const publication = F.doc(database, "publicMatches", target);
          if (!next.publicHidden && !next.testData) tx.set(publication, M.publicMatch(next));
          else if (action.type === "matchVisibility") tx.delete(publication);
        }
        tx.set(auditRef, {
          entity,
          target,
          actor: session.uid,
          actorName: String(profile?.name || session.displayName || session.email || "").slice(0,100),
          actorRole: isOwner() ? "admin" : "operator",
          at: F.serverTimestamp(),
          revision: next._revision,
          detail,
          before,
          after: next,
        });
        if (entity === "matches") {
          const entry = timelineEntry(actionId, {entity, detail, after:next,
            at:F.serverTimestamp(),revision:next._revision});
          if (entry) tx.set(F.doc(database,"publicMatches",target,"timeline",actionId),entry);
          const operational=operationEvent(actionId,{entity,target,detail,after:next,at:F.serverTimestamp(),revision:next._revision});
          if(operational)tx.set(F.doc(database,"matches",target,"operationEvents",actionId),operational);
        }
        if (correctionRef)
          tx.set(correctionRef, {
            matchId: target,
            eventId: action.eventId,
            actionId,
            actor: session.uid,
            at: F.serverTimestamp(),
          });
        if (action.type === "status" && action.status === "Encerrada") {
          return {endedMatch: next, alreadyEnded: false};
        }
        if (action.type === "clock" && action.command === "ajustar") {
          return { clock: next.clock, addedTime:next.addedTime||null, revision: next._revision };
        }
      });
    // Uma regra pode rejeitar uma revisão antiga durante uma disputa entre dispositivos.
    // Só repetimos se o servidor confirmar que outra revisão foi gravada entretanto.
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await commit();
        if (entity === "championships") {
          const saved = await F.getDocFromServer(reference);
          const row = saved.exists() ? {...saved.data(), id:saved.id} : null;
          const fields=["name","season","sport","category","status"];
          if(!row || fields.some(key=>row[key]!==prepared[key]))
            throw Error("O campeonato não confirmou os dados enviados. Confira a conexão e possíveis alterações em outra aba antes de tentar novamente.");
          const index=state.championships.findIndex(item=>item.id===row.id);
          if(index<0)state.championships.push(row);else state.championships[index]=row;
          publish();
          return {championship:row};
        }
        return result;
      } catch (error) {
        if (
          error.code !== "permission-denied" ||
          attempt >= 2 ||
          entity !== "matches" ||
          prepared
        )
          throw await explainDeniedEvent(error);
        const latest = await F.getDocFromServer(reference);
        if (!latest.exists() || latest.data()._revision <= attemptedRevision)
          throw await explainDeniedEvent(error);
      }
    }
  }
  // 7 — Cadastro e permissões: nenhuma senha é gravada no Firestore.
  const mainUID = OWNER_UID;
  async function requestAccess(name, phone) {
    const u = authentication.currentUser;
    if (!u || administratorUIDs.has(u.uid)) throw Error("Use uma conta de operador para solicitar acesso.");
    name = String(name || u.displayName || "").trim();
    if (!name || name.length > 100) throw Error("Informe seu nome, com até 100 caracteres.");
    phone = String(phone || "").trim();
    const digits = phone.replace(/[^0-9]/g, "");
    if (!/^[+0-9() .-]+$/.test(phone) || phone.length > 25 || digits.length < 10 || digits.length > 15)
      throw Error("Informe um telefone com DDD, de 10 a 15 dígitos.");
    const ref = F.doc(database, "users", u.uid);
    const aid = uid();
    await F.runTransaction(database, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists()) return;
      const after = { id: u.uid, name, phone, email: u.email || "", role: "pending",
        enabled: false, matches: [], createdAt: F.serverTimestamp(),
        updatedAt: F.serverTimestamp(), revision: 1, auditId: aid };
      tx.set(ref, after);
      tx.set(F.doc(database, "accessAudit", aid), { actor: u.uid, target: u.uid,
        at: F.serverTimestamp(), action: "cadastro", reason: "Solicitação de acesso pelo próprio usuário",
        before: null, after });
    });
  }
  async function register({name, email, phone, password}) {
    if (authentication.currentUser) throw Error("Saia da conta atual antes de criar outra conta.");
    name = String(name || "").trim();
    email = String(email || "").trim();
    if (!name || name.length > 100) throw Error("Informe seu nome, com até 100 caracteres.");
    if (String(password || "").length < 8) throw Error("Use uma senha com pelo menos 8 caracteres.");
    const digits = String(phone || "").replace(/[^0-9]/g, "");
    if (!/^[+0-9() .-]+$/.test(String(phone || "")) || String(phone || "").length > 25 || digits.length < 10 || digits.length > 15)
      throw Error("Informe um telefone com DDD, de 10 a 15 dígitos.");
    const {user: u} = await auth.createUserWithEmailAndPassword(authentication, email, password);
    // Se uma etapa falhar, o usuário pode entrar e concluir seu pedido sem criar outra conta.
    await auth.updateProfile(u, { displayName: name });
    await requestAccess(name, phone);
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
  // 8 — GOOGLE. Popup para evitar dependência de redirecionamento entre domínios.
  // Nunca exclui/mescla contas nem troca o UID durante uma vinculação.
  const googleProvider = () => {
    const provider = new auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account", ...(authentication.currentUser?.email ? {login_hint: authentication.currentUser.email} : {}) });
    return provider;
  };
  let googleBusy = false;
  async function enterGoogle({register: registerIntent = false, registration = null} = {}) {
    if (!privateView) throw Error("Use a central para entrar com Google.");
    if (googleBusy) throw Error("Aguarde a janela do Google.");
    if (authentication.currentUser) throw Error("Você já está conectado. Para adicionar Google, use Vincular Google na sua conta.");
    googleBusy = true;
    try {
      const result = await auth.signInWithPopup(authentication, googleProvider());
      const u = result.user;
      await auth.reload(u);
      await auth.getIdToken(u, true);
      // O login não cria permissões. O cadastro cria apenas solicitação pendente auditada.
      if (registerIntent && !administratorUIDs.has(u.uid)) {
        if (!u.email) throw Error("O Google não informou um e-mail. Conclua a solicitação com outra forma de entrada.");
        if (registration && registration.email.toLowerCase() === u.email.toLowerCase()) {
          await requestAccess(registration.name, registration.phone);
        }
      }
      return { uid: u.uid, isNewUser: auth.getAdditionalUserInfo(result)?.isNewUser === true };
    } finally { googleBusy = false; }
  }
  async function linkGoogle() {
    if (!privateView) throw Error("Use a central para vincular sua conta.");
    if (googleBusy) throw Error("Aguarde a janela do Google.");
    const u = authentication.currentUser;
    if (!u) throw Error("Entre na sua conta existente antes de vincular Google.");
    if (u.providerData.some((p) => p.providerId === "google.com")) return {uid:u.uid, alreadyLinked:true};
    const beforeUID = u.uid;
    googleBusy = true;
    try {
      const result = await auth.linkWithPopup(u, googleProvider());
      if (result.user.uid !== beforeUID || authentication.currentUser?.uid !== beforeUID) {
        await auth.signOut(authentication);
        throw Error("A sessão mudou durante a vinculação. Entre novamente com a conta original.");
      }
      await auth.reload(result.user);
      await auth.getIdToken(result.user, true);
      // Não escreve users: aprovação, bloqueio e partidas atribuídas são preservados.
      return {uid:beforeUID, alreadyLinked:false};
    } finally { googleBusy = false; }
  }
  async function syncAccountMethods(u) {
    if (!u || !privateView) return;
    const methods = [...new Set(u.providerData.map(item => item.providerId))]
      .filter(method => ["password", "google.com"].includes(method)).sort();
    const ref = F.doc(database, "accountMethods", u.uid);
    const snap = await F.getDoc(ref);
    if (snap.exists() && JSON.stringify(snap.data().methods) === JSON.stringify(methods)) return;
    await F.setDoc(ref, { id: u.uid, methods, updatedAt: F.serverTimestamp() });
  }
  async function updateOwnContact({name, phone}) {
    const u = authentication.currentUser;
    if (!u || administratorUIDs.has(u.uid)) throw Error("Atualização disponível para contas de operadores.");
    name = String(name || "").trim();
    phone = String(phone || "").trim();
    const digits = phone.replace(/[^0-9]/g, "");
    if (!name || name.length > 100) throw Error("Informe o nome completo, com até 100 caracteres.");
    if (!/^[+0-9() .-]+$/.test(phone) || phone.length > 25 || digits.length < 10 || digits.length > 15)
      throw Error("Informe um telefone com DDD, de 10 a 15 dígitos.");
    const ref = F.doc(database, "users", u.uid), aid = uid();
    await F.runTransaction(database, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw Error("Conclua seu cadastro primeiro.");
      const before = snap.data();
      if (before.deleted || before.removalRequested) throw Error("O acesso foi removido ou está em exclusão.");
      const after = { ...before, name, phone, updatedAt: F.serverTimestamp(),
        revision: (before.revision || 0) + 1, auditId: aid };
      tx.set(ref, after);
      tx.set(F.doc(database, "accessAudit", aid), {
        actor: u.uid, target: u.uid, at: F.serverTimestamp(), action: "dados cadastrais",
        reason: "Atualização de nome e telefone pelo titular", before, after,
      });
    });
  }
  async function requestOwnRemoval(reason) {
    const u = authentication.currentUser;
    if (!u || administratorUIDs.has(u.uid))
      throw Error("Esta opção está disponível para contas de operadores.");
    reason = String(reason || "").trim();
    if (reason.length < 5 || reason.length > 500) throw Error("Informe um motivo de 5 a 500 caracteres.");
    const ref = F.doc(database, "users", u.uid), aid = uid();
    await F.runTransaction(database, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw Error("Cadastro não encontrado.");
      const before = snap.data();
      if (before.deleted || before.removalRequested) throw Error("Já existe uma solicitação ou exclusão deste acesso.");
      const after = { ...before, enabled: false, matches: [], permissions: [], followedEditions: [], operatedChampionships: [],
        removalRequested: true, removalReason: reason, updatedAt: F.serverTimestamp(),
        revision: (before.revision || 0) + 1, auditId: aid };
      tx.set(ref, after);
      tx.set(F.doc(database, "accessAudit", aid), {
        actor: u.uid, target: u.uid, at: F.serverTimestamp(),
        action: "solicitação de exclusão", reason, before, after,
      });
    });
  }
  async function removeOperator(userId, reason) {
    if (!isOwner() || administratorUIDs.has(userId))
      throw Error("Somente o administrador pode remover operadores. Contas administrativas são protegidas.");
    reason = String(reason || "").trim();
    if (reason.length < 5 || reason.length > 500)
      throw Error("Informe um motivo de 5 a 500 caracteres.");
    const ref = F.doc(database, "users", userId), aid = uid();
    await F.runTransaction(database, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw Error("Operador não encontrado.");
      const before = snap.data();
      if (before.deleted === true) throw Error("Este operador já foi removido.");
      const after = {
        id: userId, name: before.name || "Operador cadastrado", email: before.email || "",
        ...(before.phone ? {phone: before.phone} : {}),
        role: "operator", enabled: false, deleted: true,
        matches: [], permissions: [], followedEditions: [], operatedChampionships: [],
        createdAt: before.createdAt || F.serverTimestamp(),
        updatedAt: F.serverTimestamp(), revision: (before.revision || 0) + 1, auditId: aid,
      };
      tx.set(ref, after);
      tx.set(F.doc(database, "accessAudit", aid), {
        actor: session.uid, target: userId, at: F.serverTimestamp(),
        action: "exclusão de acesso", reason, before, after,
      });
    });
  }
  async function manageUser({ userId, access, matches, reason, permissions, followedEditions, operatedChampionships }) {
    if (!isOwner()) throw Error("Somente o administrador principal gerencia usuários.");
    if (administratorUIDs.has(userId)) throw Error("A conta administrativa está protegida e não pode ser alterada.");
    if (!["active", "blocked", "pending"].includes(access)) throw Error("Situação de acesso inválida.");
    reason = String(reason || "").trim();
    if (!reason || reason.length > 500) throw Error("Informe o motivo, com até 500 caracteres.");
    matches = access !== "active" ? [] : [...new Set(matches || [])];
    if (matches.length > 100 || matches.some((id) => !state.matches.some((m) => m.id === id)))
      throw Error("Selecione até 100 partidas existentes.");
    const ref = F.doc(database, "users", userId), aid = uid();
    await F.runTransaction(database, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw Error("Solicitação não encontrada.");
      const before = snap.data();
      if (before.deleted === true) throw Error("Este operador foi removido e está disponível apenas para consulta.");
      const granted=access==="active"?[...new Set(permissions===undefined?(before.permissions||[]):permissions)]:[];
      if(granted.some(p=>!["rosters","matchesCreate","championships","gamesView","historyCorrections","editMatchPhases"].includes(p)))throw Error("Permissão específica inválida.");
      const editions = access === "active"
        ? [...new Set(followedEditions ?? before.followedEditions ?? [])] : [];
      const known = new Set(state.championships.map((c) => c.name + " • " + c.season));
      if (editions.length > 20 || editions.some((title) =>
        !known.has(title) && !before.followedEditions?.includes(title))) {
        throw Error("Selecione até 20 edições de campeonatos.");
      }
      const operated = access === "active"
        ? [...new Set(operatedChampionships ?? before.operatedChampionships ?? [])] : [];
      if (operated.length > 100 || operated.some(id =>
        typeof id !== "string" || !state.championships.some(c => c.id === id)))
        throw Error("Selecione até 100 modalidades e categorias de campeonatos existentes.");
      const after = { id: userId, name: before.name || "Operador cadastrado", email: before.email || "",
        ...(before.phone ? {phone: before.phone} : {}),
        role: access === "pending" ? "pending" : "operator", enabled: access === "active", matches, permissions:granted, followedEditions:editions, operatedChampionships:operated,
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
    if (publicBranding) state.settings = publicBranding;
    onSession(u, "", {status: "loading"});
    onData(state);
    if (!u) { onConnection("FIREBASE SPARK • pronto para entrar"); return; }
    syncAccountMethods(u).catch(message);
    if (administratorUIDs.has(u.uid)) {
      // O titular não depende de um campo editável no documento users.
      onSession(u, "admin", {status: "owner"});
      listen(true);
      return;
    }
    profileStop = F.onSnapshot(F.doc(database, "users", u.uid), (snap) => {
      if (current !== generation) return;
      stop();
      state = D.fresh();
    if (publicBranding) state.settings = publicBranding;
      profile = snap.exists() ? snap.data() : null;
      onConnection(snap.metadata.fromCache ? "FIREBASE SPARK • aguardando confirmação do servidor" : "FIREBASE SPARK • conectado");
      const ids = profile?.matches;
      const valid = u.emailVerified === true && profile?.role === "operator" && profile.enabled !== false &&
        (ids === undefined || (Array.isArray(ids) && ids.every((id) =>
          typeof id === "string" && id.length > 0 && !id.includes("/"))));
      const status = !profile ? "incomplete" : profile.removalRequested ? "removal-requested" : profile.role === "operator" && profile.enabled === false ? "blocked" :
        !u.emailVerified ? "verify" : profile.role === "pending" ? "pending" : valid ? "operator" : "unauthorized";
      onSession(u, valid ? "operator" : "", {status,permissions:valid?(profile?.permissions||[]):[],followedEditions:valid?(profile?.followedEditions||[]):[],operatedChampionships:valid?(profile?.operatedChampionships||[]):[]});
      onData(state);
      if (valid) listen(true);

    }, (e) => {
      if (current !== generation) return;
      stop();
      profile = null;
      state = D.fresh();
    if (publicBranding) state.settings = publicBranding;
      onSession(u, "");
      onData(state);
      message(e);
    });
  });
  // Aparência pública também nas telas de entrada e cadastro.
  if (privateView) brandingStop = F.onSnapshot(F.doc(database, "publicSettings", "main"), (snap) => {
    publicBranding = snap.exists() ? snap.data() : D.fresh().settings;
    if (!isOwner()) { state.settings = publicBranding; publish(); }
  }, message);
  async function classifyTestRecord(entity, id, hidden, reason) {
    if(!isOwner() || !["teams","players","championships","matches"].includes(entity))throw Error("Classificação exclusiva do administrador.");
    const ref=F.doc(database,entity,id),auditRef=F.doc(F.collection(database,"audit"));
    await F.runTransaction(database,async tx=>{
      const snap=await tx.get(ref);if(!snap.exists())throw Error("Registro não encontrado: "+id);
      const before=snap.data();
      if(entity==="matches" && (before.clock?.running || ["Ao vivo","Pausada","Suspensa"].includes(before.status)))throw Error("Finalize a partida antes de separar os testes.");
      const next={...before,testData:hidden,_revision:(before._revision||0)+1,_audit:auditRef.id,_updatedBy:session.uid,_updatedAt:F.serverTimestamp()};
      tx.set(ref,next);
      if(entity==="teams"){const pub=F.doc(database,"publicTeams",id);if(hidden)tx.delete(pub);else tx.set(pub,M.publicTeam(next));}
      if(entity==="matches"){const pub=F.doc(database,"publicMatches",id);if(hidden||next.publicHidden)tx.delete(pub);else tx.set(pub,M.publicMatch(next));}
      const detail=M.detail("classificação de teste");if(entity==="matches"){detail.stage=before.stage;detail.setIndex=(before.sets||[]).length;}detail.reason=reason;detail.text=hidden?"Reservado na aba de testes do administrador":"Disponível nas telas normais";
      tx.set(auditRef,{entity,target:id,actor:session.uid,actorName:String(profile?.name||session.displayName||session.email||"").slice(0,100),actorRole:"admin",at:F.serverTimestamp(),revision:next._revision,detail,before,after:next});
    });
  }
  async function testMaintenance(active) {
    if(!isOwner())throw Error("Ação exclusiva do administrador.");
    const control=F.doc(database,"testControl","main");
    if(active)await F.runTransaction(database,async tx=>{const snap=await tx.get(control);if(snap.exists()&&snap.data().active)throw Error("Já existe uma classificação em andamento. Confira a outra aba antes de liberar a operação.");tx.set(control,{active:true,actor:session.uid,at:F.serverTimestamp()});});
    else await F.setDoc(control,{active:false,actor:session.uid,at:F.serverTimestamp()});
  }
  async function classifyTestRecords(items,hidden,reason,progress=()=>{}) {
    if(!isOwner() || typeof hidden!=="boolean" || !Array.isArray(items)||!items.length||items.length>500)throw Error("Selecione de 1 a 500 registros.");
    reason=String(reason||"").trim();if(reason.length<5||reason.length>300)throw Error("Informe um motivo de 5 a 300 caracteres.");
    await testMaintenance(true);
    try {
      const collections=await Promise.all(["teams","players","championships","matches"].map(async entity=>[entity,(await F.getDocsFromServer(F.collection(database,entity))).docs.map(d=>({...d.data(),id:d.id}))]));
      const all=Object.fromEntries(collections),selected=new Set(items.map(r=>r.entity+"/"+r.id));
      const marked=(entity,id)=>selected.has(entity+"/"+id);
      const reserved=(entity,id)=>all[entity].some(r=>r.id===id&&r.testData);
      if(hidden){
        for(const game of all.matches)if(!game.testData&&!marked("matches",game.id)&&
          (marked("championships",game.championshipId)||marked("teams",game.home)||marked("teams",game.away)||(game.roster||[]).some(p=>marked("players",p.id))))throw Error("Os vínculos mudaram. Refaça a prévia incluindo as partidas relacionadas.");
        for(const player of all.players)if(!player.testData&&!marked("players",player.id)&&marked("teams",player.team))throw Error("O elenco mudou. Refaça a prévia.");
      }else{
        for(const item of items){const record=all[item.entity]?.find(r=>r.id===item.id);if(!record)throw Error("Um registro mudou. Refaça a prévia.");
          const blocked=(entity,id)=>reserved(entity,id)&&!marked(entity,id);
          if(item.entity==="players"&&blocked("teams",record.team))throw Error("Restaure também a equipe deste jogador.");
          if(item.entity==="matches"&&(blocked("championships",record.championshipId)||blocked("teams",record.home)||blocked("teams",record.away)||(record.roster||[]).some(p=>blocked("players",p.id))))throw Error("Restaure também os vínculos da partida.");
        }
      }
      for(let i=0;i<items.length;i++){await classifyTestRecord(items[i].entity,items[i].id,hidden,reason);progress(i+1,items.length);}
    }
    finally {await testMaintenance(false);}
  }
  async function eventCredentials() {
    if(!isOwner())throw Error("Consulta exclusiva do administrador.");
    const snap=await F.getDocsFromServer(F.collection(database,"eventCredentials"));return snap.docs.map(d=>({...d.data(),id:d.id}));
  }
  async function issueCredential(data) {
    if(!isOwner())throw Error("Emissão exclusiva do administrador.");
    const ref=F.doc(F.collection(database,"eventCredentials"));
    const record={id:ref.id,name:String(data.name||"").trim(),eventId:String(data.eventId||""),function:String(data.function||"").trim(),organization:String(data.organization||"").trim(),validUntil:String(data.validUntil||""),userId:String(data.userId||""),status:"ativa",issuedBy:session.uid,issuedAt:F.serverTimestamp(),updatedAt:F.serverTimestamp()};
    if(!record.name||record.name.length>150||!record.function||record.function.length>80||record.organization.length>150||!/^\d{4}-\d{2}-\d{2}$/.test(record.validUntil))throw Error("Confira nome, função e organização.");
    await F.setDoc(ref,record);return ref.id;
  }
  async function revokeCredential(id) {
    if(!isOwner())throw Error("Revogação exclusiva do administrador.");
    await F.updateDoc(F.doc(database,"eventCredentials",id),{status:"revogada",updatedAt:F.serverTimestamp()});
  }
  return {
    diagnosticRead: async kind => {
      if(!isOwner())throw Error("Diagnóstico exclusivo do administrador.");
      const epoch=generation;
      const collections={championships:["name","season","sport"],teams:["name"],players:["name","team"],matches:["home","away","sport","status"],audit:["entity","target","detail"],users:["role"],publicMatches:["home","away","sport","status"]};
      let rows;
      if(["settings","publicSettings"].includes(kind)){
        const snap=await F.getDocFromServer(F.doc(database,kind,"main"));
        rows=snap.exists()?[snap.data()]:[];
      }else{
        if(!Object.hasOwn(collections,kind))throw Error("Consulta de diagnóstico não permitida.");
        const snap=await F.getDocsFromServer(F.query(F.collection(database,kind),F.limit(1)));
        rows=snap.docs.map(doc=>doc.data());
      }
      if(!isOwner()||epoch!==generation)throw Error("A sessão mudou. Inicie outra verificação.");
      const fields=collections[kind]||["title","color"];
      const privateFields=["notes","roster","rosterTeams","referees","_updatedBy","actor","actorName","actorRole"];
      return {empty:rows.length===0,valid:rows.every(row=>fields.every(field=>Object.hasOwn(row,field)) &&
        (kind!=="publicMatches" || privateFields.every(field=>!Object.hasOwn(row,field))))};
    },
    auth,
    authentication,
    database,
    F,
    send,
    savePartners: async data => {
      if(!isOwner())throw Error("Publicação exclusiva do administrador.");
      if(!window.ArenaDocuments?.validate(data))throw Error("Confira os logos, posições e marcas d’água dos documentos.");
      await F.setDoc(F.doc(database,"publicBranding","partners"),data);
    },
    mainUID,
    isAdministratorUID: uid => administratorUIDs.has(uid),
    register,
    requestAccess,
    resendVerification,
    refreshAccess,
    recoverPassword,
    manageUser,
    removeOperator,
    requestOwnRemoval,
    updateOwnContact,
    ownContact: () => profile ? {name:profile.name || "", phone:profile.phone || ""} : null,
    canManageRosters,
    enterGoogle,
    linkGoogle,
    loadHistory,
    loadTimeline,
    watchTimeline,
    publishTimeline,
    stopHistory,
    auditRows,
    teamHistory: async teamId => {
      if(!isOwner())throw Error("Histórico exclusivo do administrador principal.");
      const epoch=generation;
      const snapshots=await Promise.all([
        F.getDocsFromServer(F.query(F.collection(database,"audit"),F.where("target","==",teamId))),
        F.getDocsFromServer(F.query(F.collection(database,"audit"),F.where("entity","==","players")))
      ]);
      if(!isOwner()||epoch!==generation)throw Error("A sessão mudou. Consulte novamente.");
      return [...new Map(snapshots.flatMap(s=>s.docs.map(d=>({ID:d.id,...d.data()}))).map(r=>[r.ID,r])).values()].filter(r=>(r.entity==="teams"&&r.target===teamId)||(r.entity==="players"&&(r.before?.team===teamId||r.after?.team===teamId))).sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
    },
    cleanupHistory: async () => {
      if(!isOwner())throw Error("Histórico exclusivo do administrador principal.");
      const snap=await F.getDocsFromServer(F.collection(database,"cleanupAudit"));
      return snap.docs.map(d=>({ID:d.id,...d.data()}));
    },
    previewCleanup,
    deleteTestMatch,
    restoreDeletedMatch,
    purgeDeletedMatch,
    classifyTestRecords, testMaintenance, eventCredentials, issueCredential, revokeCredential,
    operationLayout: account => {
      if (!privateView || !authorized() || authentication.currentUser?.uid !== account) return null;
      const ref = F.doc(database, "arenaOperationLayouts", account);
      const allowed = () => {
        if (!authorized() || authentication.currentUser?.uid !== account) throw Error("A sessão mudou.");
      };
      return {
        uid: account,
        watch(update, error) {
          return F.onSnapshot(ref, {includeMetadataChanges:true}, snap => {
            if (authentication.currentUser?.uid !== account || snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
            update(snap.exists() ? snap.data().payload : null);
          }, error);
        },
        async seed(payload) {
          allowed();
          await F.runTransaction(database, async tx => {
            const snapshot = await tx.get(ref);
            allowed();
            if (!snapshot.exists()) tx.set(ref, {payload, updatedAt:F.serverTimestamp()});
          });
        },
        async write(payload) {
          allowed();
          await F.setDoc(ref, {payload, updatedAt:F.serverTimestamp()});
        },
      };
    },
    async saveMatchPhase(matchId,championshipId,data){
      if(!privateView||!canEditMatchPhases(championshipId))throw Error("Sem autorização para editar fases nesta edição.");
      const account=authentication.currentUser?.uid;
      const phase=String(data.phase||""),group=phase?String(data.group||"").trim().slice(0,40):"",
        round=phase?String(data.round||"").trim().slice(0,40):"";
      const ref=F.doc(database,"arenaMatchPhases",matchId);
      const audit=F.doc(F.collection(ref,"history"));
      await F.runTransaction(database,async tx=>{
        const [game,previous]=await Promise.all([
          tx.get(F.doc(database,"matches",matchId)),tx.get(ref)
        ]);
        if(!canEditMatchPhases(championshipId)||authentication.currentUser?.uid!==account)throw Error("A sessão mudou.");
        if(!game.exists()||game.data().championshipId!==championshipId||game.data().testData===true)
          throw Error("A partida precisa estar vinculada a esta edição.");
        const old=previous.data();
        if(old?.championshipId===championshipId&&old.phase===phase&&old.group===group&&old.round===round)return;
        const record={championshipId,phase,group,round,actor:account,auditId:audit.id,updatedAt:F.serverTimestamp()};
        tx.set(ref,record);tx.set(audit,record);
      });
    },
    async loadMatchPhaseHistory(matchId){
      const match=state.matches.find(item=>item.id===matchId);
      if(!privateView||!match||!canEditMatchPhases(match.championshipId))throw Error("Sem autorização para consultar esta partida.");
      const snap=await F.getDocs(F.query(F.collection(database,"arenaMatchPhases",matchId,"history"),F.where("championshipId","==",match.championshipId)));
      return snap.docs.map(doc=>doc.data()).sort((a,b)=>b.updatedAt.toMillis()-a.updatedAt.toMillis()).slice(0,20);
    },
    canOperate: canOperateMatch,
    canCorrect: canCorrectMatch,
    close: () => {
      stop();
      profileStop();
      authStop();
      brandingStop();
    },
  };
}
