/* APLICAÇÃO — seções numeradas para facilitar futuras alterações.
   1 conexão | 2 visualização | 3 cadastros | 4 partida | 5 importação | 6 relatórios.
   Nunca acrescente senhas neste arquivo. Dados externos são escapados antes da exibição. */
// Arquivo sem ferramenta de compilação: funciona no GitHub Pages.
const D = window.Domain,
  C = window.CONFIG,
  admin = document.body.dataset.admin === "true";
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let state = D.fresh(),
  section = "overview",
  selected = "",
  user = null,
  role = "",
  pendingImport = null,
  busy = false,
  cloud = null,
  unsubscribe = null;
const key = "arena-demo-v1",
  app = $("#app");
let reportFilter = "",
  publicFilter = "";
// Atualizações ao vivo preservam o formulário ainda não enviado.
function refresh() {
  const importDraft =
    section === "imports" && $("#preview")
      ? {
          preview: $("#preview").innerHTML,
          kind: $("[name=importKind]").value,
          paste: $("#paste").value,
        }
      : null;
  const forms = [...app.querySelectorAll("form")].map((f) => ({
    id: f.id,
    values: [...f.elements]
      .filter((e) => e.name && e.type !== "password")
      .map((e) => [e.name, e.value]),
  }));
  render();
  for (const f of forms) {
    const target = document.getElementById(f.id);
    if (target)
      for (const [name, value] of f.values)
        if (target.elements[name]) target.elements[name].value = value;
  }
  if (importDraft && $("#preview")) {
    $("[name=importKind]").value = importDraft.kind;
    $("#paste").value = importDraft.paste;
    $("#preview").innerHTML = importDraft.preview;
  }
}
function toast(t, error = false) {
  const n = $("#notice");
  n.textContent = t;
  n.className = error ? "error" : "";
  n.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (n.hidden = true), 6500);
}
const team = (id) =>
  state.teams.find((t) => t.id === id) || {
    name: "Equipe",
    short: "?",
    badge: "",
  };
const name = (id) => team(id).name;
const format = (d) => new Date(d).toLocaleString("pt-BR");
const options = (arr, value, label) =>
  arr
    .map((x) => `<option value="${esc(value(x))}">${esc(label(x))}</option>`)
    .join("");
const teamOptions = () =>
  options(
    state.teams,
    (x) => x.id,
    (x) => x.name,
  );
