$ErrorActionPreference = 'Stop'
$patch = Join-Path $PSScriptRoot 'arena-mural-de-recados.patch'
if (-not (Test-Path -LiteralPath $patch -PathType Leaf)) { throw 'Coloque o patch na mesma pasta do script.' }
$path = (Resolve-Path -LiteralPath 'firestore.rules').Path
$original = [IO.File]::ReadAllText($path)
$newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
$rules = $original
$block = @'
  function muralEditor() {
   return owner() || (operator() && 'muralPublish' in get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('permissions',[]));
  }
  function muralPublicData(d) {
   return {'title':d.title,'body':d.body,'pinned':d.pinned,'expiresAt':d.expiresAt,'updatedAt':d.updatedAt};
  }
  function validMural(d,id) {
   let publicPath = /databases/$(database)/documents/publicMural/$(id);
   return d.keys().hasOnly(['title','body','pinned','expiresAt','updatedAt','author','updatedBy','status'])
    && nonempty(d.title,100) && nonempty(d.body,1200)
    && d.pinned is bool && (d.expiresAt == null || d.expiresAt is timestamp)
    && d.updatedAt == request.time && d.updatedBy == request.auth.uid
    && d.status in ['draft','published','archived']
    && (d.status == 'published'
     ? existsAfter(publicPath) && getAfter(publicPath).data == muralPublicData(d)
     : !existsAfter(publicPath));
  }
  match /muralMessages/{id} {
   allow read: if owner() || (muralEditor() && resource.data.author == request.auth.uid);
   allow create: if muralEditor() && validMural(request.resource.data,id)
    && request.resource.data.author == request.auth.uid
    && (owner() || (!request.resource.data.pinned && request.resource.data.status != 'archived'));
   allow update: if muralEditor() && validMural(request.resource.data,id)
    && request.resource.data.author == resource.data.author
    && (owner() || (resource.data.author == request.auth.uid
     && resource.data.status != 'archived' && request.resource.data.status != 'archived'
     && request.resource.data.pinned == resource.data.pinned));
  }
  match /publicMural/{id} {
   allow read: if true;
   allow create, update: if muralEditor()
    && existsAfter(/databases/$(database)/documents/muralMessages/$(id))
    && getAfter(/databases/$(database)/documents/muralMessages/$(id)).data.updatedAt == request.time
    && getAfter(/databases/$(database)/documents/muralMessages/$(id)).data.status == 'published'
    && request.resource.data == muralPublicData(getAfter(/databases/$(database)/documents/muralMessages/$(id)).data);
   allow delete: if muralEditor()
    && existsAfter(/databases/$(database)/documents/muralMessages/$(id))
    && getAfter(/databases/$(database)/documents/muralMessages/$(id)).data.updatedAt == request.time
    && getAfter(/databases/$(database)/documents/muralMessages/$(id)).data.status != 'published';
  }
'@
if ($rules -notmatch 'match\s+/muralMessages/\{id\}') {
    $anchor = [regex]::new('(?m)^[ \t]*match\s+/publicSettings/main\s*\{')
    if ($anchor.Matches($rules).Count -ne 1 -or $rules -match 'match\s+/publicMural/' -or
        $rules -notmatch 'function\s+owner\s*\(' -or $rules -notmatch 'function\s+operator\s*\(' -or
        $rules -notmatch 'function\s+nonempty\s*\(') {
        throw 'Estrutura das regras diferente da esperada. Nenhum arquivo foi alterado.'
    }
    $rules = $rules.Insert($anchor.Match($rules).Index, ($block -replace '\r?\n', $newline) + $newline)
} elseif ($rules -notmatch 'match\s+/publicMural/\{id\}') {
    throw 'Regras do mural incompletas. Nenhum arquivo foi alterado.'
}
$permissions = [regex]::new("(\.get\(\s*'permissions'\s*,\s*\[\s*\]\s*\)\s*\.hasOnly\(\s*\[)([^\]]+)(\])")
$lists = $permissions.Matches($rules)
if ($lists.Count -ne 1) { throw 'Lista de permissoes nao identificada. Nenhum arquivo foi alterado.' }
if ($lists[0].Groups[2].Value -notmatch "'muralPublish'") {
    $limit = [regex]::new("(\.get\(\s*'permissions'\s*,\s*\[\s*\]\s*\)\s*\.size\(\)\s*<=\s*)(\d+)")
    if ($limit.Matches($rules).Count -ne 1) { throw 'Limite de permissoes nao identificado. Nenhum arquivo foi alterado.' }
    $rules = $permissions.Replace($rules, { param($m)
        $m.Groups[1].Value + $m.Groups[2].Value.TrimEnd() + ",'muralPublish'" + $m.Groups[3].Value
    })
    $rules = $limit.Replace($rules, { param($m)
        $m.Groups[1].Value + ([int]$m.Groups[2].Value + 1).ToString()
    })
}
git apply --check --exclude=firestore.rules $patch
if ($LASTEXITCODE -ne 0) { throw 'O restante do patch conflita. Nenhum arquivo foi alterado.' }
git apply --exclude=firestore.rules $patch
if ($LASTEXITCODE -ne 0) { throw 'O Git interrompeu a aplicacao do patch.' }
if ($rules -ne $original) {
    [IO.File]::WriteAllText($path, $rules, [System.Text.UTF8Encoding]::new($false))
}
Write-Host 'Mural aplicado. Confira git diff -- firestore.rules antes de publicar.'
