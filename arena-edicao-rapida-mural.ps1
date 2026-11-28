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
    $updates += @{Path=$path; Content=[regex]::Replace($html,$pattern,'${prefix}?v=mural-edicao-rapida-1')}
}
$temp = [IO.Path]::GetTempFileName()
try {
    $patch = @'
diff --git a/app.js b/app.js
index 591b96e..6968df1 100644
--- a/app.js
+++ b/app.js
@@ -1493,7 +1493,7 @@ function showGameBarSettings(key="games") {
   dialog.setAttribute("aria-labelledby","arenaGameBarSettingsTitle");
   const personal=readPersonalTools();
   const prefs=key==="games"?personal.gameBar:personal.customAreas[key]||{};
-  const names={games:"Barra de jogos",weather:"Previsão do tempo","audience-monitor":"Audiência do painel público",navigation:"Atalhos e personalização",location:"Você está em",search:"Busca de funções","record-trash":"Lixeira de registros"};
+  const names={"mural-quick":"Edição rápida",games:"Barra de jogos",weather:"Previsão do tempo","audience-monitor":"Audiência do painel público",navigation:"Atalhos e personalização",location:"Você está em",search:"Busca de funções","record-trash":"Lixeira de registros"};
   const title=names[key]||(key.startsWith("title:")?"Título da tela":"Seção de cadastros");
   const area=key==="games"?$("#arenaTopMatchMonitor"):
     [...document.querySelectorAll("[data-custom-area]")].find(el=>el.dataset.customArea===key);
@@ -2312,7 +2312,7 @@ function render() {
   const muralForm=canManageMural()&&section==="mural"&&muralScope===role+":"+user?.uid?$("#arenaMuralForm"):null;
   const muralConfig=muralForm?$("#arenaMuralSettings")?.closest("details"):null;
   const pageControls = arenaPageControls();
-  app.innerHTML = `${audienceMonitorBar()}${pageControls}${locationTrail()}${workspaceNavigation(sections)}${floatingGameClock()}<div class="sectionhead admin-heading noprint" data-custom-area="title:${esc(section)}"><div><span class="tag">${esc(panelDisplayName())}</span><h1 tabindex="-1">${esc(selected && isOperationSection() ? "Operação de partida" : sections.find(([id])=>id===section)?.[1] || "Visão geral")}</h1><p class="muted">${esc(navigationDescriptions[section]?.description || "Organize o evento e acompanhe os jogos.")}</p></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span>${gameBarSettingsButton("title:"+section)}</div>${section==="overview"?`${accountPendingBanner()}<div class="noprint">${liveStatusPanel("admin")}</div>`:""}<div id="view">${role==="operator" && section==="overview"?operatorStartPanel():""}${view()}</div>${relatedArenaScreens()}`;
+  app.innerHTML = `${audienceMonitorBar()}${pageControls}${locationTrail()}${workspaceNavigation(sections)}${section==="overview"?muralQuickBar():""}${floatingGameClock()}<div class="sectionhead admin-heading noprint" data-custom-area="title:${esc(section)}"><div><span class="tag">${esc(panelDisplayName())}</span><h1 tabindex="-1">${esc(selected && isOperationSection() ? "Operação de partida" : sections.find(([id])=>id===section)?.[1] || "Visão geral")}</h1><p class="muted">${esc(navigationDescriptions[section]?.description || "Organize o evento e acompanhe os jogos.")}</p></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span>${gameBarSettingsButton("title:"+section)}</div>${section==="overview"?`${accountPendingBanner()}<div class="noprint">${liveStatusPanel("admin")}</div>`:""}<div id="view">${role==="operator" && section==="overview"?operatorStartPanel():""}${view()}</div>${relatedArenaScreens()}`;
   if(muralForm)$("#arenaMuralForm")?.replaceWith(muralForm);
   if(muralConfig)$("#arenaMuralSettings")?.closest("details").replaceWith(muralConfig);
   syncMural();
@@ -5730,7 +5730,7 @@ function showMuralSlide(step=0,announce=false){
   const choices=effects.filter(effect=>effect!==box.dataset.muralEffect);
   box.dataset.muralEffect=choices[Math.floor(Math.random()*choices.length)];
   content.innerHTML=markup;content.dataset.muralKey=markup;
-  muralNext=Date.now()+Math.min(60,muralSettings.seconds+(row.teams?4:0))*1000;
+  muralNext=Date.now()+Math.min(60,muralSettings.seconds+(row.teams?2:0))*1000;
  }
  const reduced=muralMotion.matches||document.documentElement.classList.contains("reduce-motion");
  box.toggleAttribute("data-mural-paused",muralPaused||reduced||!muralSettings.auto);
@@ -5806,12 +5806,19 @@ function downloadMuralFile(id){
   link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{toast("Não foi possível baixar o anexo.",true);}
 }
+function muralQuickBar(){
+ if(!canManageMural())return "";
+ return `<section class="card noprint" data-custom-area="mural-quick" aria-label="Edição rápida">
+ <div class="arena-list-heading"><h2>Edição rápida</h2>${gameBarSettingsButton("mural-quick")}</div>
+ <div class="toolbar"><button type="button" data-section="mural">Abrir Comunicação</button></div>
+ </section>`;
+}
 function muralSettingsForm(){
  const fields=[["auto","Rodízio automático"],["results","Mostrar todos os resultados"],["agenda","Mostrar agenda"],["partners","Mostrar parceiros"]];
  return `<details class="card arena-mural-config"><summary>Configurar visor público</summary><form id="arenaMuralSettings">
  <label>Mensagem de boas-vindas<input name="title" maxlength="100" required value="${esc(muralSettings.title)}"></label>
  <label>Descrição<input name="subtitle" maxlength="220" required value="${esc(muralSettings.subtitle)}"></label>
- <label>Segundos por tela<input name="seconds" type="number" min="5" max="60" required value="${esc(muralSettings.seconds)}"></label>
+ <label>Segundos por tela<input name="seconds" type="number" min="3" max="60" required value="${esc(muralSettings.seconds)}"></label>
  <label>Cor do visor<input name="accent" type="color" value="${esc(muralSettings.accent)}"></label>
  ${fields.map(([id,label])=>`<label class="confirmation-check"><input type="checkbox" name="${id}" ${muralSettings[id]?"checked":""}> ${label}</label>`).join("")}
  <div class="toolbar"><button type="submit" class="primary">Salvar visor</button><button type="button" data-mural-settings-default>Restaurar valores padrão</button></div>
'@
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
