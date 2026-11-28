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
    $html = [regex]::Replace($html,$pattern,'${prefix}?v=esportes-externos-1')
    $css = '(?<prefix>\bhref\s*=\s*["''](?:\./)?style\.css)(?:\?v=[^"'']*)?(?=["''])'
    if ([regex]::Matches($html,$css).Count -ne 1) { throw ('Referencia ao style.css nao encontrada em ' + $file) }
    $html = [regex]::Replace($html,$css,'${prefix}?v=esportes-externos-1')
    $news = '(?<prefix>\bsrc\s*=\s*["''](?:\./)?arena-noticias\.js)(?:\?v=[^"'']*)?(?=["''])'
    $weather = '(?<prefix>\bsrc\s*=\s*["''](?:\./)?arena-weather\.js)(?:\?v=[^"'']*)?(?=["''])'
    if ([regex]::Matches($html,$weather).Count -ne 1) { throw ('Referencia ao clima nao encontrada em ' + $file) }
    $html = [regex]::Replace($html,$weather,'${prefix}?v=esportes-externos-1')
    $html = [regex]::Replace($html,$news,'${prefix}?v=esportes-externos-1')
    if ($file -eq 'painel.html' -and -not [regex]::IsMatch($html,$news)) {
        $marker = [regex]::new('(?i)</head>')
        if ($marker.Matches($html).Count -ne 1) { throw 'Cabecalho do painel nao identificado.' }
        $html = $marker.Replace($html,'<script src="arena-noticias.js?v=esportes-externos-1" defer></script>' + [Environment]::NewLine + '</head>',1)
    }
    $updates += @{Path=$path; Content=$html}
}
$cssPath = (Resolve-Path -LiteralPath 'style.css').Path
$stylesheet = [IO.File]::ReadAllText($cssPath)
$extraCss = @'
[data-mural-public] {
  box-shadow:0 10px 36px color-mix(in srgb,var(--arena-mural-accent,var(--accent)) 13%,transparent);
}
[data-mural-effect="none"] .arena-mural-frame { animation:none; }
.arena-weather-card[data-weather-motion] #arenaWeather[data-weather-icon] [data-weather-summary]::before {
  font-size:var(--arena-weather-icon-size,30px);
  line-height:1.1;
  vertical-align:middle;
}
@media (prefers-reduced-motion:no-preference) {
  :root:not(.reduce-motion) .arena-weather-card[data-weather-motion="drift"] #arenaWeather[data-weather-icon] [data-weather-summary]::before {
    animation:arena-weather-drift var(--arena-weather-icon-seconds,3s) ease-in-out infinite alternate;
  }
  :root:not(.reduce-motion) .arena-weather-card[data-weather-motion="pulse"] #arenaWeather[data-weather-icon] [data-weather-summary]::before {
    animation:arena-weather-icon-pulse var(--arena-weather-icon-seconds,3s) ease-in-out infinite alternate;
  }
}
.arena-weather-card[data-weather-motion="off"] #arenaWeather[data-weather-icon] [data-weather-summary]::before { animation:none; }
@keyframes arena-weather-drift { from { transform:translate(-2px,0); } to { transform:translate(3px,-3px); } }
@keyframes arena-weather-icon-pulse { from { transform:scale(.9); } to { transform:scale(1.1); } }

