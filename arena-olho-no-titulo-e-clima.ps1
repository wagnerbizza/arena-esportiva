$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$path = (Resolve-Path -LiteralPath 'style.css').Path
$css = [IO.File]::ReadAllText($path)
$rule = @'
/* Tamanho configurado do ícone da previsão */
.arena-weather-card #arenaWeather .arena-weather-graphic {
  inline-size:var(--arena-weather-icon-size,30px);
  block-size:var(--arena-weather-icon-size,30px);
  font-size:var(--arena-weather-icon-size,30px);
  flex:0 0 auto;
}
.arena-weather-card #arenaWeather .arena-weather-graphic :is(i,b,u,em) {
  font-size:inherit;
}
.arena-public-games-heading {
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px 18px;
  min-inline-size:0;
}
.arena-public-games-heading h2 { margin:0; }
.arena-public-games-audience {
  display:inline-flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:5px 10px;
  border:1px solid var(--line);
  border-radius:12px;
  color:var(--muted);
  font-size:.875rem;
}
.arena-public-games-audience .public-audience-badge { margin:0; }

'@
$updates = @()
foreach ($file in @('index.html','painel.html','apresentacao.html')) {
    $htmlPath = (Resolve-Path -LiteralPath $file).Path
    $html = [IO.File]::ReadAllText($htmlPath)
    $pattern = '(?<prefix>\bhref\s*=\s*["''](?:\./)?style\.css)(?:\?v=[^"'']*)?(?=["''])'
    if ([regex]::Matches($html,$pattern).Count -ne 1) { throw ('Link de style.css nao identificado em ' + $file) }
    $html = [regex]::Replace($html,$pattern,'${prefix}?v=olho-titulo-clima-1')
    $weather = $pattern.Replace('href','src').Replace('style\.css','arena-weather\.js')
    $html = [regex]::Replace($html,$weather,'${prefix}?v=olho-titulo-clima-1')
    if ($file -eq 'index.html') {
        $appLink = $pattern.Replace('href','src').Replace('style\.css','app\.js')
        if ([regex]::Matches($html,$appLink).Count -ne 1) { throw 'Link de app.js nao identificado.' }
        $html = [regex]::Replace($html,$appLink,'${prefix}?v=olho-titulo-clima-1')
    }
    $updates += @{Path=$htmlPath;Content=$html}
}
$appPath = (Resolve-Path -LiteralPath 'app.js').Path
$app = [IO.File]::ReadAllText($appPath)
$old = '<div><h2>Acompanhe os jogos</h2>${C.demo?"":`<p class="public-audience-badge" data-public-audience>${publicAudienceBadge()}</p>`}</div>'
$new = '<div class="arena-public-games-heading"><h2>Acompanhe os jogos</h2>${C.demo?"":`<span class="arena-public-games-audience"><span>Pessoas acompanhando</span><span class="public-audience-badge" data-public-audience>${publicAudienceBadge()}</span></span>`}</div>'
if (-not $app.Contains($new)) {
    if ([regex]::Matches($app,[regex]::Escape($old)).Count -ne 1) { throw 'Cabecalho do painel publico diferente da versao esperada. Nenhum arquivo foi alterado.' }
    $updates += @{Path=$appPath;Content=$app.Replace($old,$new)}
}
if (-not $css.Contains('.arena-public-games-audience .public-audience-badge')) {
    [IO.File]::WriteAllText($path,$css+[Environment]::NewLine+$rule+[Environment]::NewLine,$utf8)
}
foreach ($update in $updates) { [IO.File]::WriteAllText($update.Path,$update.Content,$utf8) }
Write-Host 'Contador e tamanho do clima atualizados.'
