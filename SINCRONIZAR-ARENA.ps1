# ============================================================
# ARENA ESPORTIVA - SINCRONIZACAO COM O GITHUB
# ============================================================
# Publica somente os arquivos autorizados deste projeto.
# Usa a autenticacao existente do Git.
# Nao coloque senhas ou tokens neste arquivo.
#
# Para parar: Ctrl+C no terminal.
# Regras do Firebase continuam sendo publicadas no console.
# ============================================================

$ErrorActionPreference = "Stop"

# CONFIGURACOES EDITAVEIS
$IntervaloSegundos = 8
$EsperaAntesDeEnviar = 5

$RepositorioEsperado = "https://github.com/wagnerbizza/arena-esportiva.git"

# Somente estes arquivos e pastas entram na publicacao.
$ArquivosPermitidos = @(
    "index.html"
    "painel.html"
    "app.js"
    "style.css"
    "config.js"
    "domain.js"
    "spark-model.js"
    "spark-store.js"
    "report-pdf.js"
    "vendor"
)

# ============================================================
# EXECUTA O GIT E CONFERE SE O COMANDO FUNCIONOU
# ============================================================

function Invoke-ArenaGit {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Argumentos
    )

    # No Windows PowerShell, mensagens normais do Git podem
    # chegar pela saida de erros. Conferimos o codigo de saida.
    $PreferenciaAnterior = $ErrorActionPreference

    try {
        $ErrorActionPreference = "Continue"
        $Saida = @(& git @Argumentos 2>&1)
        $Codigo = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $PreferenciaAnterior
    }

    if ($Codigo -ne 0) {
        throw (
            "Falha ao executar: git " +
            ($Argumentos -join " ") +
            "`n" + ($Saida -join "`n")
        )
    }

    foreach ($Linha in $Saida) {
        [string]$Linha
    }
}

# ============================================================
# CONFERE A PASTA, O REPOSITORIO E A BRANCH
# ============================================================

function Test-ArenaRepository {
    # A verificacao usa um caminho relativo.
    # Assim, nao depende dos acentos no caminho completo.
    if (-not (Test-Path -LiteralPath (
        Join-Path $PSScriptRoot ".git"
    ))) {
        throw "O script precisa ficar ao lado da pasta .git do Arena."
    }

    $Prefixo = (
        @(Invoke-ArenaGit -Argumentos @(
            "rev-parse", "--show-prefix"
        )) -join ""
    ).Trim()

    if ($Prefixo -ne "") {
        throw "O script precisa ficar na pasta principal do Arena."
    }

    $Remoto = (
        @(Invoke-ArenaGit -Argumentos @(
            "remote", "get-url", "origin"
        )) -join ""
    ).Trim()

    if ($Remoto -ne $RepositorioEsperado) {
        throw "O origin nao corresponde ao repositorio arena-esportiva."
    }

    $Branch = (
        @(Invoke-ArenaGit -Argumentos @(
            "branch", "--show-current"
        )) -join ""
    ).Trim()

    if ($Branch -ne "main") {
        throw "Esta automacao precisa estar na branch main."
    }
}

# ============================================================
# CONFERE SE EXISTEM ARQUIVOS PREPARADOS MANUALMENTE
# ============================================================

function Test-ArenaIndex {
    $Preparados = @(Invoke-ArenaGit -Argumentos @(
        "diff", "--cached", "--name-only"
    ))

    if ($Preparados.Count -gt 0) {
        throw (
            "Existem arquivos em Staged Changes. " +
            "Conclua ou retire essa preparacao antes de continuar."
        )
    }
}

# ============================================================
# BUSCA O HISTORICO SEM ALTERAR OS ARQUIVOS LOCAIS
# ============================================================

function Update-ArenaHistory {
    Invoke-ArenaGit -Argumentos @(
        "-c", "fetch.writeCommitGraph=false",
        "fetch", "origin"
    ) | Out-Host

    $Pendentes = (
        @(Invoke-ArenaGit -Argumentos @(
            "rev-list", "--count", "HEAD..origin/main"
        )) -join ""
    ).Trim()

    if ([int]$Pendentes -gt 0) {
        throw (
            "Existem atualizacoes no GitHub ainda nao integradas. " +
            "A automacao parou para voce conferir."
        )
    }
}

# ============================================================
# INICIO DA AUTOMACAO
# ============================================================

try {
    Set-Location -LiteralPath $PSScriptRoot

    Test-ArenaRepository
    Test-ArenaIndex
    Update-ArenaHistory

    Write-Host ""
    Write-Host "ARENA ESPORTIVA - SINCRONIZACAO ATIVA" -ForegroundColor Cyan
    Write-Host "Salve os arquivos no VS Code para publicar." -ForegroundColor Green
    Write-Host "Para encerrar: Ctrl+C." -ForegroundColor Yellow
    Write-Host ""

    while ($true) {
        Test-ArenaRepository
        Test-ArenaIndex

        $Mudancas = @(Invoke-ArenaGit -Argumentos (
            @("status", "--porcelain", "--untracked-files=all", "--") +
            $ArquivosPermitidos
        ))

        $CommitsLocais = (
            @(Invoke-ArenaGit -Argumentos @(
                "rev-list", "--count", "origin/main..HEAD"
            )) -join ""
        ).Trim()

        if ($Mudancas.Count -gt 0 -or [int]$CommitsLocais -gt 0) {
            Write-Host "Conferindo o GitHub..." -ForegroundColor Yellow
            Update-ArenaHistory

            if ($Mudancas.Count -gt 0) {
                # Agrupa salvamentos feitos em sequencia.
                Start-Sleep -Seconds $EsperaAntesDeEnviar

                # Confere novamente antes de preparar os arquivos.
                Test-ArenaIndex

                $Candidatos = @()

                foreach ($Item in $ArquivosPermitidos) {
                    $Rastreados = @(Invoke-ArenaGit -Argumentos @(
                        "ls-files", "--", $Item
                    ))

                    if (
                        (Test-Path -LiteralPath $Item) -or
                        $Rastreados.Count -gt 0
                    ) {
                        $Candidatos += $Item
                    }
                }

                if ($Candidatos.Count -gt 0) {
                    Invoke-ArenaGit -Argumentos (
                        @("add", "-A", "--") + $Candidatos
                    ) | Out-Host

                    $ParaCommit = @(Invoke-ArenaGit -Argumentos @(
                        "diff", "--cached", "--name-only"
                    ))

                    if ($ParaCommit.Count -gt 0) {
                        $Mensagem = "Arena: atualizacao " +
                            (Get-Date -Format "yyyy-MM-dd HH:mm:ss")

                        Invoke-ArenaGit -Argumentos (
                            @("commit", "--only", "-m", $Mensagem, "--") +
                            $Candidatos
                        ) | Out-Host
                    }
                }
            }

            # Envia normalmente. Nunca usa force.
            Invoke-ArenaGit -Argumentos @(
                "push", "origin", "main"
            ) | Out-Host

            Write-Host ""
            Write-Host "Alteracoes enviadas ao GitHub." -ForegroundColor Green
            Write-Host "Aguarde a atualizacao do GitHub Pages."
            Write-Host ""
        }

        Start-Sleep -Seconds $IntervaloSegundos
    }
}
catch {
    Write-Host ""
    Write-Host "SINCRONIZACAO INTERROMPIDA" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Copie a mensagem e envie para verificarmos."
    exit 1
}