[data-external-sports]:not([hidden]) { margin-block:16px; border-inline-start:4px solid var(--accent); }
[data-external-sports] > section + section { margin-block-start:16px; border-block-start:1px solid var(--line); padding-block-start:12px; }
.arena-external-scores { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr)); gap:10px; }
.arena-external-score { min-width:0; border:1px solid var(--line); border-radius:12px; padding:12px; background:var(--bg); overflow-wrap:anywhere; }
.arena-external-score h3 { margin-block:.45em; }
.arena-external-score b { display:inline-block; padding-inline:.35em; color:var(--text); }
'@
if (-not $stylesheet.Contains('@keyframes arena-weather-drift')) {
    $nl = if ($stylesheet.Contains("`r`n")) { "`r`n" } else { "`n" }
    $updates += @{Path=$cssPath; Content=$stylesheet + $nl + $nl + ($extraCss -replace '\r?\n',$nl) + $nl}
}
$temp = [IO.Path]::GetTempFileName()
try {
    $patch = @'
diff --git a/.github/scripts/atualizar-placares.py b/.github/scripts/atualizar-placares.py
new file mode 100644
index 0000000..284f144
--- /dev/null
+++ b/.github/scripts/atualizar-placares.py
@@ -0,0 +1,36 @@
+import json
+import os
+import sys
+from datetime import datetime, timezone
+from urllib.parse import urlencode
+from urllib.request import Request, urlopen
+from zoneinfo import ZoneInfo
+
+key = os.environ.get("ARENA_FOOTBALL_KEY")
+if not key:
+    raise SystemExit("Configure o segredo ARENA_FOOTBALL_KEY.")
+day = datetime.now(ZoneInfo("America/Sao_Paulo")).date().isoformat()
+params = urlencode({"date": day, "timezone": "America/Sao_Paulo"})
+request = Request("https://v3.football.api-sports.io/fixtures?" + params,
+                  headers={"x-apisports-key": key})
+with urlopen(request, timeout=25) as response:
+    data = json.load(response)
+if data.get("errors") or not isinstance(data.get("response"), list):
+    raise SystemExit("A fonte de placares recusou a consulta. Confira o plano e a cota.")
+competitions = {71: "Brasileirão Série A", 475: "Paulista", 13: "Libertadores"}
+rows = []
+for item in data["response"]:
+    league, fixture, teams, goals = (item[key] for key in ("league", "fixture", "teams", "goals"))
+    competition = competitions.get(league["id"])
+    if not competition and league.get("country") == "Brazil" and league["name"] in {"Paulista - A1", "Paulista A1"}:
+        competition = "Paulista"
+    if not competition:
+        continue
+    rows.append({"league": competition, "round": league.get("round", ""),
+                 "home": teams["home"]["name"], "away": teams["away"]["name"],
+                 "date": fixture["date"], "status": fixture["status"]["short"],
+                 "minute": fixture["status"].get("elapsed"),
+                 "score": [goals["home"], goals["away"]]})
+with open(sys.argv[1], "w", encoding="utf-8") as file:
+    json.dump({"day": day, "updatedAt": datetime.now(timezone.utc).isoformat(),
+               "games": sorted(rows, key=lambda row: row["date"])}, file, ensure_ascii=False)
diff --git a/.github/workflows/placares-externos.yml b/.github/workflows/placares-externos.yml
new file mode 100644
index 0000000..1429402
--- /dev/null
+++ b/.github/workflows/placares-externos.yml
@@ -0,0 +1,38 @@
+name: Atualizar placares externos
+on:
+  schedule:
+    - cron: '7,27,47 * * * *'
+  workflow_dispatch:
+
+permissions:
+  contents: write
+
+concurrency:
+  group: placares-externos
+
+jobs:
+  atualizar:
+    runs-on: ubuntu-latest
+    timeout-minutes: 5
+    steps:
+      - uses: actions/checkout@v4
+      - name: Consultar API-Football
+        env:
+          ARENA_FOOTBALL_KEY: ${{ secrets.ARENA_FOOTBALL_KEY }}
+        run: python3 .github/scripts/atualizar-placares.py "$RUNNER_TEMP/placares.json"
+      - name: Publicar dados em branch própria
+        shell: bash
+        run: |
+          branch=arena-dados-placares
+          git config user.name "github-actions[bot]"
+          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
+          if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
+            git fetch origin "$branch"
+            git switch --detach FETCH_HEAD
+          else
+            git switch --orphan "$branch"
+          fi
+          cp "$RUNNER_TEMP/placares.json" placares.json
+          git add placares.json
+          git commit -m "Atualiza placares externos"
+          git push origin "HEAD:refs/heads/$branch"
diff --git a/app.js b/app.js
index 6968df1..8824988 100644
--- a/app.js
+++ b/app.js
@@ -1463,6 +1463,13 @@ function gameBarSettingsButton(key="games") {
 }
 function applyGameBarPreferences(prefs, bar=$("#arenaTopMatchMonitor")) {
   if(!bar)return;
+  if(bar.dataset.customArea==="weather"){
+    const size=Number(prefs.iconSize),seconds=Number(prefs.iconSeconds);
+    if(size>=16&&size<=56)bar.style.setProperty("--arena-weather-icon-size",size+"px");
+    else bar.style.removeProperty("--arena-weather-icon-size");
+    bar.style.setProperty("--arena-weather-icon-seconds",(seconds>=1&&seconds<=12?seconds:3)+"s");
+    bar.dataset.weatherMotion=["drift","pulse","off"].includes(prefs.weatherMotion)?prefs.weatherMotion:"drift";
+  }
   bar.classList.toggle("arena-game-bar-compact",prefs.compact===true);
   bar.style.setProperty("--game-bar-border",/^#[0-9a-f]{6}$/i.test(prefs.color||"")?prefs.color:"var(--accent)");
   bar.classList.toggle("arena-custom-large-buttons",prefs.large===true);
@@ -1487,6 +1494,16 @@ function colorSwatch(value,fallback){
   return rgb ? "#"+rgb.slice(1,4).map(n=>Number(n).toString(16).padStart(2,"0")).join("") : fallback;
 }
 function showGameBarSettings(key="games") {
+  if(key==="mural-display"){
+    if(!canManageMural())return;
+    const details=$("#arenaMuralSettings")?.closest("details");
+    if(details){
+      details.open=true;
+      details.scrollIntoView({block:"nearest"});
+      details.querySelector("summary").focus({preventScroll:true});
+    }
+    return;
+  }
   if($("#arenaGameBarSettings")?.open)return;
   const dialog=document.createElement("dialog");
   dialog.id="arenaGameBarSettings";dialog.className="card";
@@ -1511,6 +1528,11 @@ function showGameBarSettings(key="games") {
   </div>
   <label><input name="compact" type="checkbox" ${prefs.compact?"checked":""}> Espaçamento compacto</label>
   <label><input name="large" type="checkbox" ${prefs.large?"checked":""}> Botões maiores</label>
+  ${key==="weather"?`<fieldset><legend>Ícone da previsão</legend>
+  <label>Tamanho (px)<input name="iconSize" type="number" min="16" max="56" value="${Number(prefs.iconSize)||30}" required></label>
+  <label>Segundos por ciclo<input name="iconSeconds" type="number" min="1" max="12" value="${Number(prefs.iconSeconds)||3}" required></label>
+  <label>Movimento<select name="weatherMotion">${[["drift","Deslizar"],["pulse","Pulsar"],["off","Parado"]].map(([value,label])=>`<option value="${value}" ${(prefs.weatherMotion||"drift")===value?"selected":""}>${label}</option>`).join("")}</select></label>
+  </fieldset>`:""}
   ${key==="games"?`<label><input name="hideLast" type="checkbox" ${prefs.hideLast?"checked":""}> Ocultar último lance</label>`:""}
   <div class="toolbar"><button type="submit" class="primary">Salvar ajustes</button><button type="button" data-game-bar-reset>Restaurar padrão</button></div></form>`;
   dialog.querySelector(".arena-close-x").onclick=()=>dialog.close();
@@ -1534,7 +1556,7 @@ function showGameBarSettings(key="games") {
   }
   form.onsubmit=event=>{
     event.preventDefault();event.stopPropagation();
-    saveGameBar({color:borderChanged?form.elements.color.value:prefs.color||"",background:form.elements.useBackground.checked?form.elements.background.value:"",buttons:form.elements.useButtons.checked?form.elements.buttons.value:"",compact:form.elements.compact.checked,large:form.elements.large.checked,hideLast:form.elements.hideLast?.checked===true});
+    saveGameBar({color:borderChanged?form.elements.color.value:prefs.color||"",background:form.elements.useBackground.checked?form.elements.background.value:"",buttons:form.elements.useButtons.checked?form.elements.buttons.value:"",compact:form.elements.compact.checked,large:form.elements.large.checked,hideLast:form.elements.hideLast?.checked===true,...(key==="weather"?{iconSize:form.elements.iconSize.valueAsNumber,iconSeconds:form.elements.iconSeconds.valueAsNumber,weatherMotion:form.elements.weatherMotion.value}:{})});
   };
   dialog.querySelector("[data-game-bar-reset]").onclick=()=>saveGameBar({});
   dialog.addEventListener("close",()=>{
@@ -1982,7 +2004,7 @@ async function boot() {
   }
   render();
   try {
-    const { connectSpark } = await import("./spark-store.js?v=mural-placares-1");
+    const { connectSpark } = await import("./spark-store.js?v=esportes-externos-1");
     cloud = await connectSpark({
       config: C,
       privateView: admin,
@@ -2255,14 +2277,14 @@ function render() {
   if (admin && !C.demo && (!user || !role)) {
     syncPersonalTools();
     app.innerHTML = accessView();
-    syncMural();
+    syncMural();syncExternalSports();
     closeTimeline();
     if (accessBusy) app.querySelectorAll("button").forEach((b) => b.disabled = true);
     return;
   }
   if (!admin) {
     app.innerHTML = publicPageHTML();
-    syncMural();
+    syncMural();syncExternalSports();
     $("#filter").value = publicFilter;
     if (state.settings.banner)
       $("#hero").style.backgroundImage =
@@ -2271,7 +2293,7 @@ function render() {
     return;
   }
   // Uma sessão rebaixada ou trocada não mantém uma aba administrativa aberta.
-  if (role !== "admin" && !["overview", "matches", "operation", "reportCenter", "audience", "account", "documentation", "qrCodes", "profiles", "preferences", ...(canManageRosters()?["teams","players","coachingStaff","imports"]:[]), ...(canManageChampionships()?["championships"]:[]), ...(canPrepareRegistrationSheets()?["registrationSheets"]:[]), ...(canCreateMatches()?["createMatch"]:[]), ...(canManageMural()?["mural"]:[])].includes(section)) {
+  if (role !== "admin" && !["overview", "matches", "operation", "reportCenter", "audience", "account", "documentation", "qrCodes", "profiles", "preferences", ...(canManageRosters()?["teams","players","coachingStaff","imports"]:[]), ...(canManageChampionships()?["championships"]:[]), ...(canPrepareRegistrationSheets()?["registrationSheets"]:[]), ...(canCreateMatches()?["createMatch"]:[]), ...(canManageMural()?["mural"]:[]),...(canManageExternal()?["externalSports"]:[])].includes(section)) {
     section = "overview";
     selected = "";
   }
@@ -2280,6 +2302,7 @@ function render() {
     ["overview", "Início"],
     ["audience", "Audiência"],
     ...(canManageMural()?[["mural","Mural de recados"]]:[]),
+    ...(canManageExternal()?[["externalSports","Publicação esportiva"]]:[]),
     ["championships", "Campeonatos"],
     ["standings", "Classificação"],
     ["teams", "Equipes"],
@@ -2315,7 +2338,7 @@ function render() {
   app.innerHTML = `${audienceMonitorBar()}${pageControls}${locationTrail()}${workspaceNavigation(sections)}${section==="overview"?muralQuickBar():""}${floatingGameClock()}<div class="sectionhead admin-heading noprint" data-custom-area="title:${esc(section)}"><div><span class="tag">${esc(panelDisplayName())}</span><h1 tabindex="-1">${esc(selected && isOperationSection() ? "Operação de partida" : sections.find(([id])=>id===section)?.[1] || "Visão geral")}</h1><p class="muted">${esc(navigationDescriptions[section]?.description || "Organize o evento e acompanhe os jogos.")}</p></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span>${gameBarSettingsButton("title:"+section)}</div>${section==="overview"?`${accountPendingBanner()}<div class="noprint">${liveStatusPanel("admin")}</div>`:""}<div id="view">${role==="operator" && section==="overview"?operatorStartPanel():""}${view()}</div>${relatedArenaScreens()}`;
   if(muralForm)$("#arenaMuralForm")?.replaceWith(muralForm);
   if(muralConfig)$("#arenaMuralSettings")?.closest("details").replaceWith(muralConfig);
-  syncMural();
+  syncMural();syncExternalSports();
   audienceMonitorObserver?.disconnect();
   const audienceMonitor = app.querySelector(".arena-audience-monitor");
   if (audienceMonitor) audienceMonitorObserver?.observe(audienceMonitor);
@@ -2346,12 +2369,74 @@ function render() {
       : sportsReportPreview() + sportsDetailScreen();
   }
 }
+const externalSportsConfig={
+ scores:{permission:"externalScores",label:"Placares externos"},
+ news:{permission:"externalNews",label:"Notícias esportivas externas"}
+};
+let externalSports={},externalSportsScope="",externalSportsStops=[],externalScoresRequest,externalScoresData;
+const canEditExternal=kind=>!C.demo&&(role==="admin"||(role==="operator"&&operatorPermissions.includes(externalSportsConfig[kind].permission)));
+const canManageExternal=()=>Object.keys(externalSportsConfig).some(canEditExternal);
+function externalSportsPanel(manage){
+ if(C.demo||manage&&!canManageExternal())return "";
+ return `<section class="card" data-external-sports="${manage?"manage":"public"}" ${manage?"":"hidden"}></section>`;
+}
+function updateExternalSports(){
+ const panel=app.querySelector("[data-external-sports]");if(!panel)return;
+ const manage=panel.dataset.externalSports==="manage";
+ const kinds=Object.keys(externalSportsConfig).filter(kind=>manage?canEditExternal(kind):externalSports[kind]);
+ panel.hidden=!kinds.length;
+ if(!kinds.length)return;
+ const data=externalScoresData;
+ const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo"}).format(new Date());
+ const fresh=data?.day===today;
+ const age=data?.updatedAt?Date.now()-Date.parse(data.updatedAt):Infinity;
+ const live=["1H","HT","2H","ET","BT","P","LIVE"];
+ const scores=fresh&&data.games.length?data.games.map(game=>{
+  const status=live.includes(game.status)?(age<=35*60000?"Em andamento":"Placar sem atualização recente"):
+   ["FT","AET","PEN"].includes(game.status)?"Encerrado":({NS:"Agendado",TBD:"Horário a definir",PST:"Adiado",CANC:"Cancelado",SUSP:"Suspenso",INT:"Interrompido"}[game.status]||"Consulte a fonte");
+  const score=game.score.every(Number.isInteger)?game.score.join(" × "):"×";
+  return `<article class="arena-external-score"><small>${esc(game.league)}${game.round?" · "+esc(game.round):""}</small><h3>${esc(game.home)} <b>${esc(score)}</b> ${esc(game.away)}</h3><p>${esc(status)}${game.status==="NS"&&game.date?" · "+esc(format(game.date)):""}${live.includes(game.status)&&age<=35*60000&&Number.isInteger(game.minute)?" · "+game.minute+"′":""}</p></article>`;
+ }).join(""):`<p>${!data?"Placares indisponíveis no momento.":fresh?"Nenhuma partida publicada para hoje nas competições acompanhadas.":"Aguardando a atualização dos jogos de hoje."}</p>`;
+ const markup=`<h2>${manage?"Publicação esportiva":"Futebol pelo Brasil e pela América"}</h2>${kinds.map(kind=>`<section><h3>${externalSportsConfig[kind].label}</h3>${manage?`<button type="button" data-external-toggle="${kind}" aria-pressed="${Boolean(externalSports[kind])}">${externalSports[kind]?"Retirar do painel público":"Exibir no painel público"}</button>`:""}${kind==="scores"?`<p class="muted">Brasileirão Série A, Paulista e Libertadores · API-Football${data?.updatedAt?" · Consulta em "+esc(format(data.updatedAt)):""}</p><div class="arena-external-scores">${scores}</div>`:`<arena-news>Carregando manchetes…</arena-news><p><a href="https://agenciabrasil.ebc.com.br/esportes" target="_blank" rel="noopener noreferrer">Agência Brasil · Esportes ↗</a></p>`}</section>`).join("")}`;
+ if(panel.dataset.content!==markup){panel.innerHTML=markup;panel.dataset.content=markup;}
+ if(kinds.includes("scores")&&!externalScoresRequest){
+  externalScoresRequest=fetch("https://raw.githubusercontent.com/wagnerbizza/arena-esportiva/arena-dados-placares/placares.json",{cache:"no-store",signal:AbortSignal.timeout(8000)})
+   .then(response=>response.ok?response.json():null).then(payload=>{if(Array.isArray(payload?.games))externalScoresData=payload;})
+   .catch(()=>{}).finally(()=>updateExternalSports());
+ }
+}
+function syncExternalSports(){
+ const scope=cloud&&!C.demo?admin?(user?.uid||""):"public":"";
+ if(scope!==externalSportsScope){
+  externalSportsStops.forEach(stop=>stop());externalSportsStops=[];externalSports={};externalSportsScope=scope;
+  if(scope)for(const kind of Object.keys(externalSportsConfig))externalSportsStops.push(cloud.watchExternalSports(kind,enabled=>{
+   if(scope!==externalSportsScope)return;
+   externalSports[kind]=enabled;updateExternalSports();
+   if(!admin&&kind==="news")showMuralSlide();
+  }));
+ }
+ updateExternalSports();
+}
+setInterval(()=>{
+ if(document.hidden||!app.querySelector("[data-external-sports]:not([hidden])"))return;
+ externalScoresRequest=null;updateExternalSports();
+},120000);
+document.addEventListener("click",async event=>{
+ const control=event.target.closest("[data-external-toggle]");if(!control||control.disabled)return;
+ const kind=control.dataset.externalToggle;
+ if(!Object.hasOwn(externalSportsConfig,kind)||!canEditExternal(kind)||!cloud)return;
+ control.disabled=true;
+ try{await cloud.setExternalSports(kind,!externalSports[kind]);toast("Publicação esportiva atualizada.");}
+ catch(error){toast(error.message||"Não foi possível salvar.",true);}
+ finally{control.disabled=false;}
+});
+
 function publicPageHTML() {
   return `<section class="hero" id="hero"><span class="tag">CENTRAL DE RESULTADOS / TEMPORADA</span><h1>${esc(publicEdition || systemDisplayName())}</h1><p class="muted">${esc(state.settings.subtitle)}</p></section>${C.demo ? "" : shareEditionControls(publicEdition)}${liveStatusPanel("public")}${muralPublicCard()}<div class="sectionhead"><div><h2>Acompanhe os jogos</h2>${C.demo?"":`<p class="public-audience-badge" data-public-audience>${publicAudienceBadge()}</p>`}</div><select id="filter" aria-label="Filtrar modalidade"><option value="">Todas as modalidades</option>${options(
       D.SPORTS,
       (x) => x,
       (x) => x,
-    )}</select></div>${documentBrandingMarkup("publicPanel","header")}${publicHub()}${partnerMarkup("publicPanel")}`;
+    )}</select></div>${documentBrandingMarkup("publicPanel","header")}${externalSportsPanel(false)}${publicHub()}${partnerMarkup("publicPanel")}`;
 }
 function publicMatches(filter) {
   const list = state.matches.filter(m=>(!filter||m.sport===filter)&&
@@ -2372,6 +2457,7 @@ function publicMatches(filter) {
       : empty("Nenhuma partida publicada para esta seleção.");
 }
 function view() {
+  if(section==="externalSports")return externalSportsPanel(true);
   if(section==="mural")return canManageMural()?muralManage():empty("Mural indisponível para este perfil.");
   if(section==="operation")return cabinView();
   if(section==="reportCenter")return reportCenter();
@@ -3742,6 +3828,8 @@ function updateOperationSummary(form) {
     ["championshipPermission", "Criar e editar campeonatos"],
     ["matchCreatePermission", "Criar jogos"],
     ["muralPublishPermission","Publicar no mural"],
+    ["externalScores","Publicar placares externos"],
+    ["externalNews","Publicar notícias externas"],
     ["gamesViewPermission", "Consultar todos os jogos publicados"],
     ["historyCorrectPermission", "Anular lances nos jogos liberados"],
     ["phaseEditPermission", "Editar grupos e chaves nos campeonatos liberados"],
@@ -3855,7 +3943,7 @@ function operatorAuthorizationGroups(operator,editionOptions) {
   `<label class="confirmation-check"><input type="checkbox" name="phaseEditPermission" ${checked("editMatchPhases")}><span>Mudar fase, grupo, chave ou rodada.</span></label>`,permissions.includes("editMatchPhases")?1:0);
  const registrations=authorizationSection("records","Fazer cadastros","Cada caixa libera um cadastro. Para operar um jogo criado, marque o jogo ou seu campeonato nas opções acima.",`<label class="confirmation-check"><input type="checkbox" name="rosterPermission" ${checked("rosters")}><span>Criar, editar e importar equipes e jogadores.</span></label><label class="confirmation-check"><input type="checkbox" name="championshipPermission" ${checked("championships")}><span>Criar e editar campeonatos e temporadas.</span></label><label class="confirmation-check"><input type="checkbox" name="matchCreatePermission" ${checked("matchesCreate")}><span>Criar novos jogos.</span></label>`,permissions.filter(id=>["rosters","championships","matchesCreate"].includes(id)).length);
  const viewing=authorizationSection("view","Só consultar jogos","As opções abaixo liberam consulta. Para registrar lances, use Operar campeonatos ou Operar jogos avulsos.",`<fieldset><legend>Campeonatos para consultar</legend>${editionOptions}<label class="confirmation-check"><input type="checkbox" name="gamesViewPermission" ${checked("gamesView")}><span>Consultar todos os jogos publicados.</span></label></fieldset>`,(operator.followedEditions||[]).length+(permissions.includes("gamesView")?1:0));
- return `${operateAll}${authorizationSection("mural","Mural de recados","Publicação de recados gerais, independentemente dos jogos.",`<label class="confirmation-check"><input type="checkbox" name="muralPublishPermission" ${checked("muralPublish")}><span>Publicar no mural</span></label>`,permissions.includes("muralPublish")?1:0)}<div class="toolbar"><button type="button" data-permissions-expand="true">Expandir autorizações</button><button type="button" data-permissions-expand="false">Recolher autorizações</button></div>${operations}${matches}${publication}${history}${sportCorrection}${phases}${registrations}${viewing}`;
+ return `${operateAll}${authorizationSection("external-sports","Publicação esportiva externa","Delegue cada tipo de publicação separadamente.",Object.entries(externalSportsConfig).map(([kind,item])=>`<label class="confirmation-check"><input type="checkbox" name="${item.permission}" ${checked(item.permission)}><span>Publicar ${item.label.toLowerCase()}</span></label>`).join(""),Object.values(externalSportsConfig).filter(item=>permissions.includes(item.permission)).length)}${authorizationSection("mural","Mural de recados","Publicação de recados gerais, independentemente dos jogos.",`<label class="confirmation-check"><input type="checkbox" name="muralPublishPermission" ${checked("muralPublish")}><span>Publicar no mural</span></label>`,permissions.includes("muralPublish")?1:0)}<div class="toolbar"><button type="button" data-permissions-expand="true">Expandir autorizações</button><button type="button" data-permissions-expand="false">Recolher autorizações</button></div>${operations}${matches}${publication}${history}${sportCorrection}${phases}${registrations}${viewing}`;
 }
 document.addEventListener("click",event=>{
  const button=event.target.closest("[data-permissions-expand]");if(!button||role!=="admin")return;
@@ -3891,7 +3979,7 @@ function usersView() {
     permissions.includes("championships") && "Campeonatos",
     permissions.includes("matchesCreate") && "Novas partidas",
   ].filter(Boolean).join(", ") || "Nenhum";
-  const permissionNames={muralPublish:"Publicar no mural",hidePublicGames:"Ocultar jogos do público",operateAllGames:"Operar tudo",rosters:"Equipes e jogadores",championships:"Campeonatos",matchesCreate:"Novas partidas",gamesView:"Acompanhar todos os jogos",historyCorrections:"Anular lances com justificativa",editMatchPhases:"Editar grupos e chaves",correctMatchSport:"Corrigir modalidade dos jogos liberados"};
+  const permissionNames={externalScores:"Publicar placares externos",externalNews:"Publicar notícias externas",muralPublish:"Publicar no mural",hidePublicGames:"Ocultar jogos do público",operateAllGames:"Operar tudo",rosters:"Equipes e jogadores",championships:"Campeonatos",matchesCreate:"Novas partidas",gamesView:"Acompanhar todos os jogos",historyCorrections:"Anular lances com justificativa",editMatchPhases:"Editar grupos e chaves",correctMatchSport:"Corrigir modalidade dos jogos liberados"};
   const accessAuditRows=(state.accessAudit||[]).slice().sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
   const accessAuditDate=value=>value?.toDate?.().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})||"Aguardando confirmação do servidor";
   const accessAuditValue=(key,value)=>{
@@ -3977,7 +4065,7 @@ document.addEventListener("submit", async (e) => {
           toast(user?.emailVerified ? "Solicitação registrada. Aguarde a aprovação do administrador principal." : "Solicitação registrada. Confira a confirmação enviada ao seu e-mail.");
         } else {
           await cloud.manageUser({userId:d.userId, access:d.access,
-            matches: new FormData(f).getAll("assignedMatches"), followedEditions: new FormData(f).getAll("followedEditions"), operatedChampionships: new FormData(f).getAll("operatedChampionships"), permissions:[...(f.elements.muralPublishPermission?.checked?["muralPublish"]:[]),...(f.elements.hidePublicPermission.checked?["hidePublicGames"]:[]),...(f.elements.operateAllPermission.checked?["operateAllGames"]:[]),...(f.elements.rosterPermission.checked?["rosters"]:[]),...(f.elements.matchCreatePermission.checked?["matchesCreate"]:[]),...(f.elements.championshipPermission.checked?["championships"]:[]),...(f.elements.gamesViewPermission.checked?["gamesView"]:[]),...(f.elements.historyCorrectPermission.checked?["historyCorrections"]:[]),...(f.elements.phaseEditPermission.checked?["editMatchPhases"]:[]),...(f.elements.matchSportCorrectionPermission.checked?["correctMatchSport"]:[])], reason:d.reason});
+            matches: new FormData(f).getAll("assignedMatches"), followedEditions: new FormData(f).getAll("followedEditions"), operatedChampionships: new FormData(f).getAll("operatedChampionships"), permissions:[...Object.values(externalSportsConfig).filter(item=>f.elements[item.permission]?.checked).map(item=>item.permission),...(f.elements.muralPublishPermission?.checked?["muralPublish"]:[]),...(f.elements.hidePublicPermission.checked?["hidePublicGames"]:[]),...(f.elements.operateAllPermission.checked?["operateAllGames"]:[]),...(f.elements.rosterPermission.checked?["rosters"]:[]),...(f.elements.matchCreatePermission.checked?["matchesCreate"]:[]),...(f.elements.championshipPermission.checked?["championships"]:[]),...(f.elements.gamesViewPermission.checked?["gamesView"]:[]),...(f.elements.historyCorrectPermission.checked?["historyCorrections"]:[]),...(f.elements.phaseEditPermission.checked?["editMatchPhases"]:[]),...(f.elements.matchSportCorrectionPermission.checked?["correctMatchSport"]:[])], reason:d.reason});
           managedUserId = "";
           toast("Permissões salvas e registradas no histórico.");
         }
@@ -5397,7 +5485,7 @@ document.addEventListener("click",async event=>{
 
 // 21 — Organização da central. Permissões continuam validadas pelo Firebase.
 const workspaceDefinitions=[
- {id:"mural",title:"Comunicação",intro:"Comunicados e recados gerais",sections:["mural"]},
+ {id:"mural",title:"Comunicação",intro:"Comunicados e recados gerais",sections:["mural","externalSports"]},
  {id:"games",title:"Jogos",intro:"Operação, agenda e resultados",sections:["overview","operation","matches","createMatch","standings","audience"]},
  {id:"records",title:"Cadastros",intro:"Equipes, jogadores, comissões técnicas e importação",sections:["teams","players","coachingStaff","imports"]},
  {id:"championships",title:"Campeonatos",intro:"Temporadas e inscrições",sections:["championships","registrationSheets"]},
@@ -5408,7 +5496,7 @@ const workspaceDefinitions=[
  {id:"administration",title:"Acessos",intro:"Permissões e operadores",sections:["users","monitor"]},
  {id:"maintenance",title:"Backups e suporte",intro:"Guias, testes e recuperação",sections:["systemCheck","documentation","testData","cleanup"]}
 ];
-function allowedWorkspaceSections(group){return group.sections.filter(id=>id==="mural"?canManageMural():role==="admin"||["overview","operation","matches","reportCenter","audience","documentation","qrCodes","profiles","preferences"].includes(id)||(canManageRosters()&&["teams","players","coachingStaff","imports"].includes(id))||(canManageChampionships()&&id==="championships")||(canPrepareRegistrationSheets()&&id==="registrationSheets")||(canCreateMatches()&&id==="createMatch"));}
+function allowedWorkspaceSections(group){return group.sections.filter(id=>id==="mural"?canManageMural():id==="externalSports"?canManageExternal():role==="admin"||["overview","operation","matches","reportCenter","audience","documentation","qrCodes","profiles","preferences"].includes(id)||(canManageRosters()&&["teams","players","coachingStaff","imports"].includes(id))||(canManageChampionships()&&id==="championships")||(canPrepareRegistrationSheets()&&id==="registrationSheets")||(canCreateMatches()&&id==="createMatch"));}
 function publicPanelURL(edition="") {
  const url=new URL("./index.html",location.href);
  if(trainingMode)url.searchParams.set("demonstracao","1");
@@ -5666,7 +5754,8 @@ function publicChallenge(){
 }
 const canManageMural=()=>!C.demo && (role==="admin" || (role==="operator" && operatorPermissions.includes("muralPublish")));
 let muralRows=[], muralStop, muralScope="", muralError="", muralLoaded=false, muralEditing="", muralBusy=false;
-const muralDefaults={title:"Bem-vindo à Arena!",subtitle:"Acompanhe placares, próximos jogos e recados da comunidade.",seconds:10,accent:"#15c3ed",auto:true,results:true,agenda:true,partners:true};
+const muralDefaults={title:"Bem-vindo à Arena!",subtitle:"Acompanhe placares, próximos jogos e recados da comunidade.",seconds:10,accent:"#15c3ed",auto:true,results:true,agenda:true,partners:true,news:false,sequence:"interleave",transition:"random"};
+let muralNews=[],muralNewsRequested=false;
 let muralSettings={...muralDefaults},muralSettingsStop,muralSlide=0,muralPaused=false,muralNext=0;
 const muralMotion=matchMedia("(prefers-reduced-motion: reduce)");
 function muralPublicCard(){
@@ -5690,7 +5779,9 @@ function muralSlides(){
  const notices=messages.map(row=>({...row,label:row.pinned?"Recado em destaque":"Recado"}));
  const slides=[{label:"Boas-vindas",title:muralSettings.title,body:muralSettings.subtitle,area:"schedule"}];
  let shownGames=0;
- if(notices.length)slides.push(notices[0]);
+ const news=muralSettings.news&&externalSports.news?muralNews.map(article=>({label:"Notícia · Agência Brasil",title:article.title,body:"",media:{link:article.url}})):[];
+ const interleave=muralSettings.sequence==="interleave";
+ if(muralSettings.sequence!=="games")slides.push(...(interleave?notices.slice(0,1):notices),...news);
  for(const [label,statuses,enabled] of [
   ["Ao vivo",["Ao vivo"],true],
   ["Agenda",["Agendada","Adiada"],muralSettings.agenda],
@@ -5705,10 +5796,11 @@ function muralSlides(){
     teams:[name(match.home),name(match.away)],score:scheduled?"×":gameResult(match).join(" × "),
     body:[matchSportLabel(match),match.competition,match.date?format(match.date):"",match.place].filter(Boolean).join(" · ")});
    shownGames++;
-   if(notices.length)slides.push(notices[shownGames%notices.length]);
+   if(interleave && notices.length)slides.push(notices[shownGames%notices.length]);
   }
  }
- slides.push(...notices.slice(shownGames+1));
+ if(interleave)slides.push(...notices.slice(shownGames+1));
+ if(muralSettings.sequence==="games")slides.push(...notices,...news);
  const partners=muralSettings.partners&&state.partners?.surfaces?.includes("publicPanel")?partnerGroups("preview"):[];
  if(partners.length)slides.push({label:"Organização e apoio",title:"Parceiros da Arena",body:"",partners});
  return slides;
@@ -5728,7 +5820,7 @@ function showMuralSlide(step=0,announce=false){
  if(content.dataset.muralKey!==markup){
   const effects=["fade","rise","slide"];
   const choices=effects.filter(effect=>effect!==box.dataset.muralEffect);
-  box.dataset.muralEffect=choices[Math.floor(Math.random()*choices.length)];
+  box.dataset.muralEffect=muralSettings.transition==="random"?choices[Math.floor(Math.random()*choices.length)]:muralSettings.transition;
   content.innerHTML=markup;content.dataset.muralKey=markup;
   muralNext=Date.now()+Math.min(60,muralSettings.seconds+(row.teams?2:0))*1000;
  }
@@ -5814,15 +5906,17 @@ function muralQuickBar(){
  </section>`;
 }
 function muralSettingsForm(){
- const fields=[["auto","Rodízio automático"],["results","Mostrar todos os resultados"],["agenda","Mostrar agenda"],["partners","Mostrar parceiros"]];
- return `<details class="card arena-mural-config"><summary>Configurar visor público</summary><form id="arenaMuralSettings">
+ const fields=[["auto","Rodízio automático"],["results","Mostrar todos os resultados"],["agenda","Mostrar agenda"],["partners","Mostrar parceiros"],["news","Mostrar notícias da Agência Brasil"]];
+ return `<section class="card arena-mural-config" data-custom-area="mural-display"><div class="arena-list-heading"><h2>Rodízio do mural</h2>${gameBarSettingsButton("mural-display")}</div><details><summary>Configurar visor público</summary><form id="arenaMuralSettings">
  <label>Mensagem de boas-vindas<input name="title" maxlength="100" required value="${esc(muralSettings.title)}"></label>
  <label>Descrição<input name="subtitle" maxlength="220" required value="${esc(muralSettings.subtitle)}"></label>
  <label>Segundos por tela<input name="seconds" type="number" min="3" max="60" required value="${esc(muralSettings.seconds)}"></label>
+ <label>Sequência<select name="sequence">${([["interleave","Intercalar recados e jogos"],["notices","Recados e notícias primeiro"],["games","Jogos primeiro"]]).map(([value,label])=>`<option value="${value}" ${muralSettings.sequence===value?"selected":""}>${label}</option>`).join("")}</select></label>
+ <label>Transição<select name="transition">${([["random","Variar efeitos"],["fade","Desvanecer"],["rise","Subir"],["slide","Deslizar"],["none","Sem efeito"]]).map(([value,label])=>`<option value="${value}" ${muralSettings.transition===value?"selected":""}>${label}</option>`).join("")}</select></label>
  <label>Cor do visor<input name="accent" type="color" value="${esc(muralSettings.accent)}"></label>
  ${fields.map(([id,label])=>`<label class="confirmation-check"><input type="checkbox" name="${id}" ${muralSettings[id]?"checked":""}> ${label}</label>`).join("")}
  <div class="toolbar"><button type="submit" class="primary">Salvar visor</button><button type="button" data-mural-settings-default>Restaurar valores padrão</button></div>
- </form></details>`;
+ </form></details></section>`;
 }
 function fillMuralSettings(form,values){
  for(const [key,value] of Object.entries(values)){
@@ -5876,6 +5970,10 @@ function syncMural(){
    muralSettingsStop=cloud.watchMuralSettings(values=>{
     if(scope!==muralScope)return;
     muralSettings={...muralDefaults,...values};
+    if(!admin&&muralSettings.news&&!muralNewsRequested&&window.loadArenaSportsNews){
+     muralNewsRequested=true;
+     void window.loadArenaSportsNews().then(rows=>{muralNews=rows;showMuralSlide();});
+    }
     muralNext=Date.now()+muralSettings.seconds*1000;
     const form=$("#arenaMuralSettings");
     if(form&&!form.closest("details").open)fillMuralSettings(form,muralSettings);
@@ -7386,9 +7484,9 @@ function personalTarget(el) {
 function applyPersonalColors() {
   const prefs=readPersonalTools(), colors=prefs.colors;
   applyGameBarPreferences(prefs.gameBar);
-  const weather=admin?document.querySelector(".arena-weather-card"):null;
+  const weather=document.querySelector(".arena-weather-card");
+  if(weather)weather.dataset.customArea="weather";
   if(weather && !weather.querySelector("[data-game-bar-settings]")){
-    weather.dataset.customArea="weather";
     weather.insertAdjacentHTML("beforeend",gameBarSettingsButton("weather"));
   }
   for(const area of document.querySelectorAll("[data-custom-area]"))
diff --git a/arena-noticias.js b/arena-noticias.js
index 59d84ec..7424cc7 100644
--- a/arena-noticias.js
+++ b/arena-noticias.js
@@ -19,15 +19,21 @@
     return request;
   }
 
+  function validArticles(data) {
+    return (Array.isArray(data?.articles) ? data.articles : []).filter(article =>
+      typeof article?.title === "string" && article.title.trim() &&
+      typeof article.url === "string" &&
+      article.url.startsWith("https://agenciabrasil.ebc.com.br/esportes/noticia/")
+    ).slice(0,6);
+  }
+  window.loadArenaSportsNews=async()=>validArticles(await loadNews());
+
   customElements.define("arena-news", class extends HTMLElement {
     async connectedCallback() {
       const data = await loadNews();
       if (!this.isConnected) return;
       const list = document.createElement("ul");
-      for (const article of Array.isArray(data?.articles) ? data.articles.slice(0, 6) : []) {
-        if (typeof article?.title !== "string" || !article.title.trim()) continue;
-        if (typeof article.url !== "string" ||
-            !article.url.startsWith("https://agenciabrasil.ebc.com.br/esportes/noticia/")) continue;
+      for (const article of validArticles(data)) {
         const item = document.createElement("li");
         const link = document.createElement("a");
         link.href = article.url;
diff --git a/arena-weather.js b/arena-weather.js
index 675ca0e..8b9996b 100644
--- a/arena-weather.js
+++ b/arena-weather.js
@@ -9,7 +9,7 @@
  let sequence=0,loading=false,lastAttempt=0,searchSequence=0;
  const main=document.querySelector('main');if(!main)return;
  const panel=document.createElement('details');panel.id='arenaWeather';panel.className='arena-weather noprint';panel.setAttribute('aria-label','Previsão do tempo');
- panel.innerHTML='<summary><strong data-weather-title>Previsão do tempo</strong><span data-weather-summary>Consultando previsão…</span></summary><div class="arena-weather-body"><p data-weather-status role="status" aria-live="polite"></p><div class="arena-weather-days" data-weather-days></div><div class="toolbar"><button type="button" data-weather-refresh>Atualizar previsão</button></div><form data-weather-search><label>Cidade<input name="city" type="search" minlength="3" maxlength="100" placeholder="Ex.: São Paulo" required autocomplete="off"></label><button type="submit">Buscar cidade</button></form><div class="arena-weather-results" data-weather-results></div><small>A cidade escolhida vale neste navegador. A previsão pode mudar. Fonte: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.</small></div>';
+ panel.innerHTML='<summary><strong data-weather-title>Previsão do tempo</strong><span class="arena-weather-condition"><span class="arena-weather-graphic" aria-hidden="true"><i></i><b></b><u></u><em></em></span><span data-weather-summary>Consultando previsão…</span></span></summary><div class="arena-weather-body"><p data-weather-status role="status" aria-live="polite"></p><div class="arena-weather-days" data-weather-days></div><div class="toolbar"><button type="button" data-weather-refresh>Atualizar previsão</button></div><form data-weather-search><label>Cidade<input name="city" type="search" minlength="3" maxlength="100" placeholder="Ex.: São Paulo" required autocomplete="off"></label><button type="submit">Buscar cidade</button></form><div class="arena-weather-results" data-weather-results></div><small>A cidade escolhida vale neste navegador. A previsão pode mudar. Fonte: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.</small></div>';
  const weatherCard = document.createElement('div');
  weatherCard.className = 'arena-weather-card noprint';
  const pin = document.createElement('button');
@@ -37,6 +37,39 @@
 @keyframes forecast-moon-glow {
   to { opacity: .6; }
 }
+
+.arena-weather-condition { display:inline-flex; gap:10px; align-items:center; min-width:0; }
+#arenaWeather[data-weather-icon]:not([data-weather-icon=""]) [data-weather-summary]::before { content:none; }
+.arena-weather-graphic { display:none; position:relative; flex:none; inline-size:1em; block-size:1em; font-size:var(--arena-weather-icon-size,30px); }
+#arenaWeather[data-weather-icon]:not([data-weather-icon=""]) .arena-weather-graphic { display:inline-block; }
+.arena-weather-graphic i,.arena-weather-graphic b,.arena-weather-graphic u,.arena-weather-graphic em { position:absolute; display:block; }
+.arena-weather-graphic i { inset:15% 22% 27% 20%; border-radius:50%; background:linear-gradient(140deg,#ffe17b,#ff9b31); box-shadow:0 0 .16em #ffb33e99; }
+[data-weather-icon="moon"] .arena-weather-graphic i,[data-weather-icon="partly-night"] .arena-weather-graphic i { background:#cbd5ff; box-shadow:inset -.13em .04em #7a8fc2; }
+[data-weather-icon]:not([data-weather-icon="sun"]):not([data-weather-icon="moon"]) .arena-weather-graphic b { inset:34% 7% 29%; border-radius:1em; background:linear-gradient(#e7f3ff,#7196b6); }
+.arena-weather-graphic b::before { content:"";position:absolute;inline-size:52%;block-size:130%;inset: -43% 29% auto;border-radius:50%;background:inherit; }
+[data-weather-icon]:not([data-weather-icon="sun"]):not([data-weather-icon="moon"]):not([data-weather-icon^="partly"]) .arena-weather-graphic i { display:none; }
+[data-weather-icon^="partly"] .arena-weather-graphic i { inset:8% 44% 42% 10%; }
+[data-weather-icon$="rain"] .arena-weather-graphic u,
+[data-weather-icon="drizzle"] .arena-weather-graphic u,
+[data-weather-icon="storm"] .arena-weather-graphic u,
+[data-weather-icon="snow"] .arena-weather-graphic u {
+ inset:64% auto auto 28%; inline-size:.10em; block-size:.19em; border-radius:1em; background:#57caff;
+ box-shadow:.21em -.03em #57caff,.40em .015em #57caff; transform:rotate(12deg);
+}
+[data-weather-icon="drizzle"] .arena-weather-graphic u { inline-size:.07em; block-size:.09em; box-shadow:.31em 0 #57caff; }
+[data-weather-icon="heavy-rain"] .arena-weather-graphic u { block-size:.27em; }
+[data-weather-icon="snow"] .arena-weather-graphic u { block-size:.10em; background:#eff8ff; box-shadow:.21em -.03em #eff8ff,.40em .015em #eff8ff; }
+[data-weather-icon="storm"] .arena-weather-graphic em { inset:45% 30% auto 48%; block-size:.4em; background:#ffe17b; clip-path:polygon(26% 0,100% 0,55% 44%,90% 44%,0 100%,25% 51%,0 51%); }
+[data-weather-icon="fog"] .arena-weather-graphic em { inset:72% 10% auto; block-size:.07em; background:#afc4d6; box-shadow:0 .13em #afc4d6; }
+@media(prefers-reduced-motion:no-preference) {
+ :root:not(.reduce-motion):not([data-demo-motion="true"]) .arena-weather-card:not([data-weather-motion="off"]) .arena-weather-graphic u { animation:arena-weather-drops calc(var(--arena-weather-icon-seconds,3s) * .44) linear infinite; }
+ :root:not(.reduce-motion):not([data-demo-motion="true"]) .arena-weather-card:not([data-weather-motion="off"]) [data-weather-icon="drizzle"] .arena-weather-graphic u { animation-duration:calc(var(--arena-weather-icon-seconds,3s) * .72); }
+ :root:not(.reduce-motion):not([data-demo-motion="true"]) .arena-weather-card:not([data-weather-motion="off"]) .arena-weather-graphic b { animation:arena-weather-cloud var(--arena-weather-icon-seconds,3s) ease-in-out infinite alternate; }
+ :root:not(.reduce-motion):not([data-demo-motion="true"]) .arena-weather-card[data-weather-motion="pulse"] .arena-weather-graphic { animation:arena-weather-grow var(--arena-weather-icon-seconds,3s) ease-in-out infinite alternate; }
+}
+@keyframes arena-weather-drops { 0%{ opacity:0; translate:0 -.07em } 28%{ opacity:1 } 100%{ opacity:0; translate:0 .16em } }
+@keyframes arena-weather-cloud { from {translate:-.04em 0} to {translate:.05em 0} }
+@keyframes arena-weather-grow { from {scale:.95} to {scale:1.07} }
 #arenaWeather [data-weather-summary]::before {
   display: inline-block;
   margin-inline-end: .45em;
@@ -223,9 +256,9 @@
  function weatherIcon({weather_code:code,is_day:day}){
   if(code===0)return day===0?'moon':day===1?'sun':'';
   if(code===1||code===2)return day===0?'partly-night':day===1?'partly-day':'cloud';
-  return {3:'cloud',45:'fog',48:'fog',51:'rain',53:'rain',55:'rain',56:'rain',57:'rain',
-    61:'rain',63:'rain',65:'rain',66:'rain',67:'rain',71:'snow',73:'snow',75:'snow',
-    77:'snow',80:'rain',81:'rain',82:'rain',85:'snow',86:'snow',95:'storm',96:'storm',99:'storm'}[code]||'';
+  return {3:'cloud',45:'fog',48:'fog',51:'drizzle',53:'drizzle',55:'drizzle',56:'drizzle',57:'drizzle',
+    61:'rain',63:'rain',65:'heavy-rain',66:'rain',67:'rain',71:'snow',73:'snow',75:'snow',
+    77:'snow',80:'rain',81:'rain',82:'heavy-rain',85:'snow',86:'snow',95:'storm',96:'storm',99:'storm'}[code]||'';
  }
  function paint(data,at,stale){
   if(!usable(data))return false;
diff --git a/spark-store.js b/spark-store.js
index a61e159..3f3c76a 100644
--- a/spark-store.js
+++ b/spark-store.js
@@ -1116,7 +1116,7 @@ export async function connectSpark({
       const before = snap.data();
       if (before.deleted === true) throw Error("Este operador foi removido e está disponível apenas para consulta.");
       const granted=access==="active"?[...new Set(permissions===undefined?(before.permissions||[]):permissions)]:[];
-      if(granted.some(p=>!["rosters","matchesCreate","championships","gamesView","historyCorrections","editMatchPhases","correctMatchSport","operateAllGames","hidePublicGames","muralPublish"].includes(p)))throw Error("Permissão específica inválida.");
+      if(granted.some(p=>!["rosters","matchesCreate","championships","gamesView","historyCorrections","editMatchPhases","correctMatchSport","operateAllGames","hidePublicGames","muralPublish","externalScores","externalNews"].includes(p)))throw Error("Permissão específica inválida.");
       const editions = access === "active"
         ? [...new Set(followedEditions ?? before.followedEditions ?? [])] : [];
       const known = new Set(state.championships.map((c) => c.name + " • " + c.season));
@@ -1256,6 +1256,22 @@ export async function connectSpark({
   }
   const canPublishMural = () => isOwner() || (authorized() && (profile?.permissions || []).includes("muralPublish"));
   return {
+    watchExternalSports(kind,update) {
+      return F.onSnapshot(F.doc(database,"externalSports",kind),snapshot=>update(snapshot.data()?.enabled===true),()=>update(false));
+    },
+    async setExternalSports(kind,enabled) {
+      const permission={scores:"externalScores",news:"externalNews"}[kind];
+      if(!permission||!(isOwner()||(authorized()&&(profile?.permissions||[]).includes(permission))))
+        throw Error("Sem autorização para esta publicação.");
+      await F.setDoc(F.doc(database,"externalSports",kind),{enabled});
+    },
+    watchMuralSettings(update) {
+      return F.onSnapshot(F.doc(database,"muralDisplay","main"),snap=>update(snap.data()||{}),()=>{});
+    },
+    async saveMuralSettings(values) {
+      if(!canPublishMural())throw Error("Sem autorização para configurar o mural.");
+      await F.setDoc(F.doc(database,"muralDisplay","main"),values);
+    },
     watchMural(manage, update, onFailure) {
       if (manage && !canPublishMural()) throw Error("Sem autorização para o mural.");
       const collection=F.collection(database,manage?"muralMessages":"publicMural");
'@
    $app = [IO.File]::ReadAllText((Resolve-Path -LiteralPath 'app.js').Path)
    if (-not $app.Contains('body:muralSettings.subtitle,area:"schedule"')) {
        $patch = $patch.Replace('body:muralSettings.subtitle,area:"schedule"', 'body:muralSettings.subtitle')
    }
    if (-not $app.Contains('slides.push({matchId:match.id,label:')) {
        $patch = $patch.Replace('slides.push({matchId:match.id,label:', 'slides.push({label:')
    }
    $store = [IO.File]::ReadAllText((Resolve-Path -LiteralPath 'spark-store.js').Path)
    if ($store.Contains('watchMuralSettings(update)') -and $store.Contains('async saveMuralSettings(values)')) {
        $patch = [regex]::Replace($patch, '(?m)^\+    watchMuralSettings\(update\) \{\r?\n(?:^\+[^\r\n]*\r?\n)*?(?=^     watchMural\(manage,)', {
            param($match)
            $match.Value -replace '(?m)^\+', ' '
        })
    }
    [IO.File]::WriteAllText($temp, ($patch -replace '\r\n', "`n") + "`n", $utf8)
    git apply --recount --check $temp
    if ($LASTEXITCODE -ne 0) { throw 'O codigo local do mural difere da versao esperada. Nenhum arquivo foi alterado.' }
    git apply --recount $temp
    if ($LASTEXITCODE -ne 0) { throw 'O Git interrompeu a aplicacao.' }
    foreach ($update in $updates) {
        [IO.File]::WriteAllText($update.Path,$update.Content,$utf8)
    }
    Write-Host 'Mural atualizado.'
} finally {
    Remove-Item -LiteralPath $temp
}
