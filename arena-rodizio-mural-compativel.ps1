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
    $html = [regex]::Replace($html,$pattern,'${prefix}?v=mural-rodizio-1')
    $css = '(?<prefix>\bhref\s*=\s*["''](?:\./)?style\.css)(?:\?v=[^"'']*)?(?=["''])'
    if ([regex]::Matches($html,$css).Count -ne 1) { throw ('Referencia ao style.css nao encontrada em ' + $file) }
    $updates += @{Path=$path; Content=[regex]::Replace($html,$css,'${prefix}?v=mural-rodizio-1')}
}
$temp = [IO.Path]::GetTempFileName()
try {
    $patch = @'
diff --git a/app.js b/app.js
index b3b6be8..591b96e 100644
--- a/app.js
+++ b/app.js
@@ -5687,8 +5687,10 @@ function muralSlides(){
  const messages=muralRows.filter(row=>!muralDate(row)||muralDate(row)>now)
   .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));
  const matches=state.matches.filter(match=>!match.publicHidden&&!match.testData);
- const slides=[{label:"Boas-vindas",title:muralSettings.title,body:muralSettings.subtitle,area:"schedule"},
-  ...messages.map(row=>({...row,label:row.pinned?"Recado em destaque":"Recado"}))];
+ const notices=messages.map(row=>({...row,label:row.pinned?"Recado em destaque":"Recado"}));
+ const slides=[{label:"Boas-vindas",title:muralSettings.title,body:muralSettings.subtitle,area:"schedule"}];
+ let shownGames=0;
+ if(notices.length)slides.push(notices[0]);
  for(const [label,statuses,enabled] of [
   ["Ao vivo",["Ao vivo"],true],
   ["Agenda",["Agendada","Adiada"],muralSettings.agenda],
@@ -5702,8 +5704,11 @@ function muralSlides(){
    slides.push({matchId:match.id,label:scheduled?match.status:label,
     teams:[name(match.home),name(match.away)],score:scheduled?"×":gameResult(match).join(" × "),
     body:[matchSportLabel(match),match.competition,match.date?format(match.date):"",match.place].filter(Boolean).join(" · ")});
+   shownGames++;
+   if(notices.length)slides.push(notices[shownGames%notices.length]);
   }
  }
+ slides.push(...notices.slice(shownGames+1));
  const partners=muralSettings.partners&&state.partners?.surfaces?.includes("publicPanel")?partnerGroups("preview"):[];
  if(partners.length)slides.push({label:"Organização e apoio",title:"Parceiros da Arena",body:"",partners});
  return slides;
@@ -5720,7 +5725,13 @@ function showMuralSlide(step=0,announce=false){
  box.style.setProperty("--arena-mural-accent",/^#[0-9a-f]{6}$/i.test(muralSettings.accent)?muralSettings.accent:muralDefaults.accent);
  if(announce)content.setAttribute("aria-live","polite");
  else if(step)content.setAttribute("aria-live","off");
- if(content.dataset.muralKey!==markup){content.innerHTML=markup;content.dataset.muralKey=markup;}
+ if(content.dataset.muralKey!==markup){
+  const effects=["fade","rise","slide"];
+  const choices=effects.filter(effect=>effect!==box.dataset.muralEffect);
+  box.dataset.muralEffect=choices[Math.floor(Math.random()*choices.length)];
+  content.innerHTML=markup;content.dataset.muralKey=markup;
+  muralNext=Date.now()+Math.min(60,muralSettings.seconds+(row.teams?4:0))*1000;
+ }
  const reduced=muralMotion.matches||document.documentElement.classList.contains("reduce-motion");
  box.toggleAttribute("data-mural-paused",muralPaused||reduced||!muralSettings.auto);
  box.querySelector("[data-mural-controls]").hidden=slides.length<2&&(reduced||!muralSettings.auto);
diff --git a/style.css b/style.css
index e716587..3b71ff7 100644
--- a/style.css
+++ b/style.css
@@ -3243,6 +3243,13 @@ body.arena-layout-v2 .arena-function-search[data-custom-area="search"].arena-gam
 }
 @keyframes arena-mural-pass { from { transform:translate(-33px,6px); } to { transform:translate(33px,-6px); } }
 @keyframes arena-mural-enter { from { opacity:.25; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
+@media (prefers-reduced-motion:no-preference) {
+  :root:not(.reduce-motion) [data-mural-effect="fade"] .arena-mural-frame { animation:arena-mural-fade .55s ease-out both; }
+  :root:not(.reduce-motion) [data-mural-effect="rise"] .arena-mural-frame { animation:arena-mural-enter .55s ease-out both; }
+  :root:not(.reduce-motion) [data-mural-effect="slide"] .arena-mural-frame { animation:arena-mural-slide .55s ease-out both; }
+}
+@keyframes arena-mural-fade { from { opacity:.25; } to { opacity:1; } }
+@keyframes arena-mural-slide { from { opacity:.25; transform:translateX(7px); } to { opacity:1; transform:translateX(0); } }
 
 @media screen {
   :where(h1,h2,h3) { letter-spacing:.025em; }
'@
    $app = [IO.File]::ReadAllText((Resolve-Path -LiteralPath 'app.js').Path)
    if (-not $app.Contains('body:muralSettings.subtitle,area:"schedule"')) {
        $patch = $patch.Replace('body:muralSettings.subtitle,area:"schedule"', 'body:muralSettings.subtitle')
    }
    if (-not $app.Contains('slides.push({matchId:match.id,label:')) {
        $patch = $patch.Replace('slides.push({matchId:match.id,label:', 'slides.push({label:')
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
