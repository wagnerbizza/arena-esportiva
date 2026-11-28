$ErrorActionPreference = 'Stop'
$patch = Join-Path $PSScriptRoot 'arena-aparencia-temas.patch'
if (-not (Test-Path -LiteralPath $patch -PathType Leaf)) {
    throw 'Coloque arena-aparencia-temas.patch na mesma pasta deste script.'
}
$utf8 = [System.Text.UTF8Encoding]::new($false)
$updates = @()
foreach ($file in @('index.html', 'painel.html')) {
    $path = (Resolve-Path -LiteralPath $file).Path
    $html = [IO.File]::ReadAllText($path)
    foreach ($asset in @(@{Attribute='href'; File='style.css'}, @{Attribute='src'; File='app.js'})) {
        $pattern = '(?<prefix>\b' + $asset.Attribute + '\s*=\s*["''](?:\./)?' +
            [regex]::Escape($asset.File) + ')(?:\?v=[^"'']*)?(?=["''])'
        if ([regex]::Matches($html, $pattern).Count -ne 1) {
            throw ('Referência de {0} em {1} não identificada. Nenhum arquivo foi alterado.' -f $asset.File, $file)
        }
        $html = [regex]::Replace($html, $pattern, '${prefix}?v=aparencia-1')
    }
    $updates += @{Path=$path; Content=$html}
}
$cssPath = (Resolve-Path -LiteralPath 'style.css').Path
$css = [IO.File]::ReadAllText($cssPath)
$themeRules = @'
/* Identidade legível sobre as superfícies claras e escuras. */
:root {
  --arena-brand-ink: #15c3ed;
  --arena-brand-violet: #d8b4fe;
  --arena-brand-amber: #ffd477;
}
:root[data-theme="light"] {
  --arena-brand-ink: #075e83;
  --arena-brand-violet: #6b21a8;
  --arena-brand-amber: #854d0e;
}
:root[data-brand-color="violet"] { --arena-brand-ink: var(--arena-brand-violet); }
:root[data-brand-color="amber"] { --arena-brand-ink: var(--arena-brand-amber); }
:root[data-brand-color="text"] { --arena-brand-ink: var(--text); }
:root :is(#systemBrand, #trainingBrand, #arenaSidebar, .demo-brand) .brand-copy b {
  color: var(--arena-brand-ink);
}
:root:is(.high-contrast, [data-demo-contrast="true"]) :is(#systemBrand, #trainingBrand, #arenaSidebar, .demo-brand) .brand-copy b {
  color: var(--text);
}
@media screen {
  html[data-theme="light"].high-contrast body.arena-layout-v2 {
    --bg: #fff;
    --panel: #fff;
    --text: #000;
    --line: #000;
    --muted: #111;
    --arena-control: #eee;
    --arena-input: #fff;
  }
}
'@
if (-not $css.Contains('--arena-brand-ink:')) {
    $newline = if ($css.Contains("`r`n")) { "`r`n" } else { "`n" }
    $themeRules = $themeRules -replace '\r?\n', $newline
    $updates += @{Path=$cssPath; Content=$css + $newline + $newline + $themeRules + $newline}
}
$options = @('--exclude=index.html', '--exclude=painel.html', '--exclude=style.css')
git apply --check @options $patch
if ($LASTEXITCODE -ne 0) {
    throw 'O restante do patch também conflita. Nenhum arquivo foi alterado.'
}
git apply @options $patch
if ($LASTEXITCODE -ne 0) { throw 'O Git interrompeu a aplicação do patch.' }
foreach ($update in $updates) {
    [IO.File]::WriteAllText($update.Path, $update.Content, $utf8)
}
Write-Host 'Aparência aplicada. Revise as mudanças com git diff.'
