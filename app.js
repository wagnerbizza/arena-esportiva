/* APLICAÇÃO — seções numeradas para facilitar futuras alterações.
   1 conexão | 2 visualização | 3 cadastros | 4 partida | 5 importação | 6 relatórios.
   Nunca acrescente senhas neste arquivo. Dados externos são escapados antes da exibição. */
// Arquivo sem ferramenta de compilação: funciona no GitHub Pages.
const D = window.Domain,
  C = window.CONFIG,
  M = window.SparkModel,
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
let accessStatus = "loading",
  authMode = new URLSearchParams(location.search).get("acesso") === "cadastro" ? "register" : "login",
  accessBusy = false,
  managedUserId = "";
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
    multi: [...f.querySelectorAll("select[multiple]")].map((e) => [e.name, [...e.selectedOptions].map((o) => o.value)]),
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
    if (target) for (const [name, values] of f.multi) {
      const select = target.elements[name];
      if (select) for (const option of select.options) option.selected = values.includes(option.value);
    }
  }
  if ($("#event") && $("[name=side]")) {
    const m = state.matches.find((m) => m.id === selected),
      side = Number($("[name=side]").value),
      saved =
        forms
          .find((f) => f.id === "event")
          ?.values.find(([n]) => n === "player")?.[1] || "";
    if (m) {
      $("[name=player]").innerHTML =
        '<option value="">Sem atleta</option>' +
        options(
          m.roster.filter((p) => p.team === [m.home, m.away][side]),
          (p) => p.id,
          (p) => p.number + " • " + p.name,
        );
      $("[name=player]").value = saved;
    }
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
  const fallback = esc(t.short || t.name.slice(0, 2).toUpperCase());
  return `<span class="crest"><span class="crest-fallback">${fallback}</span>${t.badge ? `<img src="${esc(t.badge)}" alt="Escudo de ${esc(t.name)}" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
let quickPlayers = ["", ""];
const gameResult = (m) =>
  m.sport.startsWith("Vôlei")
    ? [
        m.sets.filter((s) => s.score[0] > s.score[1]).length,
        m.sets.filter((s) => s.score[1] > s.score[0]).length,
      ]
    : D.score(m);
function prettyTime(ms) {
  return M.clockText({ clock: { ...M.emptyClock(), baseMs: ms || 0 } });
}
function clockMarkup(m) {
  return `<div class="game-clock"><span class="clock-caption">${m.clock?.mode === "down" ? "Tempo restante" : "Tempo de jogo"}</span><strong data-clock="${esc(m.id)}">${m.clock ? M.clockText(m) : "—"}</strong><small>${m.clock?.running ? "EM CONTAGEM" : m.clock ? "PARADO" : "Aguardando ativação do cronômetro"}</small></div>`;
}
function updateClocks() {
  for (const el of document.querySelectorAll("[data-clock]")) {
    const m = state.matches.find((m) => m.id === el.dataset.clock);
    if (m) el.textContent = m.clock ? M.clockText(m) : "—";
  }
}
// Um intervalo apenas na tela: nenhum acesso ao Firestore a cada segundo.
setInterval(updateClocks, 250);
function eventLabel(e, m) {
  if (e.type === "ponto")
    return e.correctionOf
      ? "Estorno (" + e.value + ")"
      : (m.sport === "Futebol" || m.sport === "Futsal" ? "Gol" : "Ponto") +
          " +" +
          e.value;
  return (
    {
      cadastro: "Partida criada",
      status: "Situação da partida",
      etapa: "Mudança de etapa",
      súmula: "Observações",
      cronômetro: "Cronômetro",
      aviso: "Aviso ao público",
      set: "Set encerrado",
    }[e.type] || e.type
  );
}
// Mostra o acontecimento e sua justificativa juntos em todos os relatórios.
// Apenas apresentação: não altera eventos, placares ou a auditoria gravada.
function eventDescription(e) {
  const text = String(
    e.type === "cadastro" ? "Partida cadastrada na central" : e.text || "",
  ).trim();
  const reason = String(e.reason || "").trim();
  if (text && reason && text !== reason) {
    return `${text} — Motivo: ${reason}`;
  }
  return text || reason || "—";
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
      onSession: (u, r, access = {}) => {
        accessStatus = access.status || "loading";
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
      if (!["team", "player", "match", "settings", "import"].includes(a.type)) {
        const old = latest.matches.find((m) => m.id === a.matchId);
        if (!old) throw Error("Partida não encontrada.");
        const current = {
          ...old,
          score: D.score(old),
          rosterTeams:
            old.rosterTeams ||
            Object.fromEntries(old.roster.map((p) => [p.id, p.team])),
        };
        if (
          a.type === "correct" &&
          old.events.some((e) => e.correctionOf === a.eventId)
        )
          throw Error("Ponto já estornado.");
        const original =
          a.type === "correct"
            ? {
                entity: "matches",
                target: old.id,
                detail: old.events.find((e) => e.id === a.eventId),
              }
            : null;
        const r = M.applyMatch(current, a, original),
          event = {
            ...r.detail,
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
            actor: "demo",
            at: new Date().toISOString(),
            gameMs: M.elapsed(r.match),
          };
        const updated = { ...r.match, events: [...old.events, event] };
        latest.matches[latest.matches.findIndex((m) => m.id === old.id)] =
          updated;
        state = latest;
      } else {
        state = D.reduce(latest, a, "demo");
        if (a.type === "match") {
          const m = state.matches[state.matches.length - 1];
          m.clock = M.emptyClock();
          m.publicNotice = "";
        }
      }
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
    sc = gameResult(m),
    a = team(m.home),
    b = team(m.away);
  return `<article class="card match-card ${m.status === "Ao vivo" ? "is-live" : ""}"><div class="match-top"><span class="tag">${esc(m.sport)}</span><span class="status ${m.status === "Ao vivo" ? "live" : ""}">${m.status === "Ao vivo" ? "● " : ""}${esc(m.status)}</span></div><p class="competition-name">${esc(m.competition || "Partida avulsa")}</p><div class="score"><div>${badge(a)}<div class="name">${esc(a.name)}</div></div><strong>${sc[0]} <span class="muted">:</span> ${sc[1]}</strong><div>${badge(b)}<div class="name">${esc(b.name)}</div></div></div>${clockMarkup(m)}<div class="stage-line">Etapa: ${esc(m.stage)} ${m.sport.startsWith("Vôlei") ? " • Pontos do set: " + points.join(" × ") : ""}</div>${m.sets.length ? '<p class="muted">Parciais: ' + m.sets.map((s) => s.score.join("–")).join(" / ") + "</p>" : ""}${m.publicNotice ? `<div class="public-notice"><strong>${["Pausada", "Suspensa", "Adiada", "Cancelada"].includes(m.status) ? "Informação da partida" : "Aviso da organização"}</strong><p>${esc(m.publicNotice)}</p></div>` : ""}<p class="match-meta">${esc(format(m.date))}<br>${esc(m.place || "Local a definir")}</p><div class="match-bottom">${button && (role === "admin" || cloud?.canOperate(m.id)) ? `<button data-open="${m.id}">Operar partida →</button>` : ""}<span class="brand-signature">WagnerBIZZA</span></div></article>`;
}

function render() {
  document.documentElement.style.setProperty("--accent", state.settings.color);
  document.title = state.settings.title;
  document.body.classList.toggle("report-mode", admin && section === "reports");
  $("#logout")?.classList.toggle("hidden", C.demo || !user);
  if (admin && !C.demo && (!user || !role)) {
    app.innerHTML = accessView();
    if (accessBusy) app.querySelectorAll("button").forEach((b) => b.disabled = true);
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
  // Uma sessão rebaixada ou trocada não mantém uma aba administrativa aberta.
  if (role !== "admin" && !["overview", "matches"].includes(section)) {
    section = "overview";
    selected = "";
  }
  if (selected && !state.matches.some((m) => m.id === selected)) selected = "";
  const sections = [
    ["overview", "Visão geral"],
    ["teams", "Equipes"],
    ["players", "Jogadores"],
    ["matches", "Partidas"],
    ["imports", "Importar"],
    ["reports", "Súmulas e relatórios"],
    ["settings", "Configurações"],
    ["users", "Usuários e permissões"],
  ];
  app.innerHTML = `<div class="sectionhead admin-heading noprint"><div><span class="tag">PAINEL DA ORGANIZAÇÃO</span><h2>${esc(state.settings.title)}</h2></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span></div><nav>${sections
    .filter(
      ([id]) =>
        role === "admin" || ["overview", "matches"].includes(id),
    )
    .map(
      ([id, label]) =>
        `<button data-section="${id}" class="${section === id ? "active" : ""}">${label}</button>`,
    )
    .join("")}</nav><div id="view">${view()}</div>`;
  if (busy || accessBusy) app.querySelectorAll("button").forEach((b) => (b.disabled = true));
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
  if (section === "users" && role === "admin") return usersView();
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
    return `<div class="card"><h2>Cadastrar equipe</h2><form id="team"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome da equipe", "name", "text", 'required maxlength="150"')}${field("Sigla", "short", "text", 'maxlength="12"')}${field("Técnico(a)", "coach")}${field("Categoria", "category")}<input name="badge" type="hidden"><label>Imagem do escudo / bandeira<input id="badgeFile" type="file" accept="image/png,image/jpeg,image/webp"><small>Escolha uma imagem do computador. O painel reduz seu tamanho automaticamente.</small></label><label>Ou endereço HTTPS da imagem<input name="badgeURL" type="url" placeholder="https://..."></label><div class="logo-preview" id="badgePreview">${badge({ name: "Time", short: "TIME", badge: "" })}<button type="button" data-remove-badge>Remover imagem</button></div></div><button class="primary">Salvar equipe</button> <button type="button" data-section="imports">Importar equipes</button></form></div><div class="grid">${state.teams.map((t) => `<div class="card">${badge(t)}<h3>${esc(t.name)}</h3><p class="muted">${esc(t.category)}<br>Técnico: ${esc(t.coach || "Não informado")}</p><button data-edit-team="${t.id}">Editar equipe / escudo</button></div>`).join("")}</div>`;
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
  if (section === "matches" && role !== "admin" && !selected) {
    return `<div class="card"><h2>Minhas partidas</h2><p>Você pode operar somente as partidas atribuídas pelo administrador principal. Histórico, relatórios e auditoria são exclusivos dele.</p></div><div class="grid">${state.matches.map((m) => matchCard(m, true)).join("") || empty("Nenhuma partida atribuída à sua conta.")}</div>`;
  }
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
  const locked = ["Encerrada", "Homologada", "Cancelada"].includes(m.status),
    live = m.status === "Ao vivo",
    c = m.clock || M.emptyClock();
  const moves = {
    Agendada: [
      ["Ao vivo", "Iniciar jogo"],
      ["Adiada", "Adiar"],
      ["Cancelada", "Cancelar"],
    ],
    Adiada: [
      ["Ao vivo", "Iniciar jogo"],
      ["Agendada", "Voltar a agendada"],
      ["Cancelada", "Cancelar"],
    ],
    "Ao vivo": [
      ["Pausada", "Pausar jogo"],
      ["Suspensa", "Suspender"],
      ["Encerrada", "Encerrar"],
    ],
    Pausada: [
      ["Ao vivo", "Retomar jogo"],
      ["Suspensa", "Suspender"],
      ["Encerrada", "Encerrar"],
    ],
    Suspensa: [
      ["Ao vivo", "Retomar jogo"],
      ["Encerrada", "Encerrar"],
      ["Cancelada", "Cancelar"],
    ],
    Encerrada: [
      ["Homologada", "Homologar"],
      ["Ao vivo", "Reabrir com motivo"],
    ],
    Homologada: [["Ao vivo", "Reabrir com motivo"]],
    Cancelada: [["Agendada", "Reativar com motivo"]],
  };
  const buttons = (moves[m.status] || [])
    .filter(
      ([status]) =>
        role === "admin" ||
        (!["Cancelada", "Homologada"].includes(status) && !locked),
    )
    .map(
      ([status, label]) =>
        `<button type="button" data-status="${status}" class="${status === "Ao vivo" ? "primary" : ""}">${label}</button>`,
    )
    .join("");
  const quick = [0, 1]
    .map((side) => {
      const t = team([m.home, m.away][side]);
      return `<section class="quick-team"><div class="quick-team-title">${badge(t)}<h3>${esc(t.name)}</h3></div><label>Atleta (opcional)<select data-quick-player="${side}" aria-label="Atleta ${esc(t.name)}"><option value="">Sem atleta</option>${m.roster
        .filter((p) => p.team === t.id)
        .map(
          (p) =>
            `<option value="${esc(p.id)}" ${quickPlayers[side] === p.id ? "selected" : ""}>${esc(p.number + " • " + p.name + (p.reserve ? " (reserva)" : ""))}</option>`,
        )
        .join(
          "",
        )}</select></label><div class="quick-buttons">${(m.sport === "Basquete" ? [1, 2, 3] : [1]).map((v) => `<button class="quick-score primary" data-quick="${v}" data-side="${side}" ${!live ? "disabled" : ""}>+${v}<small>${m.sport === "Futebol" || m.sport === "Futsal" ? "GOL" : v > 1 ? "PONTOS" : "PONTO"}</small></button>`).join("")}</div></section>`;
    })
    .join("");
  return `<button data-back>← Voltar às partidas</button><div class="live-console"><div class="console-score">${matchCard(m)}<div class="card"><h3>Jogo e interrupções</h3><form id="interruption"><div class="formgrid"><label>Motivo de pausa / suspensão<select name="pauseReason"><option>Intervalo</option><option>Atendimento em quadra</option><option>Chuva ou condições do local</option><option>Problema técnico</option><option>Decisão da arbitragem</option><option>Outro motivo</option></select></label><label>Detalhes para o público<input name="pauseDetails" maxlength="220" placeholder="Ex.: retorno previsto em 10 minutos"></label></div><div class="toolbar">${buttons}</div></form><p class="muted">Pausar ou suspender o jogo para o cronômetro e informa o motivo ao público. O placar é preservado.</p>${!locked ? `<form id="stage" class="row"><input name="stage" aria-label="Etapa" value="${esc(m.stage)}" required style="max-width:180px"><button>Atualizar etapa</button></form>${m.sport.startsWith("Vôlei") ? "<p><button data-set>Fechar set e iniciar próximo</button></p>" : ""}<hr><h3>Cronômetro</h3><div class="toolbar"><button data-clock-command="${c.running ? "parar" : "iniciar"}" ${!c.running && !live ? "disabled" : ""}>${c.running ? "Parar somente o relógio" : "Iniciar relógio"}</button></div><details><summary>Ajustar tempo e contagem</summary><form id="clock-config"><div class="formgrid"><label>Modo<select name="clockMode"><option value="up" ${c.mode === "up" ? "selected" : ""}>Crescente (00:00 →)</option><option value="down" ${c.mode === "down" ? "selected" : ""}>Regressivo (duração → 00:00)</option></select></label>${field("Duração da etapa (min)", "durationMin", "number", `min="0" max="360" value="${Math.floor((c.durationMs || 600000) / 60000)}"`)}${field("Tempo já decorrido (min)", "elapsedMin", "number", `min="0" max="360" value="${Math.floor(M.elapsed(m) / 60000)}"`)}${field("Segundos decorridos", "elapsedSec", "number", `min="0" max="59" value="${Math.floor(M.elapsed(m) / 1000) % 60}"`)}${field("Motivo do ajuste", "clockReason", "text", 'required maxlength="300"')}</div><button ${c.running ? "disabled" : ""}>Salvar ajuste do cronômetro</button><p class="muted">Pare o relógio para ajustar. A troca de etapa não zera o tempo automaticamente. Ao chegar a zero, a contagem regressiva aguarda a decisão da arbitragem.</p></form></details>` : ""}</div></div><div class="console-actions"><div class="card quick-panel"><span class="tag">LANÇAMENTO RÁPIDO</span><h2>Marcar ponto</h2><p class="muted">Selecione o atleta, se desejar, e toque na pontuação da equipe.</p><div class="quick-grid">${quick}</div>${!live ? '<p class="public-notice">Os lançamentos ficam disponíveis quando o jogo está Ao vivo.</p>' : ""}</div><div class="card"><details><summary>Cartões, faltas, substituições e outros lances</summary>${
    locked
      ? "<p>Partida bloqueada.</p>"
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
        )}</div><label>Detalhes / jogador que entra e sai<textarea name="text" maxlength="500"></textarea></label><p><button class="primary" ${!live ? "disabled" : ""}>Registrar lance</button></p></form>`
  }</details></div><div class="card"><h3>Aviso para quem está assistindo</h3><form id="public-notice"><label>Mensagem pública<textarea name="notice" maxlength="300" ${locked ? "disabled" : ""}>${esc(m.publicNotice || "")}</textarea></label><p><button ${locked ? "disabled" : ""}>Publicar aviso</button></p></form></div><div class="card"><h3>Observações operacionais da súmula</h3><form id="notes"><label>Ocorrências<textarea name="notes" maxlength="5000" ${locked ? "disabled" : ""}>${esc(m.notes)}</textarea></label><p><button ${locked ? "disabled" : ""}>Salvar observações</button></p></form></div></div></div><div class="card"><h3>Histórico da partida</h3>${
    m.events
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="event"><div><b>${esc(eventLabel(e, m))}</b> ${[0, 1].includes(e.side) ? esc(name([m.home, m.away][e.side])) : ""}</div><p>${esc(eventDescription(e))}</p><small>${esc(format(e.at))} • ${e.gameMs != null ? "Jogo " + prettyTime(e.gameMs) + " • " : ""}Operador ${esc((e.actor || "").slice(0, 8))} • Etapa ${esc(e.stage || "—")}${e.player ? " • " + esc(m.roster.find((p) => p.id === e.player)?.name || "") : ""}</small>${!locked && role === "admin" && e.type === "ponto" && e.value > 0 && !m.events.some((x) => x.correctionOf === e.id) ? ` <button data-correct="${e.id}">Estornar</button>` : ""}</div>`,
      )
      .join("") || empty("Histórico disponível somente ao administrador principal, ou aguardando carregamento.")
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
  const sc = gameResult(m);
  const roster = [m.home, m.away]
    .map(
      (id, index) =>
        `<section class="roster-block"><h3>${esc(name(id))}</h3><p>Técnico(a): ${esc(m.coaches?.[index] || "Não informado")}</p>${table(
          ["Atleta", "Nº", "Posição", "Escalação"],
          m.roster
            .filter((p) => p.team === id)
            .map((p) =>
              tr([
                p.name,
                p.number,
                p.position,
                p.reserve ? "Reserva" : "Titular",
              ]),
            ),
        )}</section>`,
    )
    .join("");
  const rows = m.events
    .map(
      (e) =>
        `<tr><td>${esc(new Date(e.at).toLocaleTimeString("pt-BR"))}<small class="cell-sub">${e.gameMs != null ? "Jogo " + prettyTime(e.gameMs) : ""}</small></td><td>${esc(e.stage || "—")}</td><td>${esc(eventLabel(e, m))}</td><td>${[0, 1].includes(e.side) ? esc(name([m.home, m.away][e.side])) : "—"}${e.player ? '<small class="cell-sub">' + esc(m.roster.find((p) => p.id === e.player)?.name || "") + "</small>" : ""}</td><td>${esc(eventDescription(e))}</td><td>${esc((e.actor || "").slice(0, 8))}</td></tr>`,
    )
    .join("");
  return `<article class="card report-sheet"><div class="report-header"><div><span class="tag">SÚMULA DA PARTIDA</span><h2>${esc(m.competition || "Partida avulsa")} • ${esc(m.sport)}</h2></div><span class="report-brand">WagnerBIZZA</span></div><div class="report-score"><div>${badge(team(m.home))}<strong>${esc(name(m.home))}</strong></div><b>${sc.join(" × ")}</b><div>${badge(team(m.away))}<strong>${esc(name(m.away))}</strong></div></div><div class="report-meta"><p><b>Data:</b> ${esc(format(m.date))}<br><b>Local:</b> ${esc(m.place || "Não informado")}</p><p><b>Arbitragem / mesa:</b> ${esc(m.referees || "Não informada")}<br><b>Situação:</b> ${esc(m.status)} • <b>Etapa:</b> ${esc(m.stage)} • <b>Relógio:</b> ${m.clock ? M.clockText(m) : "Não utilizado"}</p></div>${m.publicNotice ? '<p class="report-alert"><b>Aviso:</b> ' + esc(m.publicNotice) + "</p>" : ""}${m.sets.length ? "<p><b>Parciais:</b> " + m.sets.map((s) => esc(s.score.join(" × "))).join(" / ") + "</p>" : ""}<div class="roster-grid">${roster}</div><h3>Histórico e ocorrências</h3><div class="tablewrap report-events"><table><thead><tr><th>Horário / jogo</th><th>Etapa</th><th>Acontecimento</th><th>Equipe / atleta</th><th>Descrição / motivo</th><th>Operador*</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Nenhum lançamento carregado.</td></tr>'}</tbody></table></div><small>* Identificador abreviado. A auditoria completa mantém a identificação integral de cada responsável. Horários dos lances referentes a ${esc(new Date(m.date).toLocaleDateString("pt-BR"))}.</small><section class="report-notes"><h3>Observações da súmula</h3><p>${esc(m.notes || "Sem observações.")}</p></section><section class="signatures"><div>Árbitro(a): __________________________</div><div>Mesa: __________________________</div><div>Responsável da equipe da casa: __________________________</div><div>Responsável da equipe visitante: __________________________</div><small>Súmula do sistema. Campos para assinatura em papel.</small></section></article>`;
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
  )}</div><div class="toolbar"><button data-report-pdf>Baixar súmula PDF</button><button data-report-print>Imprimir</button><button data-report-excel class="primary">Exportar Excel</button><button data-audit-excel>Exportar auditoria completa</button><button data-backup>Baixar cópia JSON</button></div><p class="muted">Use “Baixar súmula PDF” para o arquivo pronto ou “Imprimir” para abrir a janela de impressão. O Excel inclui resultados, elencos, eventos e parciais. A cópia JSON é para consulta; não há restauração automática nesta versão.</p></div><div id="reportOutput">${state.matches.map(reportMatch).join("") || empty("Cadastre uma partida para gerar a súmula.")}</div>`;
}
function exportExcel() {
  sheetReady();
  const filter = $("[name=reportMatch]").value,
    ms = state.matches.filter((m) => !filter || m.id === filter),
    wb = XLSX.utils.book_new();
  const add = (title, rows, headers) => {
    const sh = XLSX.utils.json_to_sheet(rows, { header: headers });
    sh["!cols"] = headers.map((h) => ({
      wch: Math.min(
        42,
        Math.max(
          h.length + 2,
          ...rows.map((r) => String(r[h] ?? "").length + 2),
          12,
        ),
      ),
    }));
    if (sh["!ref"]) sh["!autofilter"] = { ref: sh["!ref"] };
    XLSX.utils.book_append_sheet(wb, sh, title);
  };
  add(
    "Resultados",
    ms.map((m) => ({
      "ID da partida": m.id,
      Modalidade: m.sport,
      Competição: m.competition,
      "Equipe da casa": name(m.home),
      "Equipe visitante": name(m.away),
      "Pontos casa": D.score(m)[0],
      "Pontos visitante": D.score(m)[1],
      "Sets casa": m.sets.filter((s) => s.score[0] > s.score[1]).length,
      "Sets visitante": m.sets.filter((s) => s.score[1] > s.score[0]).length,
      "Data e hora": format(m.date),
      Local: m.place,
      Arbitragem: m.referees,
      Situação: m.status,
      "Tempo exibido": m.clock ? M.clockText(m) : "Não utilizado",
      "Aviso público": m.publicNotice || "",
      Observações: m.notes,
    })),
    [
      "ID da partida",
      "Modalidade",
      "Competição",
      "Equipe da casa",
      "Equipe visitante",
      "Pontos casa",
      "Pontos visitante",
      "Sets casa",
      "Sets visitante",
      "Data e hora",
      "Local",
      "Arbitragem",
      "Situação",
      "Tempo exibido",
      "Aviso público",
      "Observações",
    ],
  );
  add(
    "Elencos",
    ms.flatMap((m) =>
      m.roster.map((p) => ({
        "ID da partida": m.id,
        Equipe: name(p.team),
        Atleta: p.name,
        Número: p.number,
        Posição: p.position,
        Escalação: p.reserve ? "Reserva" : "Titular",
      })),
    ),
    ["ID da partida", "Equipe", "Atleta", "Número", "Posição", "Escalação"],
  );
  add(
    "Eventos",
    ms.flatMap((m) =>
      m.events.map((e) => ({
        "ID da partida": m.id,
        "Data e hora": format(e.at),
        "Tempo de jogo":
          e.gameMs != null ? prettyTime(e.gameMs) : "Não registrado",
        Etapa: e.stage || "",
        Acontecimento: eventLabel(e, m),
        Equipe: [0, 1].includes(e.side) ? name([m.home, m.away][e.side]) : "",
        Atleta: m.roster.find((p) => p.id === e.player)?.name || "",
        Pontuação: e.type === "ponto" ? e.value : "",
        Descrição: eventDescription(e),
        Justificativa: e.reason || "",
        "Responsável (UID)": e.actor,
        "ID do lançamento": e.id,
        "Lançamento estornado": e.correctionOf || "",
      })),
    ),
    [
      "ID da partida",
      "Data e hora",
      "Tempo de jogo",
      "Etapa",
      "Acontecimento",
      "Equipe",
      "Atleta",
      "Pontuação",
      "Descrição",
      "Justificativa",
      "Responsável (UID)",
      "ID do lançamento",
      "Lançamento estornado",
    ],
  );
  add(
    "Sets",
    ms.flatMap((m) =>
      m.sets.map((x, i) => ({
        "ID da partida": m.id,
        Set: i + 1,
        "Pontos casa": x.score[0],
        "Pontos visitante": x.score[1],
      })),
    ),
    ["ID da partida", "Set", "Pontos casa", "Pontos visitante"],
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
// 7 — Acesso e aprovação. Senhas ficam somente no Firebase Authentication.
function accessView() {
  const wrap = (content) => `<section class="card" style="max-width:520px;margin:40px auto"><span class="tag">ACESSO À CENTRAL</span>${content}</section>`;
  if (user) {
    const messages = {
      loading: "Conferindo sua autorização…",
      incomplete: "Sua conta foi criada, mas a solicitação de acesso ainda precisa ser concluída.",
      verify: "Confirme seu e-mail pelo link enviado pelo Firebase. A operação também depende da aprovação do administrador principal.",
      pending: "E-mail confirmado. Sua solicitação aguarda aprovação do administrador principal.",
      blocked: "Seu acesso está bloqueado. Procure o administrador principal.",
      unauthorized: "Esta conta ainda não está autorizada. Procure o administrador principal."
    };
    return wrap(`<h2>Situação do acesso</h2><p>${esc(user.email || "")}</p><p role="status">${messages[accessStatus] || messages.unauthorized}</p>${accessStatus === "incomplete" ? `<form id="complete-access">${field("Seu nome", "name", "text", 'required maxlength="100" autocomplete="name"')}<p><button class="primary">Concluir solicitação</button></p></form>` : ""}<div class="toolbar">${!user.emailVerified && accessStatus !== "loading" ? '<button type="button" data-access-verify>Enviar confirmação de e-mail</button>' : ""}<button type="button" data-access-refresh>Já confirmei / Atualizar acesso</button><button type="button" data-access-exit>Sair desta conta</button></div><p class="muted">O cadastro não autoriza alterações de placar. A senha não é exibida para a organização.</p>`);
  }
  if (authMode === "register") return wrap(`<h2>Solicitar acesso</h2><p>Cadastre sua conta de operador. O administrador principal aprovará o pedido e definirá as partidas autorizadas.</p><form id="register"><div style="display:grid;gap:14px">${field("Nome completo", "name", "text", 'required maxlength="100" autocomplete="name"')}${field("E-mail", "email", "email", 'required maxlength="254" autocomplete="email"')}${field("Senha (mínimo de 8 caracteres)", "password", "password", 'required minlength="8" autocomplete="new-password"')}${field("Confirmar senha", "confirmPassword", "password", 'required minlength="8" autocomplete="new-password"')}</div><p><button class="primary">Criar conta e solicitar acesso</button></p></form><button type="button" data-access-mode="login">Já tenho conta — entrar</button>`);
  if (authMode === "recover") return wrap(`<h2>Recuperar senha</h2><p>Informe seu e-mail para receber as instruções do Firebase.</p><form id="recover">${field("E-mail", "email", "email", 'required autocomplete="email"')}<p><button class="primary">Enviar instruções</button></p></form><button type="button" data-access-mode="login">Voltar para entrar</button>`);
  return wrap(`<h2>Entrar na organização</h2><form id="login"><div style="display:grid;gap:14px">${field("E-mail", "email", "email", 'required autocomplete="username"')}${field("Senha", "password", "password", 'required autocomplete="current-password"')}</div><p><button class="primary">Entrar</button></p></form><div class="toolbar"><button type="button" data-access-mode="register">Solicitar acesso</button><button type="button" data-access-mode="recover">Esqueci minha senha</button></div>`);
}
function accessError(e) {
  return ({
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/wrong-password": "E-mail ou senha inválidos.",
    "auth/user-not-found": "E-mail ou senha inválidos.",
    "auth/email-already-in-use": "Este e-mail já tem conta. Entre ou use Esqueci minha senha.",
    "auth/invalid-email": "Confira o endereço de e-mail.",
    "auth/weak-password": "A senha não atende aos requisitos do Firebase. Use uma senha mais forte.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
    "auth/network-request-failed": "Sem conexão com o Firebase. Confira sua internet.",
    "auth/user-disabled": "Esta conta foi desativada. Procure o administrador principal."
  })[e.code] || e.message;
}
async function accessAction(action) {
  if (accessBusy) return;
  accessBusy = true;
  app.querySelectorAll("button").forEach((b) => b.disabled = true);
  try { await action(); }
  catch (e) { toast(accessError(e), true); }
  finally { accessBusy = false; render(); }
}
function usersView() {
  if (C.demo) return `<div class="card"><h2>Usuários e permissões</h2><p>Esta função utiliza as contas reais do Firebase e não está disponível na demonstração local.</p></div>`;
  const owner = cloud?.mainUID;
  const users = (state.users || []).filter((u) => u.id !== owner).slice().sort((a,b) =>
    Number(b.role === "pending") - Number(a.role === "pending") || (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id));
  const label = (u) => u.role === "pending" ? "Aguardando aprovação" : u.role === "operator" ? u.enabled === false ? "Bloqueado" : "Operador aprovado" : "Perfil antigo — revisar";
  const link = new URL("painel.html", location.href);
  link.search = "?acesso=cadastro";
  const editing = users.find((u) => u.id === managedUserId);
  const editor = editing ? `<section class="card"><h3>Permissões de ${esc(editing.name || editing.email || "Operador cadastrado")}</h3><p>${esc(editing.email || "E-mail não registrado no perfil antigo")}<br><small>UID: ${esc(editing.id)}</small></p><form id="access-user"><input type="hidden" name="userId" value="${esc(editing.id)}"><label>Situação do acesso<select name="access"><option value="pending" ${editing.role === "pending" ? "selected" : ""}>Aguardando aprovação</option><option value="active" ${editing.role === "operator" && editing.enabled !== false ? "selected" : ""}>Aprovar / manter operador ativo</option><option value="blocked" ${editing.role === "operator" && editing.enabled === false ? "selected" : ""}>Bloquear acesso</option></select></label><p class="muted">Mesmo aprovado, o operador precisa confirmar o e-mail. Nenhum operador pode promover usuários ou acessar seus relatórios.</p><label>Partidas autorizadas (Ctrl+clique para selecionar várias)<select name="assignedMatches" multiple size="6" style="width:100%;min-height:150px">${state.matches.map((m) => `<option value="${esc(m.id)}" ${(editing.matches || []).includes(m.id) ? "selected" : ""}>${esc(m.sport + " • " + name(m.home) + " × " + name(m.away) + " • " + (m.competition || format(m.date)))}</option>`).join("")}</select></label><p class="muted">Sem seleção, o operador não recebe nenhuma partida. Voltar para pendente remove as atribuições.</p><label>Motivo da alteração<textarea name="reason" required maxlength="500" placeholder="Ex.: operador responsável pelos jogos da quadra 1"></textarea></label><p><button class="primary">Salvar permissões</button> <button type="button" data-access-cancel>Fechar edição</button></p></form></section>` : "";
  return `<section class="card"><h2>Usuários e permissões</h2><p><strong>Administrador principal: ${esc(user?.email || "Wagner")}</strong><br>Sua conta é protegida. Esta tela não permite alterar, bloquear ou remover sua autoridade.</p><label>Link para solicitar acesso<input readonly value="${esc(link.href)}"></label><p><button type="button" data-access-copy>Copiar link de cadastro</button></p><p class="muted">Envie esse link ao novo operador. Para testar outra conta neste computador, use uma janela anônima.</p></section><section class="card"><h3>Solicitações e operadores</h3>${table(["Pessoa", "Situação", "Partidas", "Ação"], users.map((u) => `<tr><td>${esc(u.name || "Operador cadastrado")}<br><small>${esc(u.email || u.id)}</small></td><td>${esc(label(u))}</td><td>${(u.matches || []).length}</td><td><button type="button" data-access-edit="${esc(u.id)}">Revisar permissões</button></td></tr>`))}${users.length ? "" : empty("Nenhuma solicitação recebida ainda.")}</section>${editor}<section class="card"><h3>Últimos 50 registros de permissões</h3>${(state.accessAudit || []).map((a) => `<div class="event"><b>${esc(a.action)}</b><p>${esc(a.after?.name || a.target)} — ${esc(a.reason)}</p><small>${esc(a.at?.toDate ? a.at.toDate().toLocaleString("pt-BR") : "Aguardando confirmação do servidor")} • ${esc(a.after?.enabled ? "Ativo" : "Sem acesso ativo")} • ${(a.after?.matches || []).length} partida(s)</small></div>`).join("") || empty("Nenhuma alteração de permissão registrada nesta versão.")}</section>`;
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
    if (["login", "register", "recover", "complete-access", "access-user"].includes(f.id)) {
      await accessAction(async () => {
        if (f.id === "login") {
          await cloud.auth.signInWithEmailAndPassword(cloud.authentication, d.email.trim(), d.password);
        } else if (f.id === "register") {
          if (d.password !== d.confirmPassword) throw Error("As duas senhas precisam ser iguais.");
          await cloud.register(d);
          toast("Conta criada. Confira seu e-mail, inclusive a pasta de spam, para confirmar o endereço.");
        } else if (f.id === "recover") {
          await cloud.recoverPassword(d.email);
          toast("Se houver uma conta para esse endereço, você receberá as instruções. Confira também o spam.");
        } else if (f.id === "complete-access") {
          await cloud.requestAccess(d.name);
          await cloud.resendVerification();
          toast("Solicitação registrada. Confira a confirmação enviada ao seu e-mail.");
        } else {
          await cloud.manageUser({userId:d.userId, access:d.access,
            matches: new FormData(f).getAll("assignedMatches"), reason:d.reason});
          managedUserId = "";
          toast("Permissões salvas e registradas no histórico.");
        }
      });
      return;
    }
    if (["team", "player", "match", "settings"].includes(f.id)) {
      if (f.id === "team") {
        delete d.badgeURL;
      }
      if (f.id === "player") d.reserve = d.reserve === "true";
      if (f.id === "match") d.date = new Date(d.date).toISOString();
      await dispatch({ type: f.id, data: d });
      if (!C.demo) f.reset();
    } else if (f.id === "clock-config") {
      await dispatch({
        type: "clock",
        matchId: selected,
        command: "ajustar",
        mode: d.clockMode,
        baseMs: (Number(d.elapsedMin) * 60 + Number(d.elapsedSec)) * 1000,
        durationMs: Number(d.durationMin) * 60000,
        reason: d.clockReason,
      });
    } else if (f.id === "public-notice") {
      await dispatch({ type: "notice", matchId: selected, notice: d.notice });
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
    if (b.dataset.accessMode) {
      authMode = b.dataset.accessMode;
      render();
      return;
    }
    if (b.hasAttribute("data-access-refresh")) {
      await accessAction(async () => { await cloud.refreshAccess(); toast("Acesso atualizado."); });
      return;
    }
    if (b.hasAttribute("data-access-verify")) {
      await accessAction(async () => { await cloud.resendVerification(); toast("Confira a confirmação no seu e-mail, inclusive no spam."); });
      return;
    }
    if (b.hasAttribute("data-access-exit")) {
      await cloud.auth.signOut(cloud.authentication);
      authMode = "login"; render(); return;
    }
    if (b.dataset.accessEdit) { managedUserId = b.dataset.accessEdit; render(); return; }
    if (b.hasAttribute("data-access-cancel")) { managedUserId = ""; render(); return; }
    if (b.hasAttribute("data-access-copy")) {
      const url = new URL("painel.html?acesso=cadastro", location.href).href;
      try { await navigator.clipboard.writeText(url); toast("Link copiado."); }
      catch { toast("Selecione e copie o endereço exibido no campo Link para solicitar acesso."); }
      return;
    }
    if (b.dataset.quick) {
      await dispatch({
        type: "event",
        matchId: selected,
        kind: "ponto",
        side: Number(b.dataset.side),
        value: Number(b.dataset.quick),
        player: quickPlayers[Number(b.dataset.side)] || "",
        text: "Lançamento rápido",
      });
    } else if (b.dataset.clockCommand) {
      await dispatch({
        type: "clock",
        matchId: selected,
        command: b.dataset.clockCommand,
      });
    } else if (b.hasAttribute("data-remove-badge")) {
      setBadgeDraft("");
    } else if (b.dataset.editTeam || b.dataset.editPlayer) {
      const kind = b.dataset.editTeam ? "team" : "player",
        item = (kind === "team" ? state.teams : state.players).find(
          (x) => x.id === (b.dataset.editTeam || b.dataset.editPlayer),
        );
      const f = $("#" + kind);
      for (const [k, v] of Object.entries(item)) {
        const control = f.elements[k === "id" ? "recordId" : k];
        if (control) control.value = String(v);
      }
      if (kind === "team") setBadgeDraft(item.badge || "");
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
      quickPlayers = ["", ""];
      section = "matches";
      render();
      if (!C.demo && role === "admin") await cloud.loadHistory([selected], { live: true });
    } else if (b.hasAttribute("data-back")) {
      cloud?.stopHistory();
      selected = "";
      render();
    } else if (b.dataset.status) {
      const m = state.matches.find((m) => m.id === selected);
      let reason = "";
      if (
        ["Pausada", "Suspensa", "Adiada", "Cancelada"].includes(
          b.dataset.status,
        )
      ) {
        const d = data($("#interruption"));
        reason = [d.pauseReason, d.pauseDetails]
          .filter(Boolean)
          .join(" — ")
          .slice(0, 300);
      }
      if (
        ["Encerrada", "Homologada", "Cancelada"].includes(m.status) &&
        b.dataset.status !== "Homologada"
      ) {
        reason = prompt("Justificativa para reativar ou reabrir a partida:");
        if (!reason) return;
      }
      if (
        ["Suspensa", "Cancelada", "Adiada"].includes(b.dataset.status) &&
        !confirm(
          "Confirmar " +
            b.dataset.status.toLowerCase() +
            "? O motivo será mostrado ao público.",
        )
      )
        return;
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
      if (!C.demo) {
        const filter = $("[name=reportMatch]").value;
        await cloud.loadHistory(
          state.matches
            .filter((m) => !filter || m.id === filter)
            .map((m) => m.id),
        );
      }
      toast("Preparando súmula PDF…");
      const { downloadReportPDF } = await import("./report-pdf.js");
      const ms = state.matches.filter(
        (m) => !reportFilter || m.id === reportFilter,
      );
      await downloadReportPDF(
        ms.map((m) => ({
          title: m.competition || "Partida avulsa",
          sport: m.sport,
          home: name(m.home),
          away: name(m.away),
          badges: [team(m.home).badge || "", team(m.away).badge || ""],
          score: gameResult(m).join(" x "),
          date: format(m.date),
          place: m.place || "Não informado",
          referees: m.referees || "Não informada",
          status: m.status,
          stage: m.stage,
          clock: m.clock ? M.clockText(m) : "Não utilizado",
          notice: m.publicNotice || "",
          sets: m.sets.map((s) => s.score.join(" x ")).join(" / "),
          coaches: m.coaches?.join(" / ") || "Não informados",
          roster: m.roster.map((p) => [
            name(p.team),
            p.name,
            p.number,
            p.position,
            p.reserve ? "Reserva" : "Titular",
          ]),
          events: m.events.map((e) => [
            new Date(e.at).toLocaleTimeString("pt-BR") +
              (e.gameMs != null ? "\nJogo " + prettyTime(e.gameMs) : ""),
            e.stage || "—",
            eventLabel(e, m),
            ([0, 1].includes(e.side) ? name([m.home, m.away][e.side]) : "") +
              (e.player
                ? "\n" + (m.roster.find((p) => p.id === e.player)?.name || "")
                : ""),
            eventDescription(e),
            (e.actor || "").slice(0, 8),
          ]),
          notes: m.notes,
        })),
      );
      toast("PDF gerado.");
    } else if (b.hasAttribute("data-report-print")) {
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
    if (e.target.dataset.quickPlayer !== undefined) {
      quickPlayers[Number(e.target.dataset.quickPlayer)] = e.target.value;
      return;
    }
    if (e.target.id === "badgeFile") {
      const file = e.target.files[0];
      if (file) {
        toast("Preparando imagem…");
        setBadgeDraft(await compactLogo(file));
        toast("Imagem pronta. Clique em Salvar equipe para publicar.");
      }
      return;
    }
    if (e.target.name === "badgeURL") {
      setBadgeDraft(e.target.value.trim());
      return;
    }
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
function setBadgeDraft(value) {
  const f = $("#team");
  if (!f) return;
  f.elements.badge.value = value;
  f.elements.badgeURL.value = value.startsWith("https://") ? value : "";
  $("#badgePreview").innerHTML =
    badge({
      name: f.elements.name.value || "Time",
      short: f.elements.short.value || "TIME",
      badge: value,
    }) + '<button type="button" data-remove-badge>Remover imagem</button>';
}
async function compactLogo(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("Escolha imagem PNG, JPG ou WebP.");
  if (file.size > 5 * 1024 * 1024) throw Error("A imagem deve ter até 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(Error("Não foi possível abrir a imagem."));
      im.src = url;
    });
    if (img.naturalWidth * img.naturalHeight > 24000000)
      throw Error(
        "Imagem muito grande. Use uma versão com menos de 24 megapixels.",
      );
    for (const size of [224, 160, 112, 80]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d"),
        ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight),
        w = img.naturalWidth * ratio,
        h = img.naturalHeight * ratio;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      for (const format of ["image/webp", "image/png"]) {
        const value = canvas.toDataURL(format, 0.82);
        if (value.length <= 40000) return value;
      }
    }
    throw Error("Não foi possível compactar esta imagem. Tente outra.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
const watermark = document.createElement("div");
watermark.className = "watermark";
watermark.textContent = "WagnerBIZZA";
document.body.append(watermark);
if ($("footer"))
  $("footer").textContent = "Arena • Central esportiva • WagnerBIZZA";
boot();
