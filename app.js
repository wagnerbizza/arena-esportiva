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

// 2.1 — FILTROS DA CENTRAL. Apenas consulta: não altera cadastros nem permissões.
// Para mudar a visualização inicial de partidas, altere group: "active" abaixo.
const listDefaults = {
  teams: { query: "", category: "" },
  players: { query: "", team: "", position: "", reserve: "" },
  matches: { query: "", sport: "", group: "active", status: "", championshipId: "" },
};
const listFilters = Object.fromEntries(Object.entries(listDefaults).map(([k, v]) => [k, { ...v }]));
const finalStatuses = ["Encerrada", "Homologada", "Cancelada"];
const matchStatuses = ["Agendada", "Adiada", "Ao vivo", "Pausada", "Suspensa", ...finalStatuses];
const searchText = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
const alphabetical = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { numeric: true });
function filteredRecords(kind) {
  const f = listFilters[kind], q = searchText(f.query);
  return state[kind].filter((r) => {
    if (kind === "teams") return (!q || searchText([r.name, r.short, r.coach].join(" ")).includes(q)) && (!f.category || (r.category || "") === f.category);
    if (kind === "players") return (!q || searchText([r.name, r.number].join(" ")).includes(q)) && (!f.team || r.team === f.team) && (!f.position || (r.position || "") === f.position) && (!f.reserve || String(Boolean(r.reserve)) === f.reserve);
    return (!q || searchText([name(r.home), name(r.away), r.competition, r.place].join(" ")).includes(q)) && (!f.championshipId || (f.championshipId === "__unlinked" ? !r.championshipId : r.championshipId === f.championshipId)) && (!f.sport || r.sport === f.sport) && (!f.status || r.status === f.status) && (f.group === "all" || (f.group === "finished" ? finalStatuses.includes(r.status) : !finalStatuses.includes(r.status)));
  }).sort(kind === "matches" ? (a, b) => {
    // Ao vivo primeiro; próximas em ordem de data, finalizadas mais recentes primeiro.
    if (f.group !== "finished") {
      const priority = (m) => m.status === "Ao vivo" ? 0 : m.status === "Pausada" ? 1 : 2;
      if (priority(a) !== priority(b)) return priority(a) - priority(b);
    }
    const date = (m) => Number(new Date(m.date)) || 0;
    return f.group === "finished" ? date(b) - date(a) : date(a) - date(b);
  } : alphabetical);
}
function filterSelect(kind, key, label, values, allLabel) {
  const f = listFilters[kind];
  const entries = values.map((v) => Array.isArray(v) ? v : [v, v]);
  // Preserva o filtro se um cadastro for alterado enquanto a lista está aberta.
  if (f[key] && !entries.some(([v]) => v === f[key])) entries.push([f[key], f[key]]);
  return `<label>${label}<select data-list-filter="${kind}" data-filter-key="${key}">${[["", allLabel], ...entries].map(([v, title]) => `<option value="${esc(v)}" ${f[key] === v ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>`;
}
function listPanel(kind) {
  const unique = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const f = listFilters[kind];
  const titles = { teams: "Equipes cadastradas", players: "Jogadores cadastrados", matches: role === "admin" ? "Partidas cadastradas" : "Partidas atribuídas" };
  let controls = `<label class="list-search">${kind === "matches" ? "Buscar equipe, competição ou local" : kind === "players" ? "Buscar nome ou número" : "Buscar equipe, sigla ou técnico"}<input type="search" data-list-filter="${kind}" data-filter-key="query" value="${esc(f.query)}" placeholder="Digite para buscar…" autocomplete="off"></label>`;
  if (kind === "teams") controls += filterSelect(kind, "category", "Categoria", unique(state.teams, "category"), "Todas as categorias");
  if (kind === "players") controls += filterSelect(kind, "team", "Equipe", state.teams.slice().sort(alphabetical).map((t) => [t.id, t.name]), "Todas as equipes") + filterSelect(kind, "position", "Posição", unique(state.players, "position"), "Todas as posições") + filterSelect(kind, "reserve", "Escalação", [["false", "Titular"], ["true", "Reserva / banco"]], "Todos");
  if (kind === "matches") controls += filterSelect(kind, "sport", "Modalidade", D.SPORTS, "Todas as modalidades") + filterSelect(kind, "status", "Situação específica", matchStatuses, "Todas as situações") + filterSelect(kind, "championshipId", "Campeonato / temporada", championshipFilterOptions(), "Todos os campeonatos");
  const groups = kind === "matches" ? `<div class="list-groups" aria-label="Visualização das partidas">${[["active", "Em andamento e próximas"], ["finished", "Finalizadas"], ["all", "Todas"]].map(([v, title]) => `<button type="button" data-list-group="${v}" aria-pressed="${f.group === v}" class="${f.group === v ? "primary" : ""}">${title}</button>`).join("")}</div>` : "";
  return `<section class="card list-filters" aria-label="Filtros de ${titles[kind]}"><h2>${titles[kind]}</h2>${groups}<div class="list-controls">${controls}<button type="button" data-list-reset="${kind}">Limpar filtros</button></div><p class="muted list-count" id="list-count-${kind}" role="status">${listCount(kind)}</p>${kind === "matches" ? '<small>Finalizadas inclui encerradas, homologadas e canceladas. Adiadas e suspensas continuam em andamento e próximas.</small>' : ""}</section><div id="list-results-${kind}" class="${kind === "players" ? "card" : "grid"}">${listResults(kind)}</div>`;
}
function listCount(kind) {
  return `${filteredRecords(kind).length} de ${state[kind].length} ${ { teams: "equipes", players: "jogadores", matches: "partidas" }[kind]} nesta visualização`;
}
function listResults(kind) {
  const rows = filteredRecords(kind);
  if (!rows.length) return empty(state[kind].length ? "Nenhum resultado com estes filtros. Use Limpar filtros ou, em Partidas, selecione Todas." : { teams: "Nenhuma equipe cadastrada.", players: "Nenhum jogador cadastrado.", matches: "Nenhuma partida disponível para sua conta." }[kind]);
  if (kind === "matches") return rows.map((m) => matchCard(m, true)).join("");
  if (kind === "teams") return rows.map((t) => `<div class="card">${badge(t)}<h3>${esc(t.name)}</h3><p class="muted">${esc(t.category || "Sem categoria")}<br>Técnico: ${esc(t.coach || "Não informado")}</p><button data-edit-team="${esc(t.id)}">Editar equipe / escudo</button></div>`).join("");
  return table(["Nome", "Equipe", "Número", "Posição", "Escalação", "Ação"], rows.map((p) => tr([p.name, name(p.team), p.number, p.position, p.reserve ? "Reserva" : "Titular"]).replace("</tr>", `<td><button data-edit-player="${esc(p.id)}">Editar</button></td></tr>`)));
}
function updateList(kind) {
  const results = document.getElementById(`list-results-${kind}`);
  if (results) results.innerHTML = listResults(kind);
  const count = document.getElementById(`list-count-${kind}`);
  if (count) count.textContent = listCount(kind);
}
function handleListFilter(e) {
  const el = e.target, kind = el.dataset?.listFilter, key = el.dataset?.filterKey;
  if (!listFilters[kind] || !Object.hasOwn(listFilters[kind], key)) return;
  listFilters[kind][key] = el.value;
  // Uma situação específica também abre o grupo correspondente automaticamente.
  if (kind === "matches" && key === "status" && el.value) {
    listFilters.matches.group = finalStatuses.includes(el.value) ? "finished" : "active";
    document.querySelectorAll("[data-list-group]").forEach((b) => {
      const active = b.dataset.listGroup === listFilters.matches.group;
      b.classList.toggle("primary", active); b.setAttribute("aria-pressed", String(active));
    });
  }
  updateList(kind);
}
document.addEventListener("input", (e) => { if (e.target.matches('[data-list-filter][type="search"]')) handleListFilter(e); });
document.addEventListener("change", (e) => { if (e.target.matches('select[data-list-filter]')) handleListFilter(e); });


// 2.2 — CAMPEONATOS E TEMPORADAS. Somente o administrador gerencia o cadastro.
// Cada edição tem seu próprio ID. Não são migrados nem apagados jogos antigos.
let editedChampionshipId = "", championshipQuery = "", championshipStatus = "";
const championshipTitle = (c) => `${c.name} • ${c.season}`;
function championshipFilterOptions() {
  const choices = new Map((state.championships || []).map((c) => [c.id, championshipTitle(c) + (c.category ? " • " + c.category : "")]));
  // Operadores usam apenas os vínculos presentes nas partidas já autorizadas.
  for (const m of state.matches) if (m.championshipId && !choices.has(m.championshipId)) choices.set(m.championshipId, m.competition || "Campeonato vinculado");
  return [["__unlinked", "Sem vínculo de campeonato"], ...[...choices].sort((a,b) => a[1].localeCompare(b[1], "pt-BR"))];
}
function championshipSelectForCreate() {
  const rows = (state.championships || []).filter((c) => c.status !== "Encerrado").sort(alphabetical);
  return `<label>Campeonato / temporada<select name="championshipId"><option value="">Sem vínculo — partida avulsa</option>${rows.map((c) => `<option value="${esc(c.id)}">${esc(championshipTitle(c) + " • " + c.sport + (c.category ? " • " + c.category : ""))}</option>`).join("")}</select><small>Ao escolher, a modalidade e o nome da competição são preenchidos. Cadastre edições na aba Campeonatos.</small></label>`;
}
function syncChampionshipDraft() {
  const f = $("#match"); if (!f) return;
  const c = (state.championships || []).find((c) => c.id === f.elements.championshipId.value);
  if (c) { f.elements.sport.value = c.sport; f.elements.competition.value = championshipTitle(c); }
  f.elements.competition.readOnly = Boolean(c);
}
function championshipsView() {
  const c = (state.championships || []).find((c) => c.id === editedChampionshipId);
  const value = (key) => esc(c?.[key] || "");
  return `<div class="card"><h2>${c ? "Editar campeonato / temporada" : "Cadastrar campeonato / temporada"}</h2><p class="muted">Crie um cadastro para cada edição, modalidade e categoria. Equipes e jogadores continuam disponíveis nos seus cadastros.</p><form id="championship"><input type="hidden" name="recordId" value="${value("id")}"><div class="formgrid">${field("Nome do campeonato", "name", "text", `required maxlength="100" value="${value("name")}"`)}${field("Edição / temporada", "season", "text", `required maxlength="40" placeholder="Ex.: 2026 ou 2º semestre de 2026" value="${value("season")}"`)}<label>Modalidade<select name="sport" required>${D.SPORTS.map((sport) => `<option ${c?.sport === sport ? "selected" : ""} ${c && c.sport !== sport ? "disabled" : ""}>${esc(sport)}</option>`).join("")}</select><small>A modalidade fica fixa após o cadastro. Para outra modalidade, crie um novo campeonato.</small></label>${field("Categoria", "category", "text", `maxlength="150" placeholder="Ex.: Livre, Sub-17, Feminino" value="${value("category")}"`)}<label>Situação<select name="status">${["Planejado","Em andamento","Encerrado"].map((status) => `<option ${c?.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label></div><button class="primary">${c ? "Salvar alterações" : "Cadastrar campeonato"}</button> ${c ? '<button type="button" data-new-championship>Cancelar edição / novo cadastro</button>' : ""}</form><p class="muted">Encerrar o campeonato impede criar novas partidas vinculadas; não encerra partidas automaticamente. Alterações do nome ou da edição não reescrevem súmulas existentes.</p></div><section class="card list-filters"><h2>Campeonatos cadastrados</h2><div class="list-controls"><label class="list-search">Buscar campeonato, edição, modalidade ou categoria<input type="search" data-championship-filter="query" value="${esc(championshipQuery)}" placeholder="Digite para buscar…"></label><label>Situação<select data-championship-filter="status"><option value="">Todas as situações</option>${["Planejado","Em andamento","Encerrado"].map((status) => `<option ${championshipStatus === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><button type="button" data-clear-championship-filters>Limpar filtros</button></div><p id="championship-count" class="muted" role="status">${championshipCount()}</p></section><div class="grid" id="championship-results">${championshipCards()}</div>`;
}
function visibleChampionships() {
  const q = searchText(championshipQuery);
  return (state.championships || []).filter((c) => (!championshipStatus || c.status === championshipStatus) && (!q || searchText([c.name,c.season,c.sport,c.category].join(" ")).includes(q))).sort(alphabetical);
}
function championshipCount() { return `${visibleChampionships().length} de ${(state.championships || []).length} campeonatos nesta visualização`; }
function championshipCards() {
  return visibleChampionships().map((c) => {
    const games = state.matches.filter((m) => m.championshipId === c.id);
    return `<article class="card championship-card"><div class="match-top"><span class="tag">${esc(c.sport)}</span><span class="status">${esc(c.status)}</span></div><h3>${esc(c.name)}</h3><p><strong>${esc(c.season)}</strong><br><span class="muted">${esc(c.category || "Sem categoria")}</span></p><p>${games.length} partidas vinculadas • ${games.filter((m) => ["Encerrada","Homologada","Cancelada"].includes(m.status)).length} finalizadas</p><div class="toolbar"><button data-edit-championship="${esc(c.id)}">Editar campeonato</button><button data-championship-games="${esc(c.id)}">Ver partidas</button></div></article>`;
  }).join("") || empty((state.championships || []).length ? "Nenhum campeonato corresponde aos filtros." : "Cadastre seu primeiro campeonato acima. As partidas antigas continuam na aba Partidas.");
}
function updateChampionshipList() {
  if ($("#championship-results")) $("#championship-results").innerHTML = championshipCards();
  if ($("#championship-count")) $("#championship-count").textContent = championshipCount();
}
function championshipLinkForm(m) {
  const rows = (state.championships || []).filter((c) => c.sport === m.sport).sort(alphabetical);
  return `<div class="card"><details><summary>Campeonato / temporada desta partida</summary><p class="muted">Vínculo atual: ${esc(m.championshipId ? ((state.championships || []).find((c) => c.id === m.championshipId) ? championshipTitle(state.championships.find((c) => c.id === m.championshipId)) : m.competition) : "Sem vínculo")}. O vínculo não altera placar, elenco ou cronômetro. Remover mantém o nome histórico da competição.</p><form id="championship-link"><label>Campeonato de ${esc(m.sport)}<select name="championshipId"><option value="">Sem vínculo</option>${rows.map((c) => `<option value="${esc(c.id)}" ${m.championshipId === c.id ? "selected" : ""}>${esc(championshipTitle(c) + (c.category ? " • " + c.category : "") + " — " + c.status)}</option>`).join("")}</select></label>${field("Justificativa (registrada no histórico)", "reason", "text", 'required maxlength="500"')}<p><button>Salvar vínculo com justificativa</button></p></form></details></div>`;
}
document.addEventListener("input", (e) => {
  if (e.target.dataset.championshipFilter === "query") { championshipQuery = e.target.value; updateChampionshipList(); }
});


// 2.3 — IDENTIDADE VISUAL E CONTA. Dados da sessão aparecem apenas na central.
// O logo é compactado e gravado nas configurações existentes, sem Firebase Storage.
let systemLogoBusy = false, systemLogoVersion = 0;
const accountRole = () => C.demo ? "Demonstração local" : role === "admin" ? "Administrador principal" : role === "operator" ? "Operador" : "Aguardando autorização";
const accountName = () => user?.displayName || (state.users || []).find((p) => p.id === user?.uid)?.name || user?.email?.split("@")[0] || "Conta conectada";
function renderBrandAndIdentity() {
  const brand = $("#systemBrand");
  if (brand) brand.innerHTML = `<span class="system-logo">${state.settings.logo ? `<img src="${esc(state.settings.logo)}" alt="Logo da organização" onerror="this.hidden=true">` : '<span aria-hidden="true">◈</span>'}</span><span class="brand-copy"><b>${esc(state.settings.title || "ARENA")}</b><small>CENTRAL ESPORTIVA</small></span>`;
  const identity = $("#sessionIdentity");
  if (!identity) return;
  identity.hidden = !admin || (!user && !C.demo);
  identity.innerHTML = identity.hidden ? "" : `<div><strong>${esc(C.demo ? "Demonstração local" : accountName())}</strong>${!C.demo ? `<span>${esc(user.email || "Sem e-mail informado")}</span>` : ""}<small>${esc(accountRole())}</small></div>${C.demo || role ? '<button type="button" data-my-account>Minha conta</button>' : ""}`;
}
function settingsView() {
  const s = state.settings;
  return `<div class="card"><h2>Identidade visual e configurações</h2><p class="muted">A aparência é compartilhada pelo painel público e pela central. Somente o administrador principal pode alterá-la.</p><form id="settings"><div class="formgrid">${field("Título do sistema", "title", "text", `value="${esc(s.title)}" required maxlength="100"`)}${field("Subtítulo", "subtitle", "text", `value="${esc(s.subtitle)}" maxlength="200"`)}${field("Cor de destaque", "color", "color", `value="${esc(s.color)}"`)}${field("Endereço HTTPS da imagem de capa", "banner", "url", `value="${esc(s.banner)}" maxlength="1500"`)}<label>Logo do sistema (PNG, JPG ou WebP)<input id="systemLogoFile" type="file" accept="image/png,image/jpeg,image/webp"><small>Escolha uma imagem de até 5 MB. Ela será reduzida automaticamente.</small></label><label>Ou endereço HTTPS do logo<input name="logoURL" type="url" maxlength="1500" placeholder="https://..." value="${esc(s.logo?.startsWith("https://") ? s.logo : "")}"></label><input type="hidden" name="logo" value="${esc(s.logo || "")}"><div class="system-logo-preview" id="systemLogoPreview">${systemLogoPreview(s.logo || "")}</div></div><p><button class="primary">Salvar aparência</button></p></form><p class="muted">Escolher ou remover uma imagem só muda a prévia. Clique em Salvar aparência para publicar. Os escudos dos times são alterados na aba Equipes. A assinatura WagnerBIZZA é preservada.</p></div>`;
}
function systemLogoPreview(value) {
  return `<div class="system-logo-sample">${value ? `<img src="${esc(value)}" alt="Prévia do logo do sistema" onerror="this.hidden=true">` : '<span class="muted">Sem logo personalizado</span>'}</div><button type="button" data-remove-system-logo>Remover logo</button>`;
}
function setSystemLogoDraft(value) {
  const f = $("#settings"); if (!f) return;
  f.elements.logo.value = value;
  f.elements.logoURL.value = value.startsWith("https://") ? value : "";
  $("#systemLogoPreview").innerHTML = systemLogoPreview(value);
}
function googleLinkPanel() {
  if (!user || C.demo) return "";
  const linked = (user.providerData || []).find((p) => p.providerId === "google.com");
  return `<section class="google-account"><h3>Entrada com Google</h3>${linked ? `<p><strong>Google vinculado</strong>${linked.email ? "<br>" + esc(linked.email) : ""}</p><p class="muted">Você pode entrar pelo Google usando esta identidade. Suas permissões continuam as mesmas.</p>` : `<p>Conta atual: <strong>${esc(user.email || accountName())}</strong>. Adicione o Google mantendo esta conta e seus acessos.</p><p class="muted">Na janela do Google, selecione preferencialmente o mesmo e-mail desta conta. Se já existir outra conta cadastrada com essa identidade Google, a vinculação será recusada.</p><button type="button" class="google-button" data-google-link ${accessBusy ? "disabled" : ""}>Vincular Google à minha conta atual</button>`}</section>`;
}
function googleEntryButton(registerIntent = false) {
  return `<div class="google-entry"><button type="button" class="google-button" data-google-entry="${registerIntent ? "register" : "login"}" ${!cloud || accessBusy ? "disabled" : ""}>${registerIntent ? "Cadastrar com Google" : "Entrar com Google"}</button><p class="muted">${registerIntent ? "Use seu nome e e-mail do Google. Não precisa preencher uma senha neste formulário. O acesso depende da aprovação do administrador." : "Já tem conta por e-mail e senha? Entre por ela primeiro e vincule o Google em Minha conta."}</p></div>`;
}
function accountView() {
  if (C.demo) return `<section class="card"><h2>Minha conta</h2><p>Você está na demonstração local. Nome, e-mail e recuperação de senha aparecem ao entrar com uma conta do Firebase.</p></section>`;
  if (!user) return "";
  const providers = [...new Set((user.providerData || []).map((p) => ({password:"E-mail e senha", "google.com":"Google", "microsoft.com":"Microsoft"})[p.providerId] || p.providerId))];
  return `<section class="card"><h2>Minha conta</h2><p class="muted">Confira a conta que está usando nesta sessão.</p><dl class="account-details"><div><dt>Nome</dt><dd>${esc(accountName())}</dd></div><div><dt>E-mail</dt><dd>${esc(user.email || "Não informado")}</dd></div><div><dt>Perfil de acesso</dt><dd>${esc(accountRole())}</dd></div><div><dt>Confirmação do e-mail</dt><dd>${user.emailVerified ? "Confirmado" : "Ainda não confirmado"}</dd></div><div><dt>Formas de entrada já vinculadas</dt><dd>${esc(providers.join(", ") || "Não informado")}</dd></div></dl>${role === "admin" ? '<p class="public-notice">Sua conta continua como administrador principal. Nenhuma opção desta tela altera suas permissões.</p>' : '<p class="muted">Seu acesso às partidas é definido pelo administrador principal.</p>'}<div class="toolbar"><button type="button" data-account-recover ${!user.email ? "disabled" : ""}>Enviar e-mail para redefinir senha</button><button type="button" data-account-exit>Sair desta conta</button></div><p class="muted">A redefinição é concluída pelo link enviado ao seu e-mail. A vinculação com Microsoft será adicionada em outra etapa.</p>${googleLinkPanel()}</section>`;
}

// Atualizações ao vivo preservam o formulário ainda não enviado.
function refresh() {
  const focused = document.activeElement;
  const championshipFocus = focused?.dataset?.championshipFilter ? { key: focused.dataset.championshipFilter, start: focused.selectionStart, end: focused.selectionEnd } : null;
  const filterFocus = focused?.dataset?.listFilter ? {
    kind: focused.dataset.listFilter, key: focused.dataset.filterKey,
    start: focused.selectionStart, end: focused.selectionEnd,
  } : null;
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
  if ($("#settings")?.elements.logo) setSystemLogoDraft($("#settings").elements.logo.value);
  if (championshipFocus) {
    const el = document.querySelector(`[data-championship-filter="${championshipFocus.key}"]`);
    if (el) { el.focus({preventScroll:true}); if (el.type === "search") el.setSelectionRange(championshipFocus.start, championshipFocus.end); }
  }
  if (filterFocus) {
    const el = document.querySelector(`[data-list-filter="${filterFocus.kind}"][data-filter-key="${filterFocus.key}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (el.type === "search") el.setSelectionRange(filterFocus.start, filterFocus.end);
    }
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
    render();
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
      if (!["team", "player", "match", "settings", "import", "championship"].includes(a.type)) {
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
        const r = M.applyMatch(current, { ...a, championship: a.championshipId ? (latest.championships || []).find((c) => c.id === a.championshipId) : null }, original),
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
  renderBrandAndIdentity();
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
  if (role !== "admin" && !["overview", "matches", "account"].includes(section)) {
    section = "overview";
    selected = "";
  }
  if (selected && !state.matches.some((m) => m.id === selected)) selected = "";
  const sections = [
    ["overview", "Visão geral"],
    ["championships", "Campeonatos"],
    ["teams", "Equipes"],
    ["players", "Jogadores"],
    ["matches", "Partidas"],
    ["imports", "Importar"],
    ["reports", "Súmulas e relatórios"],
    ["settings", "Configurações"],
    ["users", "Usuários e permissões"],
    ["account", "Minha conta"],
  ];
  app.innerHTML = `<div class="sectionhead admin-heading noprint"><div><span class="tag">PAINEL DA ORGANIZAÇÃO</span><h2>${esc(state.settings.title)}</h2></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span></div><nav>${sections
    .filter(
      ([id]) =>
        role === "admin" || ["overview", "matches", "account"].includes(id),
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
  if (section === "account") return accountView();
  if (section === "championships" && role === "admin") return championshipsView();
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
    return `<div class="card"><h2>Cadastrar equipe</h2><form id="team"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome da equipe", "name", "text", 'required maxlength="150"')}${field("Sigla", "short", "text", 'maxlength="12"')}${field("Técnico(a)", "coach")}${field("Categoria", "category")}<input name="badge" type="hidden"><label>Imagem do escudo / bandeira<input id="badgeFile" type="file" accept="image/png,image/jpeg,image/webp"><small>Escolha uma imagem do computador. O painel reduz seu tamanho automaticamente.</small></label><label>Ou endereço HTTPS da imagem<input name="badgeURL" type="url" placeholder="https://..."></label><div class="logo-preview" id="badgePreview">${badge({ name: "Time", short: "TIME", badge: "" })}<button type="button" data-remove-badge>Remover imagem</button></div></div><button class="primary">Salvar equipe</button> <button type="button" data-section="imports">Importar equipes</button></form></div>${listPanel("teams")}`;
  if (section === "players")
    return `<div class="card"><h2>Cadastrar jogador</h2><p class="muted">Cadastre o elenco antes de criar a partida. A súmula preserva uma cópia do elenco daquela data.</p><form id="player"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome", "name", "text", "required")}${select("Equipe", "team", teamOptions())}${field("Número", "number")}${field("Posição", "position")}${select("Escalação", "reserve", '<option value="false">Titular</option><option value="true">Reserva / banco</option>')}</div><button class="primary">Salvar jogador</button> <button type="button" data-section="imports">Importar jogadores</button></form></div>${listPanel("players")}`;
  if (section === "matches" && role !== "admin" && !selected) {
    return `<div class="card"><h2>Minhas partidas</h2><p>Você pode operar somente as partidas atribuídas pelo administrador principal. Histórico, relatórios e auditoria são exclusivos dele.</p></div>${listPanel("matches")}`;
  }
  if (section === "matches")
    return selected
      ? operate()
      : `<div class="card"><h2>Programar partida</h2><form id="match"><div class="formgrid">${championshipSelectForCreate()}${select(
          "Modalidade",
          "sport",
          options(
            D.SPORTS,
            (x) => x,
            (x) => x,
          ),
        )}${select("Equipe da casa", "home", teamOptions())}${select("Equipe visitante", "away", teamOptions())}${field("Data e horário (horário deste computador)", "date", "datetime-local", "required")}${field("Local", "place")}${field("Competição / edição (partida sem vínculo)", "competition", "text", 'maxlength="150"')}${field("Árbitros e mesários", "referees")}${field("Etapa inicial (ex.: 1 ou 1º quarto)", "stage", "text", 'value="1"')}</div><button class="primary" ${role === "admin" ? "" : "disabled"}>Criar partida</button></form></div>${listPanel("matches")}`;
  if (section === "imports") return importView();
  if (section === "reports") return reports();
  if (section === "settings") return settingsView();
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
  return `<button data-back>← Voltar às partidas</button><div class="live-console"><div class="console-score">${matchCard(m)}${role === "admin" ? championshipLinkForm(m) : ""}<div class="card"><h3>Jogo e interrupções</h3><form id="interruption"><div class="formgrid"><label>Motivo de pausa / suspensão<select name="pauseReason"><option>Intervalo</option><option>Atendimento em quadra</option><option>Chuva ou condições do local</option><option>Problema técnico</option><option>Decisão da arbitragem</option><option>Outro motivo</option></select></label><label>Detalhes para o público<input name="pauseDetails" maxlength="220" placeholder="Ex.: retorno previsto em 10 minutos"></label></div><div class="toolbar">${buttons}</div></form><p class="muted">Pausar ou suspender o jogo para o cronômetro e informa o motivo ao público. O placar é preservado.</p>${!locked ? `<form id="stage" class="row"><input name="stage" aria-label="Etapa" value="${esc(m.stage)}" required style="max-width:180px"><button>Atualizar etapa</button></form>${m.sport.startsWith("Vôlei") ? "<p><button data-set>Fechar set e iniciar próximo</button></p>" : ""}<hr><h3>Cronômetro</h3><div class="toolbar"><button data-clock-command="${c.running ? "parar" : "iniciar"}" ${!c.running && !live ? "disabled" : ""}>${c.running ? "Parar somente o relógio" : "Iniciar relógio"}</button></div><details><summary>Ajustar tempo e contagem</summary><form id="clock-config"><div class="formgrid"><label>Modo<select name="clockMode"><option value="up" ${c.mode === "up" ? "selected" : ""}>Crescente (00:00 →)</option><option value="down" ${c.mode === "down" ? "selected" : ""}>Regressivo (duração → 00:00)</option></select></label>${field("Duração da etapa (min)", "durationMin", "number", `min="0" max="360" value="${Math.floor((c.durationMs || 600000) / 60000)}"`)}${field("Tempo já decorrido (min)", "elapsedMin", "number", `min="0" max="360" value="${Math.floor(M.elapsed(m) / 60000)}"`)}${field("Segundos decorridos", "elapsedSec", "number", `min="0" max="59" value="${Math.floor(M.elapsed(m) / 1000) % 60}"`)}${field("Motivo do ajuste", "clockReason", "text", 'required maxlength="300"')}</div><button ${c.running ? "disabled" : ""}>Salvar ajuste do cronômetro</button><p class="muted">Pare o relógio para ajustar. A troca de etapa não zera o tempo automaticamente. Ao chegar a zero, a contagem regressiva aguarda a decisão da arbitragem.</p></form></details>` : ""}</div></div><div class="console-actions"><div class="card quick-panel"><span class="tag">LANÇAMENTO RÁPIDO</span><h2>Marcar ponto</h2><p class="muted">Selecione o atleta, se desejar, e toque na pontuação da equipe.</p><div class="quick-grid">${quick}</div>${!live ? '<p class="public-notice">Os lançamentos ficam disponíveis quando o jogo está Ao vivo.</p>' : ""}</div><div class="card"><details><summary>Cartões, faltas, substituições e outros lances</summary>${
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
    return wrap(`<h2>Situação do acesso</h2><p>${esc(user.email || "")}</p><p role="status">${messages[accessStatus] || messages.unauthorized}</p>${accessStatus === "incomplete" ? `<form id="complete-access">${field("Seu nome", "name", "text", 'required maxlength="100" autocomplete="name"')}<p><button class="primary">Concluir solicitação</button></p></form>` : ""}<div class="toolbar">${!user.emailVerified && accessStatus !== "loading" ? '<button type="button" data-access-verify>Enviar confirmação de e-mail</button>' : ""}<button type="button" data-access-refresh>Já confirmei / Atualizar acesso</button><button type="button" data-access-exit>Sair desta conta</button></div><p class="muted">O cadastro não autoriza alterações de placar. A senha não é exibida para a organização.</p>${googleLinkPanel()}`);
  }
  if (authMode === "register") return wrap(`<h2>Solicitar acesso</h2><p>Cadastre sua conta de operador. O administrador principal aprovará o pedido e definirá as partidas autorizadas.</p>${googleEntryButton(true)}<p class="muted">Ou cadastre com e-mail e senha:</p><form id="register"><div style="display:grid;gap:14px">${field("Nome completo", "name", "text", 'required maxlength="100" autocomplete="name"')}${field("E-mail", "email", "email", 'required maxlength="254" autocomplete="email"')}${field("Senha (mínimo de 8 caracteres)", "password", "password", 'required minlength="8" autocomplete="new-password"')}${field("Confirmar senha", "confirmPassword", "password", 'required minlength="8" autocomplete="new-password"')}</div><p><button class="primary">Criar conta e solicitar acesso</button></p></form><button type="button" data-access-mode="login">Já tenho conta — entrar</button>`);
  if (authMode === "recover") return wrap(`<h2>Recuperar senha</h2><p>Informe seu e-mail para receber as instruções do Firebase.</p><form id="recover">${field("E-mail", "email", "email", 'required autocomplete="email"')}<p><button class="primary">Enviar instruções</button></p></form><button type="button" data-access-mode="login">Voltar para entrar</button>`);
  return wrap(`<h2>Entrar na organização</h2>${googleEntryButton()}<p class="muted">Ou entre com e-mail e senha:</p><form id="login"><div style="display:grid;gap:14px">${field("E-mail", "email", "email", 'required autocomplete="username"')}${field("Senha", "password", "password", 'required autocomplete="current-password"')}</div><p><button class="primary">Entrar</button></p></form><div class="toolbar"><button type="button" data-access-mode="register">Solicitar acesso</button><button type="button" data-access-mode="recover">Esqueci minha senha</button></div>`);
}
function accessError(e) {
  return ({
    "auth/popup-blocked": "O navegador bloqueou a janela do Google. Permita pop-ups para este site e clique novamente.",
    "auth/popup-closed-by-user": "A janela do Google foi fechada. Nenhuma nova vinculação foi concluída; tente novamente se desejar.",
    "auth/cancelled-popup-request": "Já existe uma tentativa de entrada aberta. Use uma janela do Google por vez.",
    "auth/unauthorized-domain": "O domínio deste site ainda não está autorizado no Firebase Authentication.",
    "auth/operation-not-allowed": "A entrada com Google precisa estar habilitada no Firebase Authentication.",
    "auth/account-exists-with-different-credential": "Este e-mail já usa outra forma de entrada. Entre com seu método atual e use Minha conta → Vincular Google.",
    "auth/credential-already-in-use": "Esta identidade Google já está ligada a outra conta. Nenhuma conta foi mesclada. Entre com a conta original ou escolha outra identidade Google.",
    "auth/email-already-in-use": "Este e-mail já tem conta. Entre com seu método atual e vincule o Google em Minha conta.",
    "auth/provider-already-linked": "O Google já está vinculado a esta conta. Atualize Minha conta para conferir.",
    "auth/requires-recent-login": "Por segurança, saia e entre novamente com seu método atual antes de vincular Google.",
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/wrong-password": "E-mail ou senha inválidos.",
    "auth/user-not-found": "E-mail ou senha inválidos.",
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
          toast(user?.emailVerified ? "Solicitação registrada. Aguarde a aprovação do administrador principal." : "Solicitação registrada. Confira a confirmação enviada ao seu e-mail.");
        } else {
          await cloud.manageUser({userId:d.userId, access:d.access,
            matches: new FormData(f).getAll("assignedMatches"), reason:d.reason});
          managedUserId = "";
          toast("Permissões salvas e registradas no histórico.");
        }
      });
      return;
    }
    if (["team", "player", "match", "settings", "championship"].includes(f.id)) {
      if (f.id === "settings") {
        if (systemLogoBusy) throw Error("Aguarde a preparação do logo antes de salvar.");
        delete d.logoURL;
      }
      if (f.id === "team") {
        delete d.badgeURL;
      }
      if (f.id === "player") d.reserve = d.reserve === "true";
      if (f.id === "match") d.date = new Date(d.date).toISOString();
      await dispatch({ type: f.id, data: d });
      if (f.id === "championship") { editedChampionshipId = ""; render(); }
      else if (!C.demo) f.reset();
    } else if (f.id === "championship-link") {
      await dispatch({type:"championshipLink", matchId:selected, championshipId:d.championshipId, reason:d.reason});
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
    if (b.dataset.googleEntry) {
      if (!cloud || accessBusy) return;
      const registerIntent = b.dataset.googleEntry === "register";
      await accessAction(async () => {
        await cloud.enterGoogle({register:registerIntent});
        toast(registerIntent ? "Conta Google reconhecida. Confira a situação da solicitação de acesso." : "Entrada com Google concluída. Conferindo sua autorização.");
      }); return;
    }
    if (b.hasAttribute("data-google-link")) {
      if (!cloud || accessBusy) return;
      await accessAction(async () => {
        await cloud.linkGoogle();
        toast("Google vinculado à mesma conta. Suas permissões foram preservadas.");
      }); return;
    }
    if (b.hasAttribute("data-my-account")) {
      if (!C.demo && (!user || !role)) return;
      cloud?.stopHistory(); section = "account"; selected = ""; render(); return;
    }
    if (b.hasAttribute("data-account-recover")) {
      if (!user?.email || C.demo) return;
      await accessAction(async () => { await cloud.recoverPassword(user.email); toast("Enviamos as instruções de redefinição de senha para " + user.email + ". Confira também o spam."); }); return;
    }
    if (b.hasAttribute("data-account-exit")) {
      if (cloud) await cloud.auth.signOut(cloud.authentication); return;
    }
    if (b.hasAttribute("data-remove-system-logo")) {
      systemLogoVersion++; systemLogoBusy = false; setSystemLogoDraft("");
      if ($("#systemLogoFile")) $("#systemLogoFile").value = "";
      toast("Logo removido da prévia. Clique em Salvar aparência para publicar."); return;
    }
    if (b.dataset.editChampionship) {
      editedChampionshipId = b.dataset.editChampionship; render();
      $("#championship")?.scrollIntoView({behavior:"smooth"}); return;
    }
    if (b.hasAttribute("data-new-championship")) { editedChampionshipId = ""; render(); return; }
    if (b.hasAttribute("data-clear-championship-filters")) { championshipQuery = ""; championshipStatus = ""; refresh(); return; }
    if (b.dataset.championshipGames) {
      cloud?.stopHistory(); selected = ""; section = "matches";
      listFilters.matches = { ...listDefaults.matches, group:"all", championshipId:b.dataset.championshipGames };
      render(); $("#list-results-matches")?.scrollIntoView({behavior:"smooth"}); return;
    }
    if (b.dataset.listReset) {
      const kind = b.dataset.listReset;
      if (!listDefaults[kind]) return;
      listFilters[kind] = { ...listDefaults[kind] };
      refresh(); return;
    }
    if (b.dataset.listGroup) {
      listFilters.matches.group = b.dataset.listGroup;
      listFilters.matches.status = "";
      refresh(); return;
    }
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
    if (e.target.id === "systemLogoFile") {
      const file = e.target.files[0]; if (!file) return;
      const version = ++systemLogoVersion;
      systemLogoBusy = true; toast("Preparando logo do sistema…");
      try {
        const value = await compactLogo(file);
        if (version === systemLogoVersion && $("#settings")) { setSystemLogoDraft(value); toast("Logo pronto. Clique em Salvar aparência para publicar."); }
      } finally { if (version === systemLogoVersion) systemLogoBusy = false; }
      return;
    }
    if (e.target.name === "logoURL") {
      systemLogoVersion++; systemLogoBusy = false;
      const value = e.target.value.trim();
      if (value && (!/^https:\/\//i.test(value) || value.length > 1500)) throw Error("Use um endereço HTTPS de até 1500 caracteres.");
      setSystemLogoDraft(value); return;
    }
    if (e.target.dataset.championshipFilter === "status") {
      championshipStatus = e.target.value; updateChampionshipList(); return;
    }
    if (e.target.closest("#match") && e.target.name === "championshipId") {
      syncChampionshipDraft(); return;
    }
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
// 13 — PREFERÊNCIAS LOCAIS E AJUDA. Nunca altera placares ou permissões.
const preferenceKey = "arena-preferencias-v1";
const preferenceDefaults = { theme: "dark", text: "normal", contrast: false, motion: false, help: true };
function readPreferences() {
  try {
    const p = JSON.parse(localStorage.getItem(preferenceKey) || "null") || {};
    return {theme:["dark","light","auto"].includes(p.theme)?p.theme:"dark",text:["normal","large","larger"].includes(p.text)?p.text:"normal",contrast:p.contrast===true,motion:p.motion===true,help:p.help!==false};
  } catch { return {...preferenceDefaults}; }
}
let preferences = readPreferences();
const themeQuery = matchMedia("(prefers-color-scheme: dark)");
function applyPreferences() {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme === "auto" ? (themeQuery.matches?"dark":"light") : preferences.theme;
  root.dataset.textSize = preferences.text;
  root.classList.toggle("high-contrast",preferences.contrast);
  root.classList.toggle("reduce-motion",preferences.motion);
  root.dataset.contextHelp = String(preferences.help);
}
function savePreferences() {
  applyPreferences();
  try { localStorage.setItem(preferenceKey,JSON.stringify(preferences)); }
  catch { toast("Preferência aplicada nesta página. O navegador não permitiu salvá-la."); }
}
function helpFor(el) {
  if(el.matches("[data-quick]"))return "Acrescenta a pontuação indicada à equipe. Confira a equipe e o atleta antes de registrar.";
  if(el.matches("[data-correct]"))return "Retira este lançamento por estorno, com justificativa, preservando a auditoria. Exclusivo do administrador principal.";
  if(el.matches("[data-status]"))return "Altera a situação do jogo. Interrupções e reaberturas podem exigir justificativa.";
  if(el.matches("[data-clock-command]"))return "Inicia ou para apenas o cronômetro. Os segundos na tela não geram gravações a cada segundo.";
  if(el.matches("[data-open]"))return "Abre os controles desta partida. O acesso depende das permissões da sua conta.";
  if(el.matches("[data-google-link]"))return "Vincula Google à conta atual, mantendo o mesmo usuário. Escolha a identidade correta na janela do Google.";
  if(el.matches("[data-google-entry]"))return "Abre a janela do Google. Novos operadores continuam dependendo da aprovação do administrador.";
  if(el.matches("[data-list-filter]"))return "Filtra apenas a visualização. Não altera ou exclui nenhum cadastro.";
  if(el.matches("[data-list-group]"))return "Alterna entre partidas em andamento, finalizadas e todas. Os registros são preservados.";
  if(el.matches("[data-backup]"))return "Baixa uma cópia JSON para consulta. Esta versão ainda não possui restauração automática.";
  if(el.matches("[data-access-edit]"))return "Permite ao administrador aprovar, bloquear e definir as partidas deste operador.";
  const key=el.dataset.section;
  const sections={overview:"Resumo das equipes, jogadores e partidas disponíveis para sua conta.",championships:"Cadastro de campeonatos e temporadas. Gerenciado pelo administrador principal.",teams:"Cadastro e edição de equipes, técnicos, categorias e escudos.",players:"Cadastro do elenco, número, posição e titular ou reserva.",matches:"Programação, filtros e operação das partidas autorizadas.",imports:"Importa equipes ou jogadores por planilha ou texto, com prévia antes de confirmar.",reports:"Súmulas, PDF, Excel e cópia JSON. Acesso exclusivo do administrador principal.",settings:"Aparência pública do sistema: logo, título, cores e capa.",users:"Solicitações de acesso, aprovação, bloqueio e partidas atribuídas.",account:"Identificação da conta conectada e formas de entrada vinculadas."};
  if(sections[key])return sections[key];
  if(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.tagName==="SELECT"){
    const label=el.closest("label")?.childNodes[0]?.textContent?.trim()||el.getAttribute("aria-label")||"este campo";
    return `${el.required?"Campo obrigatório. ":""}${label}.${el.maxLength>0?" Limite de "+el.maxLength+" caracteres.":""}`;
  }
  const text=el.textContent.trim();
  const known={"Salvar aparência":"Publica a aparência na central, no cadastro e no painel público.","Estornar":"Corrige um lançamento com justificativa, preservando o histórico.","Salvar vínculo com justificativa":"Vincula a partida ao campeonato da mesma modalidade e registra a justificativa.","Limpar filtros":"Restaura os filtros iniciais desta lista. Não apaga dados.","Criar partida":"Programa uma partida com cópia do elenco cadastrado naquele momento.","Cadastrar campeonato":"Cria uma edição do campeonato. A modalidade fica fixa após salvar.","Preparar prévia":"Analisa os dados antes da importação. Confira os resultados antes de confirmar."};
  return known[text]||"";
}
let helpTarget=null;
function hideContextHelp(){
  const tip=document.getElementById("arenaContextHelp"); if(tip)tip.hidden=true;
  if(helpTarget){const ids=(helpTarget.getAttribute("aria-describedby")||"").split(" ").filter(id=>id&&id!=="arenaContextHelp");if(ids.length)helpTarget.setAttribute("aria-describedby",ids.join(" "));else helpTarget.removeAttribute("aria-describedby");}
  helpTarget=null;
}
function showContextHelp(target){
  hideContextHelp();if(!preferences.help||!target)return;
  const content=helpFor(target);if(!content)return;
  const tip=document.getElementById("arenaContextHelp");if(!tip)return;
  helpTarget=target;tip.textContent=content;tip.hidden=false;
  target.setAttribute("aria-describedby",[target.getAttribute("aria-describedby"),"arenaContextHelp"].filter(Boolean).join(" "));
}
function setupAccessibility(){
  applyPreferences();
  const main=document.querySelector("main");if(main){main.id="mainContent";main.tabIndex=-1;}
  document.body.insertAdjacentHTML("afterbegin",'<a class="skip-link" href="#mainContent">Pular para o conteúdo principal</a>');
  const region=document.createElement("section");region.className="accessibility-bar noprint";
  region.innerHTML=`<details id="arenaPreferences"><summary>Aparência, acessibilidade e ajuda</summary><div class="preference-controls"><label>Tema<select data-pref="theme"><option value="dark">Escuro</option><option value="light">Claro</option><option value="auto">Automático — seguir dispositivo</option></select></label><label>Tamanho do texto<select data-pref="text"><option value="normal">Padrão</option><option value="large">Maior</option><option value="larger">Muito maior</option></select></label><label class="preference-check"><input type="checkbox" data-pref="contrast">Contraste reforçado</label><label class="preference-check"><input type="checkbox" data-pref="motion">Reduzir movimentos</label><label class="preference-check"><input type="checkbox" data-pref="help">Mostrar ajuda contextual</label><button type="button" data-reset-preferences>Restaurar preferências</button></div><p>Preferências deste navegador. Use Tab para navegar, Enter para ativar e Esc para fechar a ajuda. No celular, toque em Ajuda da função e depois no controle desejado.</p><button type="button" data-touch-help aria-pressed="false">Ajuda da função: desativada</button><p id="touchHelpStatus" role="status"></p></details>`;
  document.getElementById("mode")?.after(region);
  for(const el of region.querySelectorAll("[data-pref]")){if(el.type==="checkbox")el.checked=preferences[el.dataset.pref];else el.value=preferences[el.dataset.pref];}
  const tip=document.createElement("div");tip.id="arenaContextHelp";tip.role="tooltip";tip.hidden=true;document.body.append(tip);
  let touchHelp=false;
  document.addEventListener("change",e=>{const k=e.target.dataset.pref;if(!Object.hasOwn(preferenceDefaults,k))return;preferences[k]=e.target.type==="checkbox"?e.target.checked:e.target.value;hideContextHelp();savePreferences();});
  document.addEventListener("pointerover",e=>{if(e.pointerType!=="touch")showContextHelp(e.target.closest("button,input,select,textarea,summary"));});
  document.addEventListener("pointerout",e=>{if(helpTarget&&!helpTarget.contains(e.relatedTarget))hideContextHelp();});
  document.addEventListener("focusin",e=>showContextHelp(e.target));
  document.addEventListener("focusout",hideContextHelp);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){hideContextHelp();touchHelp=false;const b=document.querySelector("[data-touch-help]");if(b){b.setAttribute("aria-pressed","false");b.textContent="Ajuda da função: desativada";}}});
  document.addEventListener("click",e=>{
    const b=e.target.closest("button,input,select,textarea");if(!b)return;
    if(b.hasAttribute("data-touch-help")){touchHelp=!touchHelp;b.setAttribute("aria-pressed",String(touchHelp));b.textContent="Ajuda da função: "+(touchHelp?"ativada":"desativada");return;}
    if(b.hasAttribute("data-reset-preferences")){preferences={...preferenceDefaults};savePreferences();for(const el of region.querySelectorAll("[data-pref]")){if(el.type==="checkbox")el.checked=preferences[el.dataset.pref];else el.value=preferences[el.dataset.pref];}hideContextHelp();return;}
    if(touchHelp&&!b.closest(".accessibility-bar")&&!b.closest("#arenaTutorial")){e.preventDefault();e.stopImmediatePropagation();document.getElementById("touchHelpStatus").textContent=helpFor(b)||"Este controle não possui uma explicação adicional.";showContextHelp(b);}
  },true);
  themeQuery.addEventListener("change",()=>{if(preferences.theme==="auto")applyPreferences();});
}
setupAccessibility();

// 14 — COMO USAR. Guia por perfil, sem gravar ou alterar dados esportivos.
let tutorialIndex = 0, tutorialReturnFocus = null;
function tutorialSteps() {
  if (!admin) return [
    ["Bem-vindo ao painel público", "Aqui você acompanha resultados, situação das partidas e avisos publicados pela organização. Não é necessário fazer login para assistir."],
    ["Escolha a modalidade", "Use Filtrar modalidade acima dos jogos. Cada cartão mostra as equipes, placar, etapa, data e local. O cronômetro depende da ativação pela organização."],
    ["Entenda as interrupções", "Ao vivo, pausada, suspensa e encerrada são situações diferentes. Quando houver um aviso da organização, ele aparecerá no cartão. Você não precisa atualizar a página a cada lance."],
    ["Ajuste a leitura", "Em Aparência, acessibilidade e ajuda, escolha tema, tamanho do texto e contraste. Para participar da organização, use Área da organização; novos operadores precisam solicitar acesso."]
  ];
  if (!C.demo && (!user || !role)) return [
    ["Entrar ou solicitar acesso", "Quem já possui uma conta pode entrar com seu método atual. Para uma conta nova, escolha Solicitar acesso e cadastre com Google ou e-mail e senha."],
    ["Confirmação e aprovação", "Confirme seu e-mail quando solicitado. O cadastro não autoriza mudanças de resultados: o administrador principal precisa aprovar o acesso e atribuir partidas."],
    ["Adicionar Google à conta existente", "Entre primeiro com o método que já utiliza. Depois, em Minha conta, use Vincular Google para manter a mesma conta. Se houver conflito com outra conta, o sistema não faz mesclagem automática."],
    ["Recuperar acesso", "Esqueci minha senha envia instruções ao seu e-mail. Se estiver bloqueado ou sem partidas atribuídas, procure o administrador principal."]
  ];
  if (role === "operator") return [
    ["Sua conta de operador", "O cabeçalho identifica sua conta. Você recebe somente as partidas atribuídas pelo administrador principal. Minha conta permite conferir seu perfil e suas formas de entrada."],
    ["Encontre sua partida", "Abra Partidas. Use busca, modalidade, situação e campeonato. Em andamento e próximas esconde as finalizadas; Todas permite localizar qualquer partida disponível para sua conta."],
    ["Durante o jogo", "Abra Operar partida, confira as equipes e inicie o jogo quando autorizado. Use o lançamento rápido para registrar pontos ou gols na equipe correta. Se desejar, selecione o atleta antes do lançamento."],
    ["Interrupções e avisos", "Pausar e suspender registram o motivo e interrompem o cronômetro. O campo Aviso para quem está assistindo publica informações. Observações operacionais compõem a súmula. Confira sempre o que ficará público."],
    ["Correções e encerramento", "Se registrar um resultado errado, avise o administrador principal para realizar o estorno auditado. Ao encerrar, confira o placar. Reabertura, homologação, auditoria e relatórios são funções administrativas."],
    ["Ajuda quando precisar", "Use Tab e Enter para navegar pelo teclado. A ajuda contextual explica controles sem modificar o jogo. Quando Ajuda da função estiver ativada, o toque apenas consulta; desative para voltar a operar."]
  ];
  return [
    ["Administrador principal", "Sua conta gerencia cadastros, permissões, jogos e relatórios. O cabeçalho mostra com qual conta você entrou. Como usar pode ser aberto novamente a qualquer momento."],
    ["Equipes e jogadores", "Cadastre as equipes e seus escudos em Equipes. Em Jogadores, informe equipe, número, posição e titular ou reserva. Prepare o elenco antes de criar a partida: a súmula preserva uma cópia daquele momento."],
    ["Importação com prévia", "Em Importar, selecione equipes ou jogadores e forneça a planilha ou o texto. Confira a prévia antes de confirmar. Corrija linhas inválidas e verifique duplicados. A importação não deve ser confirmada sem essa revisão."],
    ["Campeonatos e temporadas", "Cadastre uma edição para cada modalidade e categoria. A modalidade fica fixa após salvar. Encerrar o campeonato impede novas partidas vinculadas, mas não encerra os jogos automaticamente."],
    ["Programar e localizar partidas", "Em Partidas, escolha campeonato, equipes diferentes, data e local. O vínculo preenche a modalidade. Use Todas para encontrar jogos encerrados e Ver partidas no cartão do campeonato para filtrar seus jogos."],
    ["Operar um jogo", "Confira as equipes antes de iniciar. Use +1 para gols no futebol e os valores próprios nas outras modalidades. O cronômetro possui início, parada e ajuste com justificativa. Cartões, faltas e outros lances ficam na seção de detalhes."],
    ["Gol anulado e VAR", "Se um gol for anulado, localize o ponto no Histórico e use Estornar com justificativa. Em uma partida encerrada, primeiro reabra com motivo. Para uma análise de VAR, publique um aviso ao público e aguarde a decisão antes do estorno."],
    ["Interrupções e súmula", "Informe o motivo ao pausar, suspender ou cancelar. Avisos são públicos; observações operacionais entram na súmula e ficam disponíveis a quem opera a partida. Ao concluir, confira o resultado e encerre. Homologação é uma ação separada."],
    ["Relatórios e cópia dos dados", "Em Súmulas e relatórios, selecione a partida e exporte PDF ou Excel. A auditoria preserva as correções. Baixar cópia JSON gera uma cópia para consulta; ainda não existe restauração automática nesta versão."],
    ["Operadores e permissões", "Em Usuários e permissões, copie o link de cadastro, revise o pedido, aprove e atribua somente os jogos necessários. Bloquear retira o acesso operacional. Operadores não recebem sua autoridade de administrador principal."],
    ["Logo, conta e leitura", "Configurações publica logo, título, cor e capa. Minha conta mostra sua identidade e permite vincular Google. Tema e acessibilidade são preferências deste navegador e não mudam as escolhas dos outros usuários."],
    ["Antes de usar em um evento", "Confira equipes, elenco, campeonato e permissões. Teste um lançamento e a atualização do painel público. A demonstração interativa, idiomas, classificação e limpeza dos testes ainda estão em preparação nesta etapa."]
  ];
}
function drawTutorial() {
  const steps = tutorialSteps(); tutorialIndex = Math.max(0,Math.min(tutorialIndex,steps.length-1));
  const [title,body] = steps[tutorialIndex];
  document.getElementById("arenaTutorialProgress").textContent=`Passo ${tutorialIndex+1} de ${steps.length}`;
  document.getElementById("arenaTutorialTitle").textContent=title;
  document.getElementById("arenaTutorialBody").textContent=body;
  document.getElementById("arenaTutorialPrevious").disabled=tutorialIndex===0;
  document.getElementById("arenaTutorialNext").textContent=tutorialIndex===steps.length-1?"Concluir":"Próximo";
}
function setupTutorial() {
  const bar=document.querySelector(".accessibility-bar"); if(!bar)return;
  const open=document.createElement("button");open.type="button";open.textContent="Como usar — guia passo a passo";open.style.marginTop="8px";bar.append(open);
  const dialog=document.createElement("dialog");dialog.id="arenaTutorial";
  dialog.setAttribute("aria-labelledby","arenaTutorialTitle");dialog.setAttribute("aria-describedby","arenaTutorialBody");
  dialog.style.cssText="width:min(92vw,650px);max-height:85vh;overflow:auto;background:var(--panel);color:var(--text);border:2px solid var(--line);border-radius:12px;padding:24px";
  dialog.innerHTML='<p id="arenaTutorialProgress" class="muted" aria-live="polite"></p><h2 id="arenaTutorialTitle" tabindex="-1"></h2><p id="arenaTutorialBody"></p><p class="muted">Este guia apenas orienta: não cria nem altera registros.</p><div class="toolbar"><button type="button" id="arenaTutorialPrevious">Anterior</button><button type="button" id="arenaTutorialNext" class="primary">Próximo</button><button type="button" id="arenaTutorialClose">Fechar guia</button></div>';
  document.body.append(dialog);
  open.addEventListener("click",()=>{hideContextHelp();tutorialReturnFocus=document.activeElement;tutorialIndex=0;drawTutorial();dialog.showModal();document.getElementById("arenaTutorialTitle").focus();});
  document.getElementById("arenaTutorialPrevious").addEventListener("click",()=>{tutorialIndex--;drawTutorial();document.getElementById("arenaTutorialTitle").focus();});
  document.getElementById("arenaTutorialNext").addEventListener("click",()=>{if(tutorialIndex>=tutorialSteps().length-1)dialog.close();else{tutorialIndex++;drawTutorial();document.getElementById("arenaTutorialTitle").focus();}});
  document.getElementById("arenaTutorialClose").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{hideContextHelp();if(tutorialReturnFocus?.isConnected)tutorialReturnFocus.focus();});
}
setupTutorial();

boot();
