$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$updates = @()
$pattern = '(?<prefix>\bsrc\s*=\s*["''](?:\./)?app\.js)(?:\?v=[^"'']*)?(?=["''])'
foreach ($file in @('index.html','painel.html')) {
    $path = (Resolve-Path -LiteralPath $file).Path
    $html = [IO.File]::ReadAllText($path)
    if ([regex]::Matches($html,$pattern).Count -ne 1) {
        throw ('Referencia ao app.js nao encontrada em ' + $file)
    }
    $html = [regex]::Replace($html,$pattern,'${prefix}?v=central-audiencia-mural-1')
    $css = '(?<prefix>\bhref\s*=\s*["''](?:\./)?style\.css)(?:\?v=[^"'']*)?(?=["''])'
    if ([regex]::Matches($html,$css).Count -ne 1) { throw ('Referencia ao style.css nao encontrada em ' + $file) }
    $updates += @{Path=$path; Content=[regex]::Replace($html,$css,'${prefix}?v=central-audiencia-mural-1')}
}
$temp = [IO.Path]::GetTempFileName()
try {
    $patch = @'
diff --git a/app.js b/app.js
index 8824988..e8e6083 100644
--- a/app.js
+++ b/app.js
@@ -1458,7 +1458,9 @@ function gameBarPinButton(pinned) {
   const label = gameBarPinLabel(pinned);
   return `<button type="button" class="arena-game-bar-pin" data-game-bar-pin aria-pressed="${pinned}" aria-label="${label}" title="${label}">${arenaIcon(pinned ? "pin" : "unpin")}</button>`;
 }
+const canAdjustBars=()=>Boolean(admin&&(role==="admin"||(role==="operator"&&operatorPermissions.includes("adjustBars"))));
 function gameBarSettingsButton(key="games") {
+  if(!canAdjustBars())return "";
   return `<button type="button" class="arena-game-bar-settings" data-game-bar-settings="${esc(key)}" aria-label="Personalizar esta área" title="Personalizar esta área">${arenaIcon("gear")}</button>`;
 }
 function applyGameBarPreferences(prefs, bar=$("#arenaTopMatchMonitor")) {
@@ -1494,6 +1496,7 @@ function colorSwatch(value,fallback){
   return rgb ? "#"+rgb.slice(1,4).map(n=>Number(n).toString(16).padStart(2,"0")).join("") : fallback;
 }
 function showGameBarSettings(key="games") {
+  if(!canAdjustBars())return;
   if(key==="mural-display"){
     if(!canManageMural())return;
     const details=$("#arenaMuralSettings")?.closest("details");
@@ -1528,6 +1531,11 @@ function showGameBarSettings(key="games") {
   </div>
   <label><input name="compact" type="checkbox" ${prefs.compact?"checked":""}> Espaçamento compacto</label>
   <label><input name="large" type="checkbox" ${prefs.large?"checked":""}> Botões maiores</label>
+  ${key==="audience-monitor"?`<fieldset><legend>Olho no painel público</legend>
+  <label>Tamanho (px)<input name="eyeSize" type="number" min="16" max="56" value="${audienceAppearance.size}" required></label>
+  <label>Intervalo entre piscadas (segundos)<input name="eyeSeconds" type="number" min="1" max="20" value="${audienceAppearance.seconds}" required></label>
+  <label><input name="eyeMotion" type="checkbox" ${audienceAppearance.motion?"checked":""}> Animar o olho</label>
+  </fieldset>`:""}
   ${key==="weather"?`<fieldset><legend>Ícone da previsão</legend>
   <label>Tamanho (px)<input name="iconSize" type="number" min="16" max="56" value="${Number(prefs.iconSize)||30}" required></label>
   <label>Segundos por ciclo<input name="iconSeconds" type="number" min="1" max="12" value="${Number(prefs.iconSeconds)||3}" required></label>
@@ -1554,11 +1562,24 @@ function showGameBarSettings(key="games") {
       dialog.close();
     }catch(error){toast(error.message,true);}
   }
-  form.onsubmit=event=>{
+  async function saveAudienceAppearance(values){
+    const button=form.querySelector('[type="submit"]');
+    button.disabled=true;
+    try{await cloud.saveAudienceAppearance(values);return true;}
+    catch(error){toast(error.message||"Não foi possível salvar o olho.",true);return false;}
+    finally{button.disabled=false;}
+  }
+  form.onsubmit=async event=>{
     event.preventDefault();event.stopPropagation();
+    if(key==="audience-monitor"&&!await saveAudienceAppearance({
+      size:form.elements.eyeSize.valueAsNumber,seconds:form.elements.eyeSeconds.valueAsNumber,motion:form.elements.eyeMotion.checked
+    }))return;
     saveGameBar({color:borderChanged?form.elements.color.value:prefs.color||"",background:form.elements.useBackground.checked?form.elements.background.value:"",buttons:form.elements.useButtons.checked?form.elements.buttons.value:"",compact:form.elements.compact.checked,large:form.elements.large.checked,hideLast:form.elements.hideLast?.checked===true,...(key==="weather"?{iconSize:form.elements.iconSize.valueAsNumber,iconSeconds:form.elements.iconSeconds.valueAsNumber,weatherMotion:form.elements.weatherMotion.value}:{})});
   };
-  dialog.querySelector("[data-game-bar-reset]").onclick=()=>saveGameBar({});
+  dialog.querySelector("[data-game-bar-reset]").onclick=async()=>{
+    if(key==="audience-monitor"&&!await saveAudienceAppearance({size:24,seconds:5,motion:true}))return;
+    saveGameBar({});
+  };
   dialog.addEventListener("close",()=>{
     dialog.remove();
     if(opener?.isConnected)opener.focus({preventScroll:true});
@@ -2004,7 +2025,7 @@ async function boot() {
   }
   render();
   try {
-    const { connectSpark } = await import("./spark-store.js?v=esportes-externos-1");
+    const { connectSpark } = await import("./spark-store.js?v=central-audiencia-mural-1");
     cloud = await connectSpark({
       config: C,
       privateView: admin,
@@ -2335,7 +2356,12 @@ function render() {
   const muralForm=canManageMural()&&section==="mural"&&muralScope===role+":"+user?.uid?$("#arenaMuralForm"):null;
   const muralConfig=muralForm?$("#arenaMuralSettings")?.closest("details"):null;
   const pageControls = arenaPageControls();
-  app.innerHTML = `${audienceMonitorBar()}${pageControls}${locationTrail()}${workspaceNavigation(sections)}${section==="overview"?muralQuickBar():""}${floatingGameClock()}<div class="sectionhead admin-heading noprint" data-custom-area="title:${esc(section)}"><div><span class="tag">${esc(panelDisplayName())}</span><h1 tabindex="-1">${esc(selected && isOperationSection() ? "Operação de partida" : sections.find(([id])=>id===section)?.[1] || "Visão geral")}</h1><p class="muted">${esc(navigationDescriptions[section]?.description || "Organize o evento e acompanhe os jogos.")}</p></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span>${gameBarSettingsButton("title:"+section)}</div>${section==="overview"?`${accountPendingBanner()}<div class="noprint">${liveStatusPanel("admin")}</div>`:""}<div id="view">${role==="operator" && section==="overview"?operatorStartPanel():""}${view()}</div>${relatedArenaScreens()}`;
+  const heading = `<div class="sectionhead admin-heading noprint" data-custom-area="title:${esc(section)}"><div><span class="tag">${esc(panelDisplayName())}</span><h1 tabindex="-1">${esc(selected && isOperationSection() ? "Operação de partida" : sections.find(([id])=>id===section)?.[1] || "Visão geral")}</h1><p class="muted">${esc(navigationDescriptions[section]?.description || "Organize o evento e acompanhe os jogos.")}</p></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span>${gameBarSettingsButton("title:"+section)}</div>`;
+  const liveSummary = section==="overview"?`${accountPendingBanner()}<div class="noprint">${liveStatusPanel("admin")}</div>`:"";
+  app.innerHTML = `${workspaceNavigation(sections)}${heading}${liveSummary}${floatingGameClock()}
+    ${pageControls}${locationTrail()}${workspaceTools()}
+    ${audienceMonitorBar()}${section==="overview"?muralQuickBar():""}
+    <div id="view">${role==="operator" && section==="overview"?operatorStartPanel():""}${view()}</div>${relatedArenaScreens()}`;
   if(muralForm)$("#arenaMuralForm")?.replaceWith(muralForm);
   if(muralConfig)$("#arenaMuralSettings")?.closest("details").replaceWith(muralConfig);
   syncMural();syncExternalSports();
@@ -2373,12 +2399,14 @@ const externalSportsConfig={
  scores:{permission:"externalScores",label:"Placares externos"},
  news:{permission:"externalNews",label:"Notícias esportivas externas"}
 };
+let audienceAppearance={size:24,seconds:5,motion:true};
+let externalScoreOffset=0;
 let externalSports={},externalSportsScope="",externalSportsStops=[],externalScoresRequest,externalScoresData;
 const canEditExternal=kind=>!C.demo&&(role==="admin"||(role==="operator"&&operatorPermissions.includes(externalSportsConfig[kind].permission)));
 const canManageExternal=()=>Object.keys(externalSportsConfig).some(canEditExternal);
 function externalSportsPanel(manage){
  if(C.demo||manage&&!canManageExternal())return "";
- return `<section class="card" data-external-sports="${manage?"manage":"public"}" ${manage?"":"hidden"}></section>`;
+ return `<section class="${manage?"card":"arena-mural-external"}" data-external-sports="${manage?"manage":"public"}" ${manage?"":"hidden"}></section>`;
 }
 function updateExternalSports(){
  const panel=app.querySelector("[data-external-sports]");if(!panel)return;
@@ -2395,20 +2423,43 @@ function updateExternalSports(){
   const status=live.includes(game.status)?(age<=35*60000?"Em andamento":"Placar sem atualização recente"):
    ["FT","AET","PEN"].includes(game.status)?"Encerrado":({NS:"Agendado",TBD:"Horário a definir",PST:"Adiado",CANC:"Cancelado",SUSP:"Suspenso",INT:"Interrompido"}[game.status]||"Consulte a fonte");
   const score=game.score.every(Number.isInteger)?game.score.join(" × "):"×";
-  return `<article class="arena-external-score"><small>${esc(game.league)}${game.round?" · "+esc(game.round):""}</small><h3>${esc(game.home)} <b>${esc(score)}</b> ${esc(game.away)}</h3><p>${esc(status)}${game.status==="NS"&&game.date?" · "+esc(format(game.date)):""}${live.includes(game.status)&&age<=35*60000&&Number.isInteger(game.minute)?" · "+game.minute+"′":""}</p></article>`;
+  return `<article class="arena-external-score"><small>${esc(game.league)}${game.round?" · "+esc(game.round):""}</small><h4 class="arena-external-match"><span>${esc(game.home)}</span><b>${esc(score)}</b><span>${esc(game.away)}</span></h4><p>${esc(status)}${game.status==="NS"&&game.date?" · "+esc(format(game.date)):""}${live.includes(game.status)&&age<=35*60000&&Number.isInteger(game.minute)?" · "+game.minute+"′":""}</p></article>`;
  }).join(""):`<p>${!data?"Placares indisponíveis no momento.":fresh?"Nenhuma partida publicada para hoje nas competições acompanhadas.":"Aguardando a atualização dos jogos de hoje."}</p>`;
- const markup=`<h2>${manage?"Publicação esportiva":"Futebol pelo Brasil e pela América"}</h2>${kinds.map(kind=>`<section><h3>${externalSportsConfig[kind].label}</h3>${manage?`<button type="button" data-external-toggle="${kind}" aria-pressed="${Boolean(externalSports[kind])}">${externalSports[kind]?"Retirar do painel público":"Exibir no painel público"}</button>`:""}${kind==="scores"?`<p class="muted">Brasileirão Série A, Paulista e Libertadores · API-Football${data?.updatedAt?" · Consulta em "+esc(format(data.updatedAt)):""}</p><div class="arena-external-scores">${scores}</div>`:`<arena-news>Carregando manchetes…</arena-news><p><a href="https://agenciabrasil.ebc.com.br/esportes" target="_blank" rel="noopener noreferrer">Agência Brasil · Esportes ↗</a></p>`}</section>`).join("")}`;
- if(panel.dataset.content!==markup){panel.innerHTML=markup;panel.dataset.content=markup;}
+ const markup=`<h2>${manage?"Publicação esportiva":"Jogos e notícias externas"}</h2>${kinds.map(kind=>`<section><h3>${externalSportsConfig[kind].label}</h3>${manage?`<button type="button" data-external-toggle="${kind}" aria-pressed="${Boolean(externalSports[kind])}">${externalSports[kind]?"Retirar do painel público":"Exibir no painel público"}</button>`:""}${kind==="scores"?`<p class="muted">Brasileirão Série A, Paulista e Libertadores · API-Football${data?.updatedAt?" · Consulta em "+esc(format(data.updatedAt)):""}</p><div class="arena-external-scores" tabindex="0" role="region" aria-label="Placares externos">${scores}</div>${fresh&&data.games.length>1?`<div class="toolbar"><button type="button" data-external-step="-1" aria-label="Placar externo anterior">←</button><button type="button" data-external-step="1" aria-label="Próximo placar externo">→</button></div>`:""}`:`<arena-news>Carregando manchetes…</arena-news><p><a href="https://agenciabrasil.ebc.com.br/esportes" target="_blank" rel="noopener noreferrer">Agência Brasil · Esportes ↗</a></p>`}</section>`).join("")}`;
+ if(panel.dataset.content!==markup){
+  panel.innerHTML=markup;panel.dataset.content=markup;
+  if(!manage){const rail=panel.querySelector(".arena-external-scores");if(rail)rail.scrollLeft=externalScoreOffset;}
+ }
  if(kinds.includes("scores")&&!externalScoresRequest){
   externalScoresRequest=fetch("https://raw.githubusercontent.com/wagnerbizza/arena-esportiva/arena-dados-placares/placares.json",{cache:"no-store",signal:AbortSignal.timeout(8000)})
    .then(response=>response.ok?response.json():null).then(payload=>{if(Array.isArray(payload?.games))externalScoresData=payload;})
    .catch(()=>{}).finally(()=>updateExternalSports());
  }
 }
+document.addEventListener("scroll",event=>{
+ if(event.target.matches?.('[data-external-sports="public"] .arena-external-scores'))
+  externalScoreOffset=event.target.scrollLeft;
+},true);
+document.addEventListener("click",event=>{
+ const button=event.target.closest("[data-external-step]");if(!button)return;
+ const rail=button.closest("section").querySelector(".arena-external-scores");
+ const card=rail.querySelector(".arena-external-score");if(!card)return;
+ const distance=card.offsetWidth+10;
+ const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.classList.contains("reduce-motion");
+ rail.scrollBy({left:Number(button.dataset.externalStep)*distance,behavior:reduced?"instant":"smooth"});
+});
 function syncExternalSports(){
  const scope=cloud&&!C.demo?admin?(user?.uid||""):"public":"";
  if(scope!==externalSportsScope){
   externalSportsStops.forEach(stop=>stop());externalSportsStops=[];externalSports={};externalSportsScope=scope;
+  if(scope)externalSportsStops.push(cloud.watchAudienceAppearance(value=>{
+   if(scope!==externalSportsScope)return;
+   audienceAppearance={size:24,seconds:5,motion:true,...value};
+   const root=document.documentElement;
+   root.style.setProperty("--arena-eye-size",Math.min(56,Math.max(16,Number(audienceAppearance.size)||24))+"px");
+   root.style.setProperty("--arena-eye-seconds",Math.min(20,Math.max(1,Number(audienceAppearance.seconds)||5))+"s");
+   root.toggleAttribute("data-arena-eye-still",audienceAppearance.motion===false);
+  }));
   if(scope)for(const kind of Object.keys(externalSportsConfig))externalSportsStops.push(cloud.watchExternalSports(kind,enabled=>{
    if(scope!==externalSportsScope)return;
    externalSports[kind]=enabled;updateExternalSports();
@@ -2436,7 +2487,7 @@ function publicPageHTML() {
       D.SPORTS,
       (x) => x,
       (x) => x,
-    )}</select></div>${documentBrandingMarkup("publicPanel","header")}${externalSportsPanel(false)}${publicHub()}${partnerMarkup("publicPanel")}`;
+    )}</select></div>${documentBrandingMarkup("publicPanel","header")}${publicHub()}${partnerMarkup("publicPanel")}`;
 }
 function publicMatches(filter) {
   const list = state.matches.filter(m=>(!filter||m.sport===filter)&&
@@ -3830,6 +3881,7 @@ function updateOperationSummary(form) {
     ["muralPublishPermission","Publicar no mural"],
     ["externalScores","Publicar placares externos"],
     ["externalNews","Publicar notícias externas"],
+    ["adjustBars","Personalizar barras"],
     ["gamesViewPermission", "Consultar todos os jogos publicados"],
     ["historyCorrectPermission", "Anular lances nos jogos liberados"],
     ["phaseEditPermission", "Editar grupos e chaves nos campeonatos liberados"],
@@ -3943,7 +3995,7 @@ function operatorAuthorizationGroups(operator,editionOptions) {
   `<label class="confirmation-check"><input type="checkbox" name="phaseEditPermission" ${checked("editMatchPhases")}><span>Mudar fase, grupo, chave ou rodada.</span></label>`,permissions.includes("editMatchPhases")?1:0);
  const registrations=authorizationSection("records","Fazer cadastros","Cada caixa libera um cadastro. Para operar um jogo criado, marque o jogo ou seu campeonato nas opções acima.",`<label class="confirmation-check"><input type="checkbox" name="rosterPermission" ${checked("rosters")}><span>Criar, editar e importar equipes e jogadores.</span></label><label class="confirmation-check"><input type="checkbox" name="championshipPermission" ${checked("championships")}><span>Criar e editar campeonatos e temporadas.</span></label><label class="confirmation-check"><input type="checkbox" name="matchCreatePermission" ${checked("matchesCreate")}><span>Criar novos jogos.</span></label>`,permissions.filter(id=>["rosters","championships","matchesCreate"].includes(id)).length);
  const viewing=authorizationSection("view","Só consultar jogos","As opções abaixo liberam consulta. Para registrar lances, use Operar campeonatos ou Operar jogos avulsos.",`<fieldset><legend>Campeonatos para consultar</legend>${editionOptions}<label class="confirmation-check"><input type="checkbox" name="gamesViewPermission" ${checked("gamesView")}><span>Consultar todos os jogos publicados.</span></label></fieldset>`,(operator.followedEditions||[]).length+(permissions.includes("gamesView")?1:0));
- return `${operateAll}${authorizationSection("external-sports","Publicação esportiva externa","Delegue cada tipo de publicação separadamente.",Object.entries(externalSportsConfig).map(([kind,item])=>`<label class="confirmation-check"><input type="checkbox" name="${item.permission}" ${checked(item.permission)}><span>Publicar ${item.label.toLowerCase()}</span></label>`).join(""),Object.values(externalSportsConfig).filter(item=>permissions.includes(item.permission)).length)}${authorizationSection("mural","Mural de recados","Publicação de recados gerais, independentemente dos jogos.",`<label class="confirmation-check"><input type="checkbox" name="muralPublishPermission" ${checked("muralPublish")}><span>Publicar no mural</span></label>`,permissions.includes("muralPublish")?1:0)}<div class="toolbar"><button type="button" data-permissions-expand="true">Expandir autorizações</button><button type="button" data-permissions-expand="false">Recolher autorizações</button></div>${operations}${matches}${publication}${history}${sportCorrection}${phases}${registrations}${viewing}`;
+ return `${operateAll}${authorizationSection("bar-settings","Configurações das barras","Libera os ajustes pela engrenagem, clique direito e toque prolongado.",`<label class="confirmation-check"><input type="checkbox" name="adjustBars" ${checked("adjustBars")}><span>Personalizar barras</span></label>`,permissions.includes("adjustBars")?1:0)}${authorizationSection("external-sports","Publicação esportiva externa","Delegue cada tipo de publicação separadamente.",Object.entries(externalSportsConfig).map(([kind,item])=>`<label class="confirmation-check"><input type="checkbox" name="${item.permission}" ${checked(item.permission)}><span>Publicar ${item.label.toLowerCase()}</span></label>`).join(""),Object.values(externalSportsConfig).filter(item=>permissions.includes(item.permission)).length)}${authorizationSection("mural","Mural de recados","Publicação de recados gerais, independentemente dos jogos.",`<label class="confirmation-check"><input type="checkbox" name="muralPublishPermission" ${checked("muralPublish")}><span>Publicar no mural</span></label>`,permissions.includes("muralPublish")?1:0)}<div class="toolbar"><button type="button" data-permissions-expand="true">Expandir autorizações</button><button type="button" data-permissions-expand="false">Recolher autorizações</button></div>${operations}${matches}${publication}${history}${sportCorrection}${phases}${registrations}${viewing}`;
 }
 document.addEventListener("click",event=>{
  const button=event.target.closest("[data-permissions-expand]");if(!button||role!=="admin")return;
@@ -3979,7 +4031,7 @@ function usersView() {
     permissions.includes("championships") && "Campeonatos",
     permissions.includes("matchesCreate") && "Novas partidas",
   ].filter(Boolean).join(", ") || "Nenhum";
-  const permissionNames={externalScores:"Publicar placares externos",externalNews:"Publicar notícias externas",muralPublish:"Publicar no mural",hidePublicGames:"Ocultar jogos do público",operateAllGames:"Operar tudo",rosters:"Equipes e jogadores",championships:"Campeonatos",matchesCreate:"Novas partidas",gamesView:"Acompanhar todos os jogos",historyCorrections:"Anular lances com justificativa",editMatchPhases:"Editar grupos e chaves",correctMatchSport:"Corrigir modalidade dos jogos liberados"};
+  const permissionNames={adjustBars:"Personalizar barras",externalScores:"Publicar placares externos",externalNews:"Publicar notícias externas",muralPublish:"Publicar no mural",hidePublicGames:"Ocultar jogos do público",operateAllGames:"Operar tudo",rosters:"Equipes e jogadores",championships:"Campeonatos",matchesCreate:"Novas partidas",gamesView:"Acompanhar todos os jogos",historyCorrections:"Anular lances com justificativa",editMatchPhases:"Editar grupos e chaves",correctMatchSport:"Corrigir modalidade dos jogos liberados"};
   const accessAuditRows=(state.accessAudit||[]).slice().sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
   const accessAuditDate=value=>value?.toDate?.().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})||"Aguardando confirmação do servidor";
   const accessAuditValue=(key,value)=>{
@@ -4065,7 +4117,7 @@ document.addEventListener("submit", async (e) => {
           toast(user?.emailVerified ? "Solicitação registrada. Aguarde a aprovação do administrador principal." : "Solicitação registrada. Confira a confirmação enviada ao seu e-mail.");
         } else {
           await cloud.manageUser({userId:d.userId, access:d.access,
-            matches: new FormData(f).getAll("assignedMatches"), followedEditions: new FormData(f).getAll("followedEditions"), operatedChampionships: new FormData(f).getAll("operatedChampionships"), permissions:[...Object.values(externalSportsConfig).filter(item=>f.elements[item.permission]?.checked).map(item=>item.permission),...(f.elements.muralPublishPermission?.checked?["muralPublish"]:[]),...(f.elements.hidePublicPermission.checked?["hidePublicGames"]:[]),...(f.elements.operateAllPermission.checked?["operateAllGames"]:[]),...(f.elements.rosterPermission.checked?["rosters"]:[]),...(f.elements.matchCreatePermission.checked?["matchesCreate"]:[]),...(f.elements.championshipPermission.checked?["championships"]:[]),...(f.elements.gamesViewPermission.checked?["gamesView"]:[]),...(f.elements.historyCorrectPermission.checked?["historyCorrections"]:[]),...(f.elements.phaseEditPermission.checked?["editMatchPhases"]:[]),...(f.elements.matchSportCorrectionPermission.checked?["correctMatchSport"]:[])], reason:d.reason});
+            matches: new FormData(f).getAll("assignedMatches"), followedEditions: new FormData(f).getAll("followedEditions"), operatedChampionships: new FormData(f).getAll("operatedChampionships"), permissions:[...(f.elements.adjustBars?.checked?["adjustBars"]:[]),...Object.values(externalSportsConfig).filter(item=>f.elements[item.permission]?.checked).map(item=>item.permission),...(f.elements.muralPublishPermission?.checked?["muralPublish"]:[]),...(f.elements.hidePublicPermission.checked?["hidePublicGames"]:[]),...(f.elements.operateAllPermission.checked?["operateAllGames"]:[]),...(f.elements.rosterPermission.checked?["rosters"]:[]),...(f.elements.matchCreatePermission.checked?["matchesCreate"]:[]),...(f.elements.championshipPermission.checked?["championships"]:[]),...(f.elements.gamesViewPermission.checked?["gamesView"]:[]),...(f.elements.historyCorrectPermission.checked?["historyCorrections"]:[]),...(f.elements.phaseEditPermission.checked?["editMatchPhases"]:[]),...(f.elements.matchSportCorrectionPermission.checked?["correctMatchSport"]:[])], reason:d.reason});
           managedUserId = "";
           toast("Permissões salvas e registradas no histórico.");
         }
@@ -5607,7 +5659,10 @@ function workspaceNavigation(sections){
    const active=ids.includes(section),open=arenaOpenGroups.has(group.id)?arenaOpenGroups.get(group.id):active;
    return `<details class="arena-side-group" data-layout-group="${group.id}" ${open?"open":""}><summary title="${esc(group.title)}" aria-label="${esc(group.title)}">${arenaIcon(group.id)}<span>${esc(group.title)}</span></summary><nav aria-label="${esc(group.title)}">${ids.map(id=>`<button type="button" data-section="${id}" title="${esc(labels[id]||id)}" class="arena-side-item ${section===id?"is-current":""}" ${personal.disabled.includes(id)?'aria-disabled="true"':""} ${section===id?'aria-current="page"':""}>${arenaSectionIcon(id)}<span>${esc(labels[id]||id)}</span></button>${id==="matches"?`<div class="arena-side-scopes" aria-label="Filtrar jogos"><button type="button" data-games-shortcut="live">${arenaIcon("live")}<span>Ao vivo</span></button><button type="button" data-games-shortcut="scheduled">${arenaIcon("calendar")}<span>Agenda</span></button><button type="button" data-games-shortcut="finished">${arenaIcon("results")}<span>Resultados</span></button></div>`:""}`).join("")}</nav></details>`;
  }).join("");
- return `<aside id="arenaSidebar" class="arena-sidebar noprint ${navigationQuery.trim()?"arena-search-active":""}" aria-label="Navegação da central" tabindex="-1"><div class="arena-sidebar-brand"><a href="./apresentacao.html" class="arena-side-brand-link" aria-label="${esc(systemDisplayName())}" title="${esc(systemDisplayName())}">${brand}</a><button type="button" data-layout-rail aria-label="Recolher barra lateral" title="Recolher barra lateral" aria-expanded="true" aria-controls="arenaSidebar">${arenaIcon("collapse")}</button><button type="button" data-layout-close aria-label="Fechar menu">${arenaIcon("close")}</button></div><div class="arena-side-search"><button type="button" class="arena-side-search-launch" data-side-search-open aria-label="Pesquisar funções" title="Pesquisar funções (Ctrl+K)">${arenaIcon("search")}</button><label for="sideFunctionSearch" class="arena-icon-action">${arenaIcon("search")} Pesquisar no menu</label><div class="arena-side-search-field"><input id="sideFunctionSearch" type="search" value="${esc(navigationQuery)}" placeholder="Buscar função…" autocomplete="off" aria-controls="arenaSideSearchResults" aria-keyshortcuts="Control+k Meta+k"><button type="button" data-clear-navigation-search data-side-clear aria-label="Limpar pesquisa do menu" title="Limpar pesquisa">${arenaIcon("close")}</button></div></div><div class="arena-sidebar-nav"><div id="arenaSideSearchResults" aria-live="polite">${navigationSearchResults()}</div><p class="arena-side-caption">ESPAÇO DE TRABALHO</p><button type="button" title="Início" aria-label="Início" class="arena-side-home ${section==="overview"?"is-current":""}" data-section="overview" ${section==="overview"?'aria-current="page"':""}>${arenaIcon("overview")}<span>Início</span></button>${personal.hidden.includes("operation")?"":`<button type="button" class="arena-side-item ${section==="operation"?"is-current":""}" data-section="operation" title="Cabine de Operação" ${section==="operation"?'aria-current="page"':""} ${personal.disabled.includes("operation")?'aria-disabled="true"':""}>${arenaIcon("live")}<span>Cabine de Operação</span></button>`}${groups}</div><div class="arena-sidebar-footer">${footerItem("account","Minha conta","account")}${footerItem(role==="admin"?"settings":"preferences","Configurações","maintenance")}${footerItem("profiles","Trocar perfil / conta","profiles")}<button type="button" data-account-guide title="Demonstração e ajuda" aria-label="Demonstração e ajuda">${arenaIcon("help")}<span>Demonstração e ajuda</span></button><a class="button" href="${esc(publicHref)}" target="_blank" rel="noopener" title="Abrir painel público" aria-label="Abrir painel público">${arenaIcon("games")}<span>Abrir painel público</span></a><small>${esc(C.demo?"Treinamento isolado":accountName())}<br>${esc(accountRole())}</small></div></aside><div class="arena-drawer-backdrop noprint" data-layout-close ${arenaDrawerOpen?"":"hidden"}></div><button type="button" class="arena-sidebar-resize noprint" aria-label="Ajustar largura da barra lateral" title="Arraste ou use as setas esquerda e direita">↔</button><section class="navigation-finder arena-function-search noprint" data-custom-area="search" aria-label="Encontrar função"><label for="functionSearch" class="arena-icon-action">${arenaIcon("search")} Encontrar uma função</label><div class="navigation-search-row"><input id="functionSearch" type="search" placeholder="Ex.: relógio, jogador, súmula ou permissões" value="${esc(navigationQuery)}" autocomplete="off" aria-controls="navigationSearchResults"><button type="button" data-clear-navigation-search>Limpar busca</button>${gameBarSettingsButton("search")}</div><div id="navigationSearchResults" aria-live="polite">${navigationSearchResults()}</div></section><section class="card arena-ui-customization noprint" data-custom-area="navigation" aria-label="Atalhos e personalização"><div class="arena-toolbar"><span class="arena-current-profile">${esc(panelDisplayName())}</span><button type="button" data-account-guide>${arenaIcon("help")} Guia das funções</button>${gameBarSettingsButton("navigation")}</div>${personalTopShortcuts()}${section==="overview"?overviewPersonalization():""}</section>`;
+ return `<aside id="arenaSidebar" class="arena-sidebar noprint ${navigationQuery.trim()?"arena-search-active":""}" aria-label="Navegação da central" tabindex="-1"><div class="arena-sidebar-brand"><a href="./apresentacao.html" class="arena-side-brand-link" aria-label="${esc(systemDisplayName())}" title="${esc(systemDisplayName())}">${brand}</a><button type="button" data-layout-rail aria-label="Recolher barra lateral" title="Recolher barra lateral" aria-expanded="true" aria-controls="arenaSidebar">${arenaIcon("collapse")}</button><button type="button" data-layout-close aria-label="Fechar menu">${arenaIcon("close")}</button></div><div class="arena-side-search"><button type="button" class="arena-side-search-launch" data-side-search-open aria-label="Pesquisar funções" title="Pesquisar funções (Ctrl+K)">${arenaIcon("search")}</button><label for="sideFunctionSearch" class="arena-icon-action">${arenaIcon("search")} Pesquisar no menu</label><div class="arena-side-search-field"><input id="sideFunctionSearch" type="search" value="${esc(navigationQuery)}" placeholder="Buscar função…" autocomplete="off" aria-controls="arenaSideSearchResults" aria-keyshortcuts="Control+k Meta+k"><button type="button" data-clear-navigation-search data-side-clear aria-label="Limpar pesquisa do menu" title="Limpar pesquisa">${arenaIcon("close")}</button></div></div><div class="arena-sidebar-nav"><div id="arenaSideSearchResults" aria-live="polite">${navigationSearchResults()}</div><p class="arena-side-caption">ESPAÇO DE TRABALHO</p><button type="button" title="Início" aria-label="Início" class="arena-side-home ${section==="overview"?"is-current":""}" data-section="overview" ${section==="overview"?'aria-current="page"':""}>${arenaIcon("overview")}<span>Início</span></button>${personal.hidden.includes("operation")?"":`<button type="button" class="arena-side-item ${section==="operation"?"is-current":""}" data-section="operation" title="Cabine de Operação" ${section==="operation"?'aria-current="page"':""} ${personal.disabled.includes("operation")?'aria-disabled="true"':""}>${arenaIcon("live")}<span>Cabine de Operação</span></button>`}${groups}</div><div class="arena-sidebar-footer">${footerItem("account","Minha conta","account")}${footerItem(role==="admin"?"settings":"preferences","Configurações","maintenance")}${footerItem("profiles","Trocar perfil / conta","profiles")}<button type="button" data-account-guide title="Demonstração e ajuda" aria-label="Demonstração e ajuda">${arenaIcon("help")}<span>Demonstração e ajuda</span></button><a class="button" href="${esc(publicHref)}" target="_blank" rel="noopener" title="Abrir painel público" aria-label="Abrir painel público">${arenaIcon("games")}<span>Abrir painel público</span></a><small>${esc(C.demo?"Treinamento isolado":accountName())}<br>${esc(accountRole())}</small></div></aside><div class="arena-drawer-backdrop noprint" data-layout-close ${arenaDrawerOpen?"":"hidden"}></div><button type="button" class="arena-sidebar-resize noprint" aria-label="Ajustar largura da barra lateral" title="Arraste ou use as setas esquerda e direita">↔</button>`;
+}
+function workspaceTools(){
+ return `<section class="navigation-finder arena-function-search noprint" data-custom-area="search" aria-label="Encontrar função"><label for="functionSearch" class="arena-icon-action">${arenaIcon("search")} Encontrar uma função</label><div class="navigation-search-row"><input id="functionSearch" type="search" placeholder="Ex.: relógio, jogador, súmula ou permissões" value="${esc(navigationQuery)}" autocomplete="off" aria-controls="navigationSearchResults"><button type="button" data-clear-navigation-search>Limpar busca</button>${gameBarSettingsButton("search")}</div><div id="navigationSearchResults" aria-live="polite">${navigationSearchResults()}</div></section><section class="card arena-ui-customization noprint" data-custom-area="navigation" aria-label="Atalhos e personalização"><div class="arena-toolbar"><span class="arena-current-profile">${esc(panelDisplayName())}</span><button type="button" data-account-guide>${arenaIcon("help")} Guia das funções</button>${gameBarSettingsButton("navigation")}</div>${personalTopShortcuts()}${section==="overview"?overviewPersonalization():""}</section>`;
 }
 function openSideFunctionSearch() {
  arenaRailCollapsed=false;
@@ -5754,7 +5809,7 @@ function publicChallenge(){
 }
 const canManageMural=()=>!C.demo && (role==="admin" || (role==="operator" && operatorPermissions.includes("muralPublish")));
 let muralRows=[], muralStop, muralScope="", muralError="", muralLoaded=false, muralEditing="", muralBusy=false;
-const muralDefaults={title:"Bem-vindo à Arena!",subtitle:"Acompanhe placares, próximos jogos e recados da comunidade.",seconds:10,accent:"#15c3ed",auto:true,results:true,agenda:true,partners:true,news:false,sequence:"interleave",transition:"random"};
+const muralDefaults={title:"Bem-vindo à Arena!",subtitle:"Acompanhe placares, próximos jogos e recados da comunidade.",seconds:10,accent:"#15c3ed",auto:true,results:true,agenda:true,partners:true,news:false,sequence:"interleave",transition:"random",ballMotion:"random",ballSeconds:3};
 let muralNews=[],muralNewsRequested=false;
 let muralSettings={...muralDefaults},muralSettingsStop,muralSlide=0,muralPaused=false,muralNext=0;
 const muralMotion=matchMedia("(prefers-reduced-motion: reduce)");
@@ -5762,6 +5817,7 @@ function muralPublicCard(){
  return C.demo?"":`<section class="card" data-mural-public aria-labelledby="arenaMuralTitle">
    <div class="arena-mural-header"><h2 id="arenaMuralTitle">Mural da Arena</h2>
    <span class="arena-mural-field" aria-hidden="true"><i></i></span></div>
+   <h3 class="arena-mural-school-heading">Arena escolar · Jogos e recados</h3>
    <div data-mural-slide aria-live="off"></div>
    <div class="toolbar" data-mural-controls hidden>
     <button type="button" data-mural-step="-1" aria-label="Recado anterior">←</button>
@@ -5769,8 +5825,18 @@ function muralPublicCard(){
     <button type="button" data-mural-step="1" aria-label="Próximo recado">→</button>
     <button type="button" data-mural-pause>Pausar</button>
    </div>
+   ${externalSportsPanel(false)}
  </section>`;
 }
+function setMuralBallPath(ball){
+ for(let point=1;point<=3;point++){
+  ball.style.setProperty("--arena-ball-x"+point,(Math.round(Math.random()*70)-35)+"px");
+  ball.style.setProperty("--arena-ball-y"+point,(Math.round(Math.random()*28)-14)+"px");
+ }
+}
+document.addEventListener("animationiteration",event=>{
+ if(event.animationName==="arena-mural-random-ball")setMuralBallPath(event.target);
+});
 function muralSlides(){
  const now=new Date();
  const messages=muralRows.filter(row=>!muralDate(row)||muralDate(row)>now)
@@ -5825,6 +5891,11 @@ function showMuralSlide(step=0,announce=false){
   muralNext=Date.now()+Math.min(60,muralSettings.seconds+(row.teams?2:0))*1000;
  }
  const reduced=muralMotion.matches||document.documentElement.classList.contains("reduce-motion");
+ const motion=["random","horizontal","off"].includes(muralSettings.ballMotion)?muralSettings.ballMotion:"random";
+ const field=box.querySelector(".arena-mural-field");
+ field.dataset.ballMotion=motion;
+ field.style.setProperty("--arena-ball-cycle",(Number(muralSettings.ballSeconds)||3)+"s");
+ if(!field.firstElementChild.style.getPropertyValue("--arena-ball-x1"))setMuralBallPath(field.firstElementChild);
  box.toggleAttribute("data-mural-paused",muralPaused||reduced||!muralSettings.auto);
  box.querySelector("[data-mural-controls]").hidden=slides.length<2&&(reduced||!muralSettings.auto);
  for(const control of box.querySelectorAll("[data-mural-step],[data-mural-position]"))control.hidden=slides.length<2;
@@ -5899,13 +5970,20 @@ function downloadMuralFile(id){
  }catch{toast("Não foi possível baixar o anexo.",true);}
 }
 function muralQuickBar(){
- if(!canManageMural())return "";
+ if(!canManageMural()&&!canManageExternal())return "";
  return `<section class="card noprint" data-custom-area="mural-quick" aria-label="Edição rápida">
  <div class="arena-list-heading"><h2>Edição rápida</h2>${gameBarSettingsButton("mural-quick")}</div>
- <div class="toolbar"><button type="button" data-section="mural">Abrir Comunicação</button></div>
+ <div class="toolbar">${canManageMural()?'<button type="button" data-section="mural">Abrir Comunicação</button>':""}
+ ${canManageMural()&&canAdjustBars()?'<button type="button" data-mural-open-config>Configurar rodízio</button>':""}
+ ${canManageExternal()?'<button type="button" data-section="externalSports">Publicação esportiva</button>':""}</div>
  </section>`;
 }
+document.addEventListener("click",event=>{
+ if(!event.target.closest("[data-mural-open-config]")||!canManageMural()||!canAdjustBars())return;
+ section="mural";selected="";render();showGameBarSettings("mural-display");
+});
 function muralSettingsForm(){
+ if(!canAdjustBars())return "";
  const fields=[["auto","Rodízio automático"],["results","Mostrar todos os resultados"],["agenda","Mostrar agenda"],["partners","Mostrar parceiros"],["news","Mostrar notícias da Agência Brasil"]];
  return `<section class="card arena-mural-config" data-custom-area="mural-display"><div class="arena-list-heading"><h2>Rodízio do mural</h2>${gameBarSettingsButton("mural-display")}</div><details><summary>Configurar visor público</summary><form id="arenaMuralSettings">
  <label>Mensagem de boas-vindas<input name="title" maxlength="100" required value="${esc(muralSettings.title)}"></label>
@@ -5913,6 +5991,8 @@ function muralSettingsForm(){
  <label>Segundos por tela<input name="seconds" type="number" min="3" max="60" required value="${esc(muralSettings.seconds)}"></label>
  <label>Sequência<select name="sequence">${([["interleave","Intercalar recados e jogos"],["notices","Recados e notícias primeiro"],["games","Jogos primeiro"]]).map(([value,label])=>`<option value="${value}" ${muralSettings.sequence===value?"selected":""}>${label}</option>`).join("")}</select></label>
  <label>Transição<select name="transition">${([["random","Variar efeitos"],["fade","Desvanecer"],["rise","Subir"],["slide","Deslizar"],["none","Sem efeito"]]).map(([value,label])=>`<option value="${value}" ${muralSettings.transition===value?"selected":""}>${label}</option>`).join("")}</select></label>
+ <label>Movimento da bola<select name="ballMotion">${[["random","Aleatório"],["horizontal","Horizontal"],["off","Parada"]].map(([value,label])=>`<option value="${value}" ${muralSettings.ballMotion===value?"selected":""}>${label}</option>`).join("")}</select></label>
+ <label>Segundos por percurso da bola<input name="ballSeconds" type="number" min="1" max="15" required value="${esc(muralSettings.ballSeconds)}"></label>
  <label>Cor do visor<input name="accent" type="color" value="${esc(muralSettings.accent)}"></label>
  ${fields.map(([id,label])=>`<label class="confirmation-check"><input type="checkbox" name="${id}" ${muralSettings[id]?"checked":""}> ${label}</label>`).join("")}
  <div class="toolbar"><button type="submit" class="primary">Salvar visor</button><button type="button" data-mural-settings-default>Restaurar valores padrão</button></div>
@@ -5928,7 +6008,7 @@ function fillMuralSettings(form,values){
 document.addEventListener("submit",async event=>{
  const form=event.target;if(form.id!=="arenaMuralSettings")return;
  event.preventDefault();
- if(!canManageMural()||!cloud)return;
+ if(!canManageMural()||!canAdjustBars()||!cloud)return;
  const values={};
  for(const key of Object.keys(muralDefaults)){
   const input=form.elements.namedItem(key);
@@ -6971,6 +7051,8 @@ document.addEventListener("click",e=>{
 let navigationQuery="";
 const expandedNavigation=new Set();
 const navigationDescriptions={
+ mural:{label:"Mural de recados",description:"Publique recados da comunidade escolar.",keywords:"comunicação mural recados avisos rodízio"},
+ externalSports:{label:"Publicação esportiva",description:"Gerencie placares e notícias de competições externas.",keywords:"comunicação notícias placares externos"},
  reportCenter:{label:"Central de Relatórios",description:"Veja jogos, equipes e cartões recentes.",keywords:"placar resumo jogos equipes cartões relatório pdf"},
  operation:{label:"Cabine de Operação",description:"Escolha um jogo autorizado e use os atalhos de placar e tempo.",keywords:"operacao cabine ao vivo pontos goles cronometro"},
  qrCodes:{label:"QR codes e links",description:"Copiar links e baixar QR codes públicos do Arena e dos campeonatos.",keywords:"qr qrcode qr code compartilhar link publico logo svg"},
@@ -7472,6 +7554,7 @@ function personalTopShortcuts() {
   return `<section class="personal-shortcuts noprint" aria-label="Meus atalhos"><div class="toolbar"><strong>Meus atalhos</strong>${data.pins.map(id=>button(id)).join("")}<button type="button" data-personal-settings class="arena-icon-action">${arenaIcon("star")}<span>Escolher atalhos e favoritos</span></button>${admin?'<a class="button" href="./index.html" target="_blank" rel="noopener">Painel público ↗</a>':""}</div>${data.favorites.length?`<div class="toolbar" aria-label="Favoritos">${data.favorites.map(id=>button(id,true)).join("")}</div>`:""}<small>Clique com o botão direito ou mantenha pressionado um atalho para ajustar. Use Escolher atalhos e favoritos para organizar a barra.</small></section>`;
 }
 function personalTarget(el) {
+  if(!canAdjustBars())return null;
   if(el?.closest?.("#arenaTopMatchMonitor"))return {id:"game-bar:games"};
   const area=el?.closest?.("[data-custom-area]");
   if(area && !el.closest("button[data-section],button[data-public-area],input,select,textarea"))
@@ -7486,7 +7569,8 @@ function applyPersonalColors() {
   applyGameBarPreferences(prefs.gameBar);
   const weather=document.querySelector(".arena-weather-card");
   if(weather)weather.dataset.customArea="weather";
-  if(weather && !weather.querySelector("[data-game-bar-settings]")){
+  if(weather && !canAdjustBars())weather.querySelector("[data-game-bar-settings]")?.remove();
+  if(weather && canAdjustBars() && !weather.querySelector("[data-game-bar-settings]")){
     weather.insertAdjacentHTML("beforeend",gameBarSettingsButton("weather"));
   }
   for(const area of document.querySelectorAll("[data-custom-area]"))
diff --git a/spark-store.js b/spark-store.js
index 3f3c76a..ddfc5e1 100644
--- a/spark-store.js
+++ b/spark-store.js
@@ -1116,7 +1116,7 @@ export async function connectSpark({
       const before = snap.data();
       if (before.deleted === true) throw Error("Este operador foi removido e está disponível apenas para consulta.");
       const granted=access==="active"?[...new Set(permissions===undefined?(before.permissions||[]):permissions)]:[];
-      if(granted.some(p=>!["rosters","matchesCreate","championships","gamesView","historyCorrections","editMatchPhases","correctMatchSport","operateAllGames","hidePublicGames","muralPublish","externalScores","externalNews"].includes(p)))throw Error("Permissão específica inválida.");
+      if(granted.some(p=>!["rosters","matchesCreate","championships","gamesView","historyCorrections","editMatchPhases","correctMatchSport","operateAllGames","hidePublicGames","muralPublish","externalScores","externalNews","adjustBars"].includes(p)))throw Error("Permissão específica inválida.");
       const editions = access === "active"
         ? [...new Set(followedEditions ?? before.followedEditions ?? [])] : [];
       const known = new Set(state.championships.map((c) => c.name + " • " + c.season));
@@ -1256,6 +1256,14 @@ export async function connectSpark({
   }
   const canPublishMural = () => isOwner() || (authorized() && (profile?.permissions || []).includes("muralPublish"));
   return {
+    watchAudienceAppearance(update) {
+      return F.onSnapshot(F.doc(database,"audienceAppearance","main"),snap=>update(snap.data()||{}),()=>update({}));
+    },
+    async saveAudienceAppearance(values) {
+      if(!isOwner()&&!(authorized()&&(profile?.permissions||[]).includes("adjustBars")))
+        throw Error("Sem autorização para personalizar barras.");
+      await F.setDoc(F.doc(database,"audienceAppearance","main"),values);
+    },
     watchExternalSports(kind,update) {
       return F.onSnapshot(F.doc(database,"externalSports",kind),snapshot=>update(snapshot.data()?.enabled===true),()=>update(false));
     },
@@ -1269,7 +1277,7 @@ export async function connectSpark({
       return F.onSnapshot(F.doc(database,"muralDisplay","main"),snap=>update(snap.data()||{}),()=>{});
     },
     async saveMuralSettings(values) {
-      if(!canPublishMural())throw Error("Sem autorização para configurar o mural.");
+      if(!canPublishMural()||(!isOwner()&&!(profile?.permissions||[]).includes("adjustBars")))throw Error("Sem autorização para configurar o mural.");
       await F.setDoc(F.doc(database,"muralDisplay","main"),values);
     },
     watchMural(manage, update, onFailure) {
diff --git a/style.css b/style.css
index 1602228..df55406 100644
--- a/style.css
+++ b/style.css
@@ -3310,3 +3310,67 @@ body.arena-layout-v2 .arena-function-search[data-custom-area="search"].arena-gam
 .arena-external-score { min-width:0; border:1px solid var(--line); border-radius:12px; padding:12px; background:var(--bg); overflow-wrap:anywhere; }
 .arena-external-score h3 { margin-block:.45em; }
 .arena-external-score b { display:inline-block; padding-inline:.35em; color:var(--text); }
+
+.arena-mural-school-heading { margin:16px 0 6px; }
+[data-external-sports].arena-mural-external {
+  border:0;
+  border-block-start:1px solid var(--line);
+  padding-block-start:16px;
+  margin:20px 0 0;
+}
+.arena-mural-external h2 { margin-block:0 12px; }
+@media (prefers-reduced-motion:no-preference) {
+  :root:not(.reduce-motion) [data-mural-public]:not([data-mural-paused]) [data-ball-motion="random"] i {
+    animation:arena-mural-random-ball var(--arena-ball-cycle,3s) ease-in-out infinite;
+  }
+  :root:not(.reduce-motion) [data-mural-public]:not([data-mural-paused]) [data-ball-motion="horizontal"] i {
+    animation-duration:var(--arena-ball-cycle,3s);
+  }
+  :root:not(.reduce-motion) [data-mural-public]:not([data-mural-paused]) [data-ball-motion="off"] i { animation:none; }
+}
+@keyframes arena-mural-random-ball {
+  0%,100% { transform:translate(0,0); }
+  25% { transform:translate(var(--arena-ball-x1),var(--arena-ball-y1)); }
+  50% { transform:translate(var(--arena-ball-x2),var(--arena-ball-y2)); }
+  75% { transform:translate(var(--arena-ball-x3),var(--arena-ball-y3)); }
+}
+
+[data-external-sports] .arena-external-scores {
+  display:grid;
+  grid-template-columns:none;
+  grid-auto-flow:column;
+  grid-auto-columns:min(100%,19rem);
+  overflow-x:auto;
+  scroll-snap-type:x mandatory;
+  padding-block:4px 10px;
+}
+[data-external-sports] .arena-external-score { scroll-snap-align:start; }
+.arena-external-match {
+  display:grid;
+  grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
+  align-items:center;
+  gap:4px;
+  text-align:center;
+  margin-block:10px;
+}
+.arena-external-match b { font-size:1.4rem; white-space:nowrap; }
+[data-external-sports] arena-news ul { list-style:none; padding:0; }
+[data-external-sports] arena-news li + li { margin-block-start:8px; }
+[data-external-sports] arena-news li a {
+  display:inline-flex;
+  align-items:center;
+  min-block-size:44px;
+  overflow-wrap:anywhere;
+  text-underline-offset:3px;
+}
+[data-external-step] { min-inline-size:44px; }
+
+.public-audience-badge svg {
+  inline-size:var(--arena-eye-size,24px);
+  block-size:var(--arena-eye-size,24px);
+  flex:none;
+}
+@media (prefers-reduced-motion:no-preference) {
+  :root:not(.reduce-motion) .public-audience-badge svg { animation-duration:var(--arena-eye-seconds,5s); }
+  :root[data-arena-eye-still] .public-audience-badge svg { animation:none; }
+}
'@
    $app = [IO.File]::ReadAllText((Resolve-Path -LiteralPath 'app.js').Path)
    if (-not $app.Contains('body:muralSettings.subtitle,area:"schedule"')) {
        $patch = $patch.Replace('body:muralSettings.subtitle,area:"schedule"', 'body:muralSettings.subtitle')
    }
    [IO.File]::WriteAllText($temp, ($patch -replace '\r\n', "`n") + "`n", $utf8)
    git apply --check $temp
    if ($LASTEXITCODE -ne 0) { throw 'O codigo local do mural difere da versao esperada. Nenhum arquivo foi alterado.' }
    git apply $temp
    if ($LASTEXITCODE -ne 0) { throw 'O Git interrompeu a aplicacao.' }
    foreach ($update in $updates) {
        [IO.File]::WriteAllText($update.Path,$update.Content,$utf8)
    }
    Write-Host 'Mural atualizado.'
} finally {
    Remove-Item -LiteralPath $temp
}