function badge(t) {
  return `<span class="crest">${t.badge ? `<img src="${esc(t.badge)}" alt="Escudo de ${esc(t.name)}" loading="lazy" onerror="this.hidden=true">` : esc(t.short || t.name.slice(0, 2).toUpperCase())}</span>`;
}
function field(label, name, type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
}
function select(label, name, opts) {
  return `<label>${label}<select name="${name}" ${name === "player" ? "" : "required"}>${opts}</select></label>`;
}
function data(form) {
  return Object.fromEntries(new FormData(form));
}
function table(headers, rows) {
  return `<div class="tablewrap"><table><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
const tr = (values) =>
  `<tr>${values.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`;
function empty(text) {
  return `<div class="empty">${text}</div>`;
}
// 1 — Conexão. Demonstração não exige login e NÃO protege os dados locais.
async function boot() {
  $("#mode").textContent = C.demo
    ? "DEMONSTRAÇÃO LOCAL • dados apenas neste navegador; sem segurança de produção."
    : "FIREBASE SPARK • conectando…";
  if (C.demo) {
    try {
      state = JSON.parse(localStorage.getItem(key)) || D.fresh();
    } catch {
      toast(
        "Dados locais inválidos. Limpe o armazenamento para reiniciar.",
        true,
      );
    }
    role = "admin";
    render();
    window.addEventListener("storage", (e) => {
      if (e.key === key) {
        state = e.newValue ? JSON.parse(e.newValue) : D.fresh();
        render();
      }
    });
    return;
  }
  render();
  try {
    const { connectSpark } = await import("./spark-store.js");
    cloud = await connectSpark({
      config: C,
      privateView: admin,
      onData: (s) => {
        state = s;
        refresh();
      },
      onSession: (u, r) => {
        user = u;
        role = r;
        render();
      },
      onError: (e) => toast(e.message, true),
      onConnection: (t) => ($("#mode").textContent = t),
    });
  } catch (e) {
    toast("Não foi possível conectar: " + e.message, true);
  }
}
async function dispatch(a) {
  if (busy) throw Error("Aguarde a operação anterior.");
  busy = true;
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    if (C.demo) {
      const latest = JSON.parse(localStorage.getItem(key)) || D.fresh();
      state = D.reduce(latest, a, "demo");
      localStorage.setItem(key, JSON.stringify(state));
    } else {
      if (!cloud) throw Error("Aguarde a conexão com o Firebase.");
      await cloud.send(a);
    }
    toast("Registro salvo.");
    if (C.demo) render();
  } catch (e) {
    toast(e.message, true);
    throw e;
  } finally {
    busy = false;
    render();
  }
}
// 2 — Visualização e navegação.
function matchCard(m, button = false) {
  const points = D.score(m),
    volley = m.sport.startsWith("Vôlei"),
    sc = volley
      ? [
          m.sets.filter((s) => s.score[0] > s.score[1]).length,
          m.sets.filter((s) => s.score[1] > s.score[0]).length,
        ]
      : points,
    a = team(m.home),
    b = team(m.away);
  return `<article class="card"><div class="row"><span class="tag">${esc(m.sport)}</span><span class="status ${m.status === "Ao vivo" ? "live" : ""}">${esc(m.status)}</span></div><p class="muted">${esc(m.competition || "Partida avulsa")}</p><div class="score"><div>${badge(a)}<div class="name">${esc(a.name)}</div></div><strong>${sc[0]} <span class="muted">:</span> ${sc[1]}</strong><div>${badge(b)}<div class="name">${esc(b.name)}</div></div></div><div class="muted">${esc(m.stage)}ª etapa ${volley ? " • Pontos do set: " + points.join(" × ") : ""} ${m.sets.length ? " • Sets: " + m.sets.map((s) => s.score.join("–")).join(" / ") : ""}</div><p class="muted">${esc(format(m.date))}<br>${esc(m.place || "Local a definir")}</p>${button && (role === "admin" || cloud?.canOperate(m.id)) ? `<button data-open="${m.id}">Operar partida →</button>` : ""}</article>`;
}
function render() {
  document.documentElement.style.setProperty("--accent", state.settings.color);
  document.title = state.settings.title;
  $("#logout")?.classList.toggle("hidden", C.demo || !user);
  if (admin && !C.demo && (!user || !role)) {
    app.innerHTML = `<div class="card" style="max-width:440px;margin:50px auto"><span class="tag">ÁREA RESTRITA</span><h2>Entrar na organização</h2><form id="login"><div class="formgrid">${field("E-mail", "email", "email", 'required autocomplete="username"')}${field("Senha", "password", "password", 'required autocomplete="current-password"')}</div><button class="primary">Entrar</button></form><p class="muted">${user ? "Sua conta ainda precisa de autorização." : "Contas são criadas pelo responsável no Firebase."}</p></div>`;
    return;
  }
  if (!admin) {
    app.innerHTML = `<section class="hero" id="hero"><span class="tag">CENTRAL DE RESULTADOS / TEMPORADA</span><h1>${esc(state.settings.title)}</h1><p class="muted">${esc(state.settings.subtitle)}</p></section><div class="sectionhead"><h2>Acompanhe os jogos</h2><select id="filter" aria-label="Filtrar modalidade"><option value="">Todas as modalidades</option>${options(
      D.SPORTS,
      (x) => x,
      (x) => x,
    )}</select></div><div id="publicMatches" class="grid">${publicMatches(publicFilter)}</div>`;
    $("#filter").value = publicFilter;
    if (state.settings.banner)
      $("#hero").style.backgroundImage =
        `linear-gradient(90deg,#0c1014ed,#0c1014b0),url("${encodeURI(state.settings.banner).replace(/"/g, "%22")}")`;
    return;
  }
  const sections = [
    ["overview", "Visão geral"],
    ["teams", "Equipes"],
    ["players", "Jogadores"],
    ["matches", "Partidas"],
    ["imports", "Importar"],
    ["reports", "Súmulas e relatórios"],
    ["settings", "Configurações"],
  ];
  app.innerHTML = `<div class="sectionhead"><div><span class="tag">PAINEL DA ORGANIZAÇÃO</span><h2>${esc(state.settings.title)}</h2></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador" : "Operador"}</span></div><nav>${sections
    .filter(
      ([id]) =>
        role === "admin" || ["overview", "matches", "reports"].includes(id),
    )
    .map(
      ([id, label]) =>
        `<button data-section="${id}" class="${section === id ? "active" : ""}">${label}</button>`,
    )
    .join("")}</nav><div id="view">${view()}</div>`;
  if (section === "reports" && $("[name=reportMatch]")) {
    $("[name=reportMatch]").value = reportFilter;
    $("#reportOutput").innerHTML = state.matches
      .filter((m) => !reportFilter || m.id === reportFilter)
      .map(reportMatch)
      .join("");
  }
}
function publicMatches(filter) {
  const list = state.matches.filter((m) => !filter || m.sport === filter);
  return list.length
    ? list
        .slice()
        .sort(
          (a, b) =>
            (b.status === "Ao vivo") - (a.status === "Ao vivo") ||
            a.date.localeCompare(b.date),
        )
        .map((m) => matchCard(m))
        .join("")
    : empty("Nenhuma partida publicada para esta seleção.");
}
function view() {
  if (section === "overview")
    return `<div class="grid">${[
      ["Equipes", state.teams.length],
      ["Jogadores", state.players.length],
      [
        "Partidas ao vivo",
        state.matches.filter((m) => m.status === "Ao vivo").length,
      ],
    ]
      .map(
        ([l, n]) =>
          `<div class="card"><span class="muted">${l}</span><div class="kpi">${n}</div></div>`,
      )
      .join("")}</div><h2>Quadra e campo</h2><div class="grid">${
      state.matches.length
        ? state.matches
            .slice(-6)
            .reverse()
            .map((m) => matchCard(m, true))
            .join("")
        : empty(
            "Comece cadastrando duas equipes e seus jogadores; depois crie uma partida.",
          )
    }</div>`;
  if (section === "teams")
    return `<div class="card"><h2>Cadastrar equipe</h2><form id="team"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome da equipe", "name", "text", 'required maxlength="150"')}${field("Sigla", "short", "text", 'maxlength="12"')}${field("Técnico(a)", "coach")}${field("Categoria", "category")}${field("Endereço HTTPS do escudo / bandeira", "badge", "url")}</div><button class="primary">Salvar equipe</button> <button type="button" data-section="imports">Importar equipes</button></form></div><div class="grid">${state.teams.map((t) => `<div class="card">${badge(t)}<h3>${esc(t.name)}</h3><p class="muted">${esc(t.category)}<br>Técnico: ${esc(t.coach || "Não informado")}</p><button data-edit-team="${t.id}">Editar equipe</button></div>`).join("")}</div>`;
  if (section === "players")
    return `<div class="card"><h2>Cadastrar jogador</h2><p class="muted">Cadastre o elenco antes de criar a partida. A súmula preserva uma cópia do elenco daquela data.</p><form id="player"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome", "name", "text", "required")}${select("Equipe", "team", teamOptions())}${field("Número", "number")}${field("Posição", "position")}${select("Escalação", "reserve", '<option value="false">Titular</option><option value="true">Reserva / banco</option>')}</div><button class="primary">Salvar jogador</button> <button type="button" data-section="imports">Importar jogadores</button></form></div><div class="card">${table(
      ["Nome", "Equipe", "Número", "Posição", "Escalação", "Ação"],
      state.players.map((p) =>
        tr([
          p.name,
          name(p.team),
          p.number,
          p.position,
          p.reserve ? "Reserva" : "Titular",
        ]).replace(
          "</tr>",
          `<td><button data-edit-player="${p.id}">Editar</button></td></tr>`,
        ),
      ),
    )}</div>`;
  if (section === "matches")
    return selected
      ? operate()
      : `<div class="card"><h2>Programar partida</h2><form id="match"><div class="formgrid">${select(
          "Modalidade",
          "sport",
          options(
            D.SPORTS,
            (x) => x,
            (x) => x,
          ),
        )}${select("Equipe da casa", "home", teamOptions())}${select("Equipe visitante", "away", teamOptions())}${field("Data e horário (horário deste computador)", "date", "datetime-local", "required")}${field("Local", "place")}${field("Competição / edição", "competition")}${field("Árbitros e mesários", "referees")}${field("Etapa inicial (ex.: 1 ou 1º quarto)", "stage", "text", 'value="1"')}</div><button class="primary" ${role === "admin" ? "" : "disabled"}>Criar partida</button></form></div><div class="grid">${state.matches.map((m) => matchCard(m, true)).join("")}</div>`;
  if (section === "imports") return importView();
  if (section === "reports") return reports();
  if (section === "settings")
    return `<div class="card"><h2>Personalizar a central</h2><form id="settings"><div class="formgrid">${field("Título", "title", "text", `value="${esc(state.settings.title)}" required`)}${field("Subtítulo", "subtitle", "text", `value="${esc(state.settings.subtitle)}"`)}${field("Cor de destaque", "color", "color", `value="${esc(state.settings.color)}"`)}${field("Endereço HTTPS da imagem de capa", "banner", "url", `value="${esc(state.settings.banner)}"`)}</div><button class="primary">Salvar aparência</button></form><p class="muted">Nesta versão, escudos e capa utilizam endereços HTTPS de imagens já hospedadas.</p></div>`;
  return "";
}
// 3 — O Firestore valida permissões, auditoria e transições em firestore.rules.
// 4 — Operação da partida. Sem apagar eventos: pontos errados recebem estorno.
function operate() {
  const m = state.matches.find((m) => m.id === selected);
  if (!m) {
    selected = "";
    return view();
  }
  const locked = ["Encerrada", "Homologada"].includes(m.status);
  return `<button data-back class="noprint">← Voltar às partidas</button><div class="split" style="margin-top:20px"><div>${matchCard(m)}<div class="card"><h3>Controle da partida</h3><div class="toolbar">${m.status === "Agendada" ? '<button data-status="Ao vivo" class="primary">Iniciar</button>' : ""}${m.status === "Ao vivo" ? '<button data-status="Pausada">Pausar</button><button data-status="Encerrada">Encerrar</button>' : ""}${m.status === "Pausada" ? '<button data-status="Ao vivo">Retomar</button><button data-status="Encerrada">Encerrar</button>' : ""}${m.status === "Encerrada" && role === "admin" ? '<button data-status="Homologada">Homologar</button>' : ""}${locked && role === "admin" ? '<button data-status="Ao vivo">Reabrir com justificativa</button>' : ""}</div>${!locked ? `<form id="stage" class="row" style="margin-top:15px"><input name="stage" aria-label="Etapa" value="${esc(m.stage)}" required style="max-width:140px"><button>Atualizar etapa</button></form>${m.sport.startsWith("Vôlei") ? '<p class="muted">Parciais manuais: confira o regulamento antes de fechar cada set.</p><button data-set>Fechar set e iniciar próximo</button>' : ""}` : ""}</div></div><div><div class="card"><h3>Registrar lance</h3>${
    locked
      ? "<p>Partida bloqueada para novos lançamentos.</p>"
      : `<form id="event"><div class="formgrid">${select("Equipe", "side", `<option value="0">${esc(name(m.home))}</option><option value="1">${esc(name(m.away))}</option>`)}${select(
          "Tipo",
          "kind",
          options(
            [
              "ponto",
              "cartão amarelo",
              "cartão vermelho",
              "falta",
              "substituição",
              "tempo",
              "observação",
            ],
            (x) => x,
            (x) => x,
          ),
        )}${select(
          "Valor do ponto",
          "value",
          options(
            m.sport === "Basquete" ? [3] : [1],
            (x) => x,
            (x) => x,
          ),
        )}${select(
          "Atleta (opcional)",
          "player",
          '<option value="">Sem atleta</option>' +
            options(
              m.roster.filter((p) => p.team === m.home),
              (x) => x.id,
              (x) => x.number + " • " + x.name,
            ),
        )}</div><label>Detalhes / jogador que entra e sai<textarea name="text" maxlength="500"></textarea></label><p><button class="primary" ${m.status !== "Ao vivo" ? "disabled" : ""}>Registrar lance</button></p></form>`
  }</div><div class="card"><h3>Observações da súmula</h3><form id="notes"><label>Ocorrências e observações<textarea name="notes" maxlength="5000" ${locked ? "disabled" : ""}>${esc(m.notes)}</textarea></label><p><button ${locked ? "disabled" : ""}>Salvar observações</button></p></form></div></div></div><div class="card"><h3>Histórico da partida</h3>${
    m.events
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="event"><b>${esc(e.type)}</b> ${[0, 1].includes(e.side) ? esc(name([m.home, m.away][e.side])) : ""} ${e.type === "ponto" ? esc(e.value > 0 ? "+" + e.value : e.value) : ""} ${esc(e.text || "")} ${esc(e.reason || "")}<br><small>${esc(format(e.at))} • ${esc(e.actor)} • Etapa ${esc(e.stage || "—")}${e.player ? " • " + esc(m.roster.find((p) => p.id === e.player)?.name || "") : ""}</small>${!locked && role === "admin" && e.type === "ponto" && e.value > 0 && !m.events.some((x) => x.correctionOf === e.id) ? ` <button data-correct="${e.id}">Estornar</button>` : ""}</div>`,
      )
      .join("") || empty("Nenhum lançamento carregado.")
  }</div>`;
}
// 5 — Importação. Excel/CSV com cabeçalhos reconhecidos e prévia obrigatória.
const aliases = {
  name: [
    "nome",
    "name",
    "time",
    "equipe",
    "jogador",
    "atleta",
    "aluno",
    "nome do time",
    "nome do jogador",
  ],
  short: ["sigla"],
  coach: ["tecnico", "tecnica", "treinador"],
  category: ["categoria"],
  badge: ["escudo", "bandeira", "imagem"],
  teamName: ["equipe", "time", "nome do time"],
  number: ["numero", "camisa"],
  position: ["posicao"],
  reserve: ["reserva", "banco"],
};
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
function importView() {
  return `<div class="card"><span class="tag">CADASTRO EM LOTE</span><h2>Importar sem complicar</h2><p class="muted">Escolha o tipo, baixe o modelo e preencha até 300 linhas. A importação só acontece após conferir a prévia. Cadastros existentes são sinalizados e não são sobrescritos.</p><div class="formgrid">${select("Tipo de cadastro", "importKind", '<option value="team">Equipes</option><option value="player">Jogadores</option>')}<label>Arquivo Excel ou CSV<input id="importFile" type="file" accept=".xlsx,.csv"></label></div><button data-template>Baixar modelo Excel</button><p class="muted">Ou cole uma tabela com cabeçalho (colunas separadas por tabulação ou ponto e vírgula).</p><textarea id="paste" aria-label="Cole sua tabela"></textarea><p><button data-preview>Preparar prévia da lista</button></p><div id="preview"></div></div>`;
}
function sheetReady() {
  if (!window.XLSX)
    throw Error(
      "Biblioteca Excel indisponível. Confira sua conexão e recarregue a página.",
    );
}
function prepare(rows) {
  const kind = $("[name=importKind]").value;
  pendingImport = null;
  $("#preview").innerHTML = "";
  if (rows.length < 2 || rows.length > 301)
    throw Error("Use cabeçalho e de 1 a 300 linhas.");
  const heads = rows[0].map(norm),
    fields =
      kind === "team"
        ? ["name", "short", "coach", "category", "badge"]
        : ["name", "teamName", "number", "position", "reserve"];
  const maps = {};
  for (const f of fields)
    maps[f] = heads.findIndex((h) => aliases[f].includes(h));
  if (kind === "player") {
    const specific = heads.findIndex((h) =>
      [
        "nome",
        "nome do jogador",
        "jogador",
        "atleta",
        "aluno",
        "name",
      ].includes(h),
    );
    maps.name = specific;
  }
  if (maps.name < 0 || (kind === "player" && maps.teamName < 0))
    throw Error(
      "Cabeçalhos obrigatórios: Nome" +
        (kind === "player" ? " e Equipe" : "") +
        ". Baixe o modelo.",
    );
  const valid = [],
    errors = [],
    seen = new Set();
  rows.slice(1).forEach((row, i) => {
    const d = {};
    for (const f of fields)
      d[f] = maps[f] >= 0 ? String(row[maps[f]] ?? "").trim() : "";
    if (!Object.values(d).some(Boolean)) return;
    d.reserve = ["sim", "true", "1", "reserva", "banco"].includes(
      norm(d.reserve),
    );
    try {
      if (!d.name) throw Error("Nome ausente.");
      const k =
        norm(d.name) + "|" + (kind === "player" ? norm(d.teamName) : "");
      if (seen.has(k)) throw Error("Duplicado no arquivo.");
      let draft = { ...d };
      if (kind === "player") {
        const t = state.teams.find((t) => norm(t.name) === norm(d.teamName));
        if (!t) throw Error("Equipe não cadastrada: " + d.teamName);
        draft.team = t.id;
        d.teamName = t.name;
      }
      D.reduce(state, { type: kind, data: draft });
      seen.add(k);
      valid.push(d);
    } catch (e) {
      errors.push("Linha " + (i + 2) + ": " + e.message);
    }
  });
  pendingImport = {
    type: "import",
    kind,
    rows: valid,
    importLabel: $("#importFile")?.files[0]?.name || "Lista colada",
  };
  $("#preview").innerHTML =
    `<h3>Prévia: ${valid.length} válidos • ${errors.length} com problemas</h3>${errors.length ? '<p class="danger">' + errors.map(esc).join("<br>") + "</p>" : ""}${table(
      fields.map(
        (f) =>
          ({
            name: "Nome",
            short: "Sigla",
            coach: "Técnico",
            category: "Categoria",
            badge: "Escudo",
            teamName: "Equipe",
            number: "Número",
            position: "Posição",
            reserve: "Reserva",
          })[f],
      ),
      valid.map((r) =>
        tr(
          fields.map((f) =>
            typeof r[f] === "boolean" ? (r[f] ? "Sim" : "Não") : r[f],
          ),
        ),
      ),
    )}<p><button data-confirm-import class="primary" ${valid.length ? "" : "disabled"}>Confirmar ${valid.length} cadastros válidos</button></p><small>Linhas com problemas serão ignoradas. No Firebase, cada linha válida tem gravação e auditoria próprias; se houver interrupção, prepare outra prévia.</small>`;
}
// 6 — Relatórios. PDF usa a impressão do navegador; Excel contém várias abas.
function reportMatch(m) {
  const sc = m.sport.startsWith("Vôlei")
    ? [
        m.sets.filter((s) => s.score[0] > s.score[1]).length,
        m.sets.filter((s) => s.score[1] > s.score[0]).length,
      ]
    : D.score(m);
  return `<article class="card"><h2>Súmula • ${esc(m.sport)}</h2><h3>${esc(name(m.home))} ${sc.join(" × ")} ${esc(name(m.away))}</h3><p>Competição: ${esc(m.competition)}<br>Data: ${esc(format(m.date))} • Local: ${esc(m.place)}<br>Arbitragem / mesa: ${esc(m.referees)}<br>Técnicos: ${esc(m.coaches.join(" / "))}<br>Situação: ${esc(m.status)} • Etapa: ${esc(m.stage)}</p>${m.sets.length ? "<p>Parciais: " + m.sets.map((s) => esc(s.score.join(" × "))).join(" / ") + "</p>" : ""}${table(
    ["Equipe", "Jogador", "Nº", "Posição", "Escalação"],
    m.roster.map((p) =>
      tr([
        name(p.team),
        p.name,
        p.number,
        p.position,
        p.reserve ? "Reserva" : "Titular",
      ]),
    ),
  )}<h3 style="margin-top:20px">Lançamentos</h3>${table(
    [
      "Horário",
      "Etapa",
      "Tipo",
      "Equipe",
      "Atleta",
      "Valor",
      "Detalhes",
      "Responsável",
    ],
    m.events.map((e) =>
      tr([
        format(e.at),
        e.stage,
        e.type,
        [1].includes(e.side) ? name([m.home, m.away][e.side]) : "",
        m.roster.find((p) => p.id === e.player)?.name || "",
        e.type === "ponto" ? e.value : "",
        e.text || e.reason || "",
        e.actor,
      ]),
    ),
  )}<p style="white-space:pre-wrap">Observações: ${esc(m.notes)}</p><p style="margin-top:45px">Árbitro: ____________________ &nbsp; Mesa: ____________________</p><p>Responsáveis das equipes: ____________________ / ____________________</p><small>Súmula do sistema; assinaturas acima são campos para preenchimento em papel.</small></article>`;
}
function reports() {
  return `<div class="card noprint"><h2>Súmulas e relatórios</h2><div class="formgrid">${select(
    "Partida",
    "reportMatch",
    '<option value="">Todas as partidas</option>' +
      options(
        state.matches,
        (m) => m.id,
        (m) => name(m.home) + " × " + name(m.away) + " • " + format(m.date),
      ),
  )}</div><div class="toolbar"><button data-report-pdf>Imprimir / salvar PDF</button><button data-report-excel class="primary">Exportar Excel</button><button data-audit-excel>Exportar auditoria completa</button><button data-backup>Baixar cópia JSON</button></div><p class="muted">No PDF, escolha “Salvar como PDF” na janela de impressão. O Excel inclui resultados, elencos, eventos e parciais. A cópia JSON é para consulta; não há restauração automática nesta versão.</p></div><div id="reportOutput">${state.matches.map(reportMatch).join("") || empty("Cadastre uma partida para gerar a súmula.")}</div>`;
}
function exportExcel() {
  sheetReady();
  const filter = $("[name=reportMatch]").value,
    ms = state.matches.filter((m) => !filter || m.id === filter),
    wb = XLSX.utils.book_new();
  const add = (title, rows) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), title);
  add(
    "Resultados",
    ms.map((m) => ({
      ID: m.id,
      Modalidade: m.sport,
      Competição: m.competition,
      Casa: name(m.home),
      Visitante: name(m.away),
      PontosCasa: D.score(m)[0],
      PontosVisitante: D.score(m)[1],
      SetsCasa: m.sets.filter((s) => s.score[0] > s.score[1]).length,
      SetsVisitante: m.sets.filter((s) => s.score[1] > s.score[0]).length,
      Data: format(m.date),
      Local: m.place,
      Arbitragem: m.referees,
      Situação: m.status,
      Observações: m.notes,
    })),
  );
  add(
    "Elencos",
    ms.flatMap((m) =>
      m.roster.map((p) => ({
        Partida: m.id,
        Equipe: name(p.team),
        Nome: p.name,
        Número: p.number,
        Posição: p.position,
        Reserva: p.reserve ? "Sim" : "Não",
      })),
    ),
  );
  add(
    "Eventos",
    ms.flatMap((m) => m.events.map((e) => ({ Partida: m.id, ...e }))),
  );
  add(
    "Sets",
    ms.flatMap((m) =>
      m.sets.map((s, i) => ({
        Partida: m.id,
        Set: i + 1,
        Casa: s.score[0],
        Visitante: s.score[1],
      })),
    ),
  );
  XLSX.writeFile(wb, "relatorio-esportivo.xlsx");
}
// O Excel limita o tamanho de cada célula: snapshots grandes são divididos em colunas.
function auditChunks(label, value) {
  const text = JSON.stringify(value);
  const fields = {};
  for (let offset = 0; offset < text.length; offset += 30000)
    fields[label + " " + (1 + offset / 30000)] = text.slice(
      offset,
      offset + 30000,
    );
  return fields;
}
function download(name, value) {
  const u = URL.createObjectURL(
      new Blob([value], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
// EVENTOS DE INTERFACE — um único ponto de entrada para cada ação.
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const f = e.target,
      d = data(f);
    if ("recordId" in d) {
      d.id = d.recordId;
      delete d.recordId;
    }
    if (f.id === "login") {
      await cloud.auth.signInWithEmailAndPassword(
        cloud.authentication,
        d.email,
        d.password,
      );
      return;
    }
    if (["team", "player", "match", "settings"].includes(f.id)) {
      if (f.id === "player") d.reserve = d.reserve === "true";
      if (f.id === "match") d.date = new Date(d.date).toISOString();
      await dispatch({ type: f.id, data: d });
      if (!C.demo) f.reset();
    } else if (f.id === "event")
      await dispatch({
        type: "event",
        matchId: selected,
        kind: d.kind,
        side: Number(d.side),
        value: Number(d.value),
        player: d.player,
        text: d.text,
      });
    else if (f.id === "stage")
      await dispatch({ type: "stage", matchId: selected, stage: d.stage });
    else if (f.id === "notes")
      await dispatch({ type: "notes", matchId: selected, notes: d.notes });
  } catch (e) {
    toast(e.message, true);
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.editTeam || b.dataset.editPlayer) {
      const kind = b.dataset.editTeam ? "team" : "player",
        item = (kind === "team" ? state.teams : state.players).find(
          (x) => x.id === (b.dataset.editTeam || b.dataset.editPlayer),
        );
      const f = $("#" + kind);
      for (const [k, v] of Object.entries(item)) {
        const control = f.elements[k === "id" ? "recordId" : k];
        if (control) control.value = String(v);
      }
      f.scrollIntoView({ behavior: "smooth" });
      toast("Cadastro carregado. Altere e clique em salvar.");
    } else if (b.dataset.section) {
      cloud?.stopHistory();
      section = b.dataset.section;
      selected = "";
      pendingImport = null;
      render();
      if (section === "reports" && !C.demo) {
        toast("Carregando históricos para as súmulas…");
        await cloud.loadHistory(state.matches.map((m) => m.id));
      }
    } else if (b.dataset.open) {
      selected = b.dataset.open;
      section = "matches";
      render();
      if (!C.demo) await cloud.loadHistory([selected], { live: true });
    } else if (b.hasAttribute("data-back")) {
      cloud?.stopHistory();
      selected = "";
      render();
    } else if (b.dataset.status) {
      const m = state.matches.find((m) => m.id === selected);
      let reason = "";
      if (
        ["Encerrada", "Homologada"].includes(m.status) &&
        b.dataset.status === "Ao vivo"
      ) {
        reason = prompt("Justificativa para reabrir a partida:");
        if (!reason) return;
      }
      if (
        ["Encerrada", "Homologada"].includes(b.dataset.status) &&
        !confirm("Confirmar " + b.dataset.status.toLowerCase() + "?")
      )
        return;
      await dispatch({
        type: "status",
        matchId: selected,
        status: b.dataset.status,
        reason,
      });
    } else if (b.dataset.correct) {
      const reason = prompt("Justificativa do estorno:");
      if (reason)
        await dispatch({
          type: "correct",
          matchId: selected,
          eventId: b.dataset.correct,
          reason,
        });
    } else if (b.hasAttribute("data-set")) {
      if (confirm("Conferiu a parcial e o regulamento? Fechar set?"))
        await dispatch({ type: "set", matchId: selected });
    } else if (b.hasAttribute("data-template")) {
      sheetReady();
      const isPlayer = $("[name=importKind]").value === "player",
        rows = isPlayer
          ? [
              ["Nome", "Equipe", "Número", "Posição", "Reserva"],
              [
                "Jogador exemplo",
                "Nome exato da equipe",
                "10",
                "Atacante",
                "Não",
              ],
            ]
          : [
              ["Nome", "Sigla", "Técnico", "Categoria", "Escudo"],
              ["Equipe exemplo", "EQP", "Técnico exemplo", "Sub-17", ""],
            ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Modelo");
      XLSX.writeFile(
        wb,
        isPlayer ? "modelo-jogadores.xlsx" : "modelo-equipes.xlsx",
      );
    } else if (b.hasAttribute("data-preview")) {
      sheetReady();
      const wb = XLSX.read($("#paste").value, { type: "string", raw: true });
      prepare(
        XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
          defval: "",
        }),
      );
    } else if (b.hasAttribute("data-confirm-import")) {
      if (pendingImport?.rows.length) {
        const action = pendingImport;
        await dispatch(action);
        pendingImport = null;
        if (!C.demo) toast("Importação concluída.");
      }
    } else if (b.hasAttribute("data-report-pdf")) {
      window.print();
    } else if (b.hasAttribute("data-report-excel")) {
      if (!C.demo) {
        const filter = $("[name=reportMatch]").value;
        await cloud.loadHistory(
          state.matches
            .filter((m) => !filter || m.id === filter)
            .map((m) => m.id),
        );
      }
      exportExcel();
    } else if (b.hasAttribute("data-audit-excel")) {
      if (C.demo)
        throw Error(
          "Auditoria oficial está disponível após conectar ao Firebase.",
        );
      sheetReady();
      toast("Consultando auditoria…");
      const rows = await cloud.auditRows(),
        wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          rows.map((r) => ({
            ID: r.ID,
            Data: r.at?.toDate?.().toLocaleString("pt-BR") || "",
            Usuário: r.actor,
            Entidade: r.entity,
            Registro: r.target,
            Revisão: r.revision,
            Ação: r.detail.type,
            Detalhes: r.detail.text,
            Motivo: r.detail.reason,
            ...auditChunks("Antes", r.before),
            ...auditChunks("Depois", r.after),
          })),
        ),
        "Auditoria",
      );
      XLSX.writeFile(wb, "auditoria-esportiva.xlsx");
    } else if (b.hasAttribute("data-backup"))
      download("arena-copia.json", JSON.stringify(state, null, 2));
    else if (b.id === "logout") await cloud.auth.signOut(cloud.authentication);
  } catch (e) {
    toast(e.message, true);
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (e.target.id === "filter") {
      publicFilter = e.target.value;
      $("#publicMatches").innerHTML = publicMatches(publicFilter);
    }
    if (e.target.name === "reportMatch") {
      reportFilter = e.target.value;
      $("#reportOutput").innerHTML = state.matches
        .filter((m) => !reportFilter || m.id === reportFilter)
        .map(reportMatch)
        .join("");
    }
    if (e.target.name === "importKind") {
      pendingImport = null;
      $("#preview").innerHTML = "";
      $("#importFile").value = "";
    }
    if (e.target.id === "importFile") {
      pendingImport = null;
      $("#preview").innerHTML = "";
      sheetReady();
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024)
        throw Error("Arquivo muito grande. Máximo: 3 MB.");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", raw: true });
      prepare(
        XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
          header: 1,
          defval: "",
        }),
      );
    }
    if (e.target.name === "side") {
      const m = state.matches.find((m) => m.id === selected);
      $("[name=player]").innerHTML =
        '<option value="">Sem atleta</option>' +
        options(
          m.roster.filter(
            (p) => p.team === [m.home, m.away][Number(e.target.value)],
          ),
          (x) => x.id,
          (x) => x.number + " • " + x.name,
        );
    }
  } catch (e) {
    toast(e.message, true);
  }
});
window.addEventListener("offline", () => {
  $("#mode").textContent =
    "SEM CONEXÃO • Firebase: novos lançamentos exigem conexão.";
});
boot();
