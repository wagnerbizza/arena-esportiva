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
    $updates += @{Path=$path; Content=[regex]::Replace($html,$pattern,'${prefix}?v=mural-publicacao-2')}
}
$temp = [IO.Path]::GetTempFileName()
try {
    $patch = @'
diff --git a/app.js b/app.js
index d848e10..b3b6be8 100644
--- a/app.js
+++ b/app.js
@@ -5846,7 +5846,7 @@ function updateMural(){
  if(list){
   const labels={draft:"Rascunho",published:"Publicado",archived:"Arquivado"};
   const rows=[...muralRows].sort((a,b)=>(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));
-  list.innerHTML=muralError?empty(esc(muralError)):!muralLoaded?empty("Carregando recados…"):!rows.length?empty("Nenhum recado cadastrado."):rows.map(row=>`<article class="card"><p>${labels[row.status]||""}${row.pinned?" · Destaque":""}${muralDate(row)&&muralDate(row)<=new Date()?" · Expirado":""}</p>${muralMediaMarkup(row)}<div class="toolbar">${row.status!=="archived"||role==="admin"?`<button type="button" data-mural-edit="${esc(row.id)}">Editar</button>`:""}${role==="admin"&&row.status!=="archived"?`<button type="button" data-mural-archive="${esc(row.id)}">Arquivar</button>`:""}</div></article>`).join("");
+  list.innerHTML=muralError?empty(esc(muralError)):!muralLoaded?empty("Carregando recados…"):!rows.length?empty("Nenhum recado cadastrado."):rows.map(row=>`<article class="card"><p>${labels[row.status]||""}${row.pinned?" · Destaque":""}${muralDate(row)&&muralDate(row)<=new Date()?" · Expirado":""}</p>${muralMediaMarkup(row)}<div class="toolbar">${row.status!=="archived"||role==="admin"?`<button type="button" data-mural-edit="${esc(row.id)}">Editar</button>`:""}${row.status==="published"&&(role==="admin"||row.author===user?.uid)?`<button type="button" data-mural-withdraw="${esc(row.id)}">Retirar do mural</button>`:""}${role==="admin"&&row.status!=="archived"?`<button type="button" data-mural-archive="${esc(row.id)}">Arquivar</button>`:""}</div></article>`).join("");
  }
 }
 function syncMural(){
@@ -5864,7 +5864,21 @@ function syncMural(){
     if(!admin)showMuralSlide();
    });
    const fail=()=>{if(scope===muralScope){muralError="Não foi possível carregar os recados. Verifique a conexão e as regras do Firestore.";updateMural();}};
-   try{muralStop=cloud.watchMural(admin,rows=>{if(scope===muralScope){muralRows=rows;muralLoaded=true;updateMural();}},fail);}catch{fail();}
+   try{muralStop=cloud.watchMural(admin,rows=>{
+    if(scope!==muralScope)return;
+    const previous=muralLoaded&&!admin?new Map(muralRows.map(row=>[row.id,row.updatedAt?.toMillis?.()])):null;
+    muralRows=rows;
+    muralLoaded=true;
+    if(previous){
+     const slides=muralSlides();
+     const changed=slides.findIndex(row=>row.id&&(!previous.has(row.id)||row.updatedAt?.toMillis?.()>previous.get(row.id)));
+     if(changed>=0){
+      muralSlide=changed;
+      muralNext=Date.now()+muralSettings.seconds*1000;
+     }
+    }
+    updateMural();
+   },fail);}catch{fail();}
   }
  }
  updateMural();
@@ -5885,10 +5899,10 @@ function fillMuralForm(row){
  existing.querySelector("span").textContent=media.file?"Remover anexo atual · "+media.file.name:"Remover anexo atual";
  form.elements.title.focus();
 }
-async function submitMural(id,values){
+async function submitMural(id,values,successMessage="Recado salvo."){
  if(muralBusy||!canManageMural()||!cloud)return;
  muralBusy=true;
- try{await cloud.saveMural(id,values);if(muralEditing===id)fillMuralForm();toast("Recado salvo.");}
+ try{await cloud.saveMural(id,values);if(muralEditing===id)fillMuralForm();toast(successMessage);}
  catch(error){toast(error.message||"Não foi possível salvar o recado.",true);}
  finally{muralBusy=false;}
 }
@@ -5919,12 +5933,16 @@ document.addEventListener("submit",async e=>{
 document.addEventListener("click",e=>{
  const download=e.target.closest("[data-mural-download]");
  if(download){downloadMuralFile(download.dataset.muralDownload);return;}
- const button=e.target.closest("[data-mural-new],[data-mural-edit],[data-mural-archive]");
+ const button=e.target.closest("[data-mural-new],[data-mural-edit],[data-mural-withdraw],[data-mural-archive]");
  if(!button||!canManageMural())return;
  if(button.hasAttribute("data-mural-new")){fillMuralForm();return;}
- const row=muralRows.find(item=>item.id===(button.dataset.muralEdit||button.dataset.muralArchive));
+ const row=muralRows.find(item=>item.id===(button.dataset.muralEdit||button.dataset.muralWithdraw||button.dataset.muralArchive));
  if(!row)return;
  if(button.dataset.muralEdit)fillMuralForm(row);
+ else if(button.hasAttribute("data-mural-withdraw")){
+  if(row.status==="published"&&(role==="admin"||row.author===user?.uid))
+   void submitMural(row.id,{...row,expiresAt:muralDate(row),status:"draft"},"Recado retirado do mural e salvo como rascunho.");
+ }
  else if(role==="admin"&&confirm("Arquivar este recado e retirá-lo do painel público?"))
   void submitMural(row.id,{...row,expiresAt:muralDate(row),status:"archived"});
 });
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
