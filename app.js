/* APLICAÇÃO — seções numeradas para facilitar futuras alterações.
   1 conexão | 2 visualização | 3 cadastros | 4 partida | 5 importação | 6 relatórios.
   Nunca acrescente senhas neste arquivo. Dados externos são escapados antes da exibição. */
// Arquivo sem ferramenta de compilação: funciona no GitHub Pages.
const trainingMode = new URLSearchParams(location.search).get("demonstracao") === "1";
const D = window.Domain,
  C = trainingMode ? { ...window.CONFIG, demo: true } : window.CONFIG,
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
let testRawState = null;
let arenaDrawerOpen=false,arenaOpenGroups=new Map(),arenaInertNodes=[];
let arenaRailCollapsed=false;
try { arenaRailCollapsed=localStorage.getItem("arena-barra-recolhida-v1")==="1"; } catch {}
let state = D.fresh(),
  section = "overview",
  selected = "",
  user = null,
  role = "",
  operatorPermissions = [],
  operatorEditions = [],
  pendingImport = null,
  busy = false,
  cloud = null,
  unsubscribe = null;
let accessStatus = "loading",
  authMode = new URLSearchParams(location.search).get("acesso") === "cadastro" ? "register" : "login",
  accessBusy = false,
  managedUserId = "";
const key = trainingMode ? "arena-treinamento-isolado-v1" : "arena-demo-v1",
  app = $("#app");
let documentFilters = {championship:"",sport:"",status:"",query:"",from:"",to:""};
let reportFilter = "",
  publicFilter = "";
const publicEdition = admin ? "" : new URLSearchParams(location.search).get("campeonato") || "";

function publicEditionState(data) {
  if (!publicEdition) return data;
  return {...data, matches:data.matches.filter((m) =>
    m.championshipId && m.competition === publicEdition && !m.publicHidden)};
}

// 2.1 — FILTROS DA CENTRAL. Apenas consulta: não altera cadastros nem permissões.
// Para mudar a visualização inicial de partidas, altere group: "active" abaixo.
const listDefaults = {
  teams: { query: "", category: "", sport:"",status:"active" },
  players: { query: "", team: "", position: "", reserve: "" },
  matches: { query: "", sport: "", group: "active", status: "", championshipId: "", edition: "", team: "" },
};
const listFilters = Object.fromEntries(Object.entries(listDefaults).map(([k, v]) => [k, { ...v }]));
const finalStatuses = ["Encerrada", "Homologada", "Cancelada"];
const matchStatuses = ["Agendada", "Adiada", "Ao vivo", "Pausada", "Suspensa", ...finalStatuses];
const searchText = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
const alphabetical = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { numeric: true });
function filteredRecords(kind) {
  const f = listFilters[kind], q = searchText(f.query);
  return state[kind].filter((r) => {
    if (kind === "teams") return (!f.sport||teamSports(r).includes(f.sport))&&(!f.status||(f.status==="archived"?r.archived===true:r.archived!==true))&&(!q || searchText([r.name, r.short, r.coach].join(" ")).includes(q)) && (!f.category || (r.category || "") === f.category);
    if (kind === "players") return (!q || searchText([r.name, r.number].join(" ")).includes(q)) && (!f.team || r.team === f.team) && (!f.position || (r.position || "") === f.position) && (!f.reserve || String(Boolean(r.reserve)) === f.reserve);
    return (!f.edition || (r.championshipId && r.competition === f.edition)) && (!f.team || [r.home,r.away].includes(f.team)) && (!q || searchText([name(r.home), name(r.away), r.competition, r.place].join(" ")).includes(q)) && (!f.championshipId || (f.championshipId === "__unlinked" ? !r.championshipId : r.championshipId === f.championshipId)) && (!f.sport || r.sport === f.sport) && (!f.status || r.status === f.status) && (f.group === "all" || (f.group === "finished" ? finalStatuses.includes(r.status) : !finalStatuses.includes(r.status)));
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
  const titles = { teams: "Equipes cadastradas", players: "Jogadores cadastrados", matches: role === "admin" ? "Partidas cadastradas" : canViewAllGames() ? "Jogos disponíveis" : "Partidas atribuídas" };
  let controls = `<label class="list-search">${kind === "matches" ? "Buscar equipe, competição ou local" : kind === "players" ? "Buscar nome ou número" : "Buscar equipe, sigla ou técnico"}<input type="search" data-list-filter="${kind}" data-filter-key="query" value="${esc(f.query)}" placeholder="Digite para buscar…" autocomplete="off"></label>`;
  if (kind === "teams") controls += filterSelect(kind, "category", "Categoria", unique(state.teams, "category"), "Todas as categorias")+filterSelect(kind,"sport","Modalidade",D.SPORTS,"Todas as modalidades")+filterSelect(kind,"status","Situação da equipe",[["active","Ativas"],["archived","Arquivadas"]],"Todas as equipes");
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
  if (!rows.length) return empty(state[kind].length ? "Nenhum resultado com estes filtros. Use Limpar filtros ou selecione Todas." : { teams: "Nenhuma equipe cadastrada.", players: "Nenhum jogador cadastrado.", matches: "Nenhum jogo disponível para esta conta." }[kind]);
  if (kind === "matches") {
    const groups = [
      ["Ao vivo", ["Ao vivo"]],
      ["Interrompidas", ["Pausada", "Suspensa"]],
      ["Programadas", ["Agendada", "Adiada"]],
      ["Finalizadas", finalStatuses]
    ];
    const conhecidos = groups.flatMap(([, statuses]) => statuses);
    groups.push(["Outras situações", rows.map(m => m.status).filter(status => !conhecidos.includes(status))]);
    return groups.map(([title, statuses]) => {
      const matches = rows.filter(m => statuses.includes(m.status));
      if (!matches.length) return "";
      return `<section style="grid-column:1/-1"><h3>${title} <small class="muted">(${matches.length})</small></h3><div class="grid">${matches.map(m => matchCard(m, true)).join("")}</div></section>`;
    }).join("");
  }
  if (kind === "teams") return rows.map(teamDirectoryCard).join("");
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
  if (kind === "matches" && key === "edition") {
    listFilters.matches.team = "";
    listFilters.matches.championshipId = "";
    render();
    document.querySelector('[data-list-filter="matches"][data-filter-key="edition"]')?.focus();
    return;
  }
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


// 2.2 — CAMPEONATOS E TEMPORADAS. O cadastro pode ser delegado pelo administrador.
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
  return `<div class="card"><h2>${c ? "Editar campeonato / temporada" : "Cadastrar campeonato / temporada"}</h2><p class="muted">Cadastre a primeira modalidade e categoria. Depois, use Adicionar modalidade ou categoria no cartão da edição.</p><form id="championship"><input type="hidden" name="recordId" value="${value("id")}"><div class="formgrid">${field("Nome do campeonato", "name", "text", `required maxlength="100" value="${value("name")}"`)}${field("Edição / temporada", "season", "text", `required maxlength="40" placeholder="Ex.: 2026 ou 2º semestre de 2026" value="${value("season")}"`)}<label>Modalidade<select name="sport" required>${D.SPORTS.map((sport) => `<option ${c?.sport === sport ? "selected" : ""} ${c && c.sport !== sport ? "disabled" : ""}>${esc(sport)}</option>`).join("")}</select><small>A modalidade fica fixa nesta categoria após salvar.</small></label>${field("Categoria", "category", "text", `maxlength="150" placeholder="Ex.: Livre, Sub-17, Feminino" value="${value("category")}"`)}<label>Situação<select name="status">${["Planejado","Em andamento","Encerrado"].map((status) => `<option ${c?.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label></div><button class="primary">${c ? "Salvar alterações" : "Cadastrar campeonato"}</button> ${c ? '<button type="button" data-new-championship>Cancelar edição / novo cadastro</button>' : ""}</form><p class="muted">Encerrar o campeonato impede criar novas partidas vinculadas; não encerra partidas automaticamente. Alterações do nome ou da edição não reescrevem súmulas existentes.</p></div><section class="card list-filters"><h2>Campeonatos cadastrados</h2><div class="list-controls"><label class="list-search">Buscar campeonato, edição, modalidade ou categoria<input type="search" data-championship-filter="query" value="${esc(championshipQuery)}" placeholder="Digite para buscar…"></label><label>Situação<select data-championship-filter="status"><option value="">Todas as situações</option>${["Planejado","Em andamento","Encerrado"].map((status) => `<option ${championshipStatus === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><button type="button" data-clear-championship-filters>Limpar filtros</button></div><p id="championship-count" class="muted" role="status">${championshipCount()}</p></section><div class="grid" id="championship-results">${championshipCards()}</div>`;
}
function visibleChampionships() {
  const q = searchText(championshipQuery);
  return (state.championships || []).filter((c) => (!championshipStatus || c.status === championshipStatus) && (!q || searchText([c.name,c.season,c.sport,c.category].join(" ")).includes(q))).sort(alphabetical);
}
function championshipCount() { return `${visibleChampionships().length} de ${(state.championships || []).length} combinações de modalidade e categoria nesta visualização`; }
function championshipCards() {
  const editions = new Map();
  for (const championship of visibleChampionships()) {
    const key = JSON.stringify([championship.name, championship.season].map(
      (part) => part.trim().toLocaleLowerCase("pt-BR")
    ));
    if (!editions.has(key)) editions.set(key, []);
    editions.get(key).push(championship);
  }

  return [...editions.values()].map((entries) => {
    const edition = entries[0];
    const categories = entries.map((c) => {
      const games = state.matches.filter((m) => m.championshipId === c.id);
      const finished = games.filter((m) => finalStatuses.includes(m.status)).length;
      return `<section class="card"><h4>${esc(c.sport)} · ${esc(c.category || "Sem categoria")}</h4>
        <p class="muted">${esc(c.status)} · ${games.length} partidas · ${finished} finalizadas</p>
        <div class="toolbar">
          <button type="button" data-edit-championship="${esc(c.id)}">Editar</button>
          <button type="button" data-championship-games="${esc(c.id)}">Ver partidas</button>
          <button type="button" data-registration-sheet="${esc(c.id)}">Ficha de inscrição</button>
        </div>
      </section>`;
    }).join("");

    return `<article class="card championship-card">
      <h3>${esc(edition.name)}</h3>
      <p>${esc(edition.season)}</p>
      ${C.demo ? "" : shareEditionControls(championshipTitle(edition))}
      <div class="grid">${categories}</div>
      <button type="button" data-add-championship-category="${esc(edition.id)}">Adicionar modalidade ou categoria</button>
    </article>`;
  }).join("") || empty((state.championships || []).length
    ? "Nenhum campeonato corresponde aos filtros."
    : "Cadastre seu primeiro campeonato acima.");
}
function shareEditionControls(edition = "") {
  const url = new URL("./index.html", location.href);
  if (edition) url.searchParams.set("campeonato", edition);
  return `<details class="card"><summary>Compartilhar</summary>
    <div class="toolbar">
      <a href="${esc(url.href)}" target="_blank" rel="noopener">Abrir página pública</a>
      <button type="button" data-share-copy="${esc(url.href)}">Copiar link</button>
      <button type="button" data-share-qr="${esc(url.href)}">Baixar QR Code</button>
      ${state.settings.logo ? `<button type="button" data-share-qr="${esc(url.href)}" data-qr-logo>Baixar QR Code com logo</button>` : ""}
    </div>
  </details>`;
}

const registrationStyleKey = "arena-ficha-identidade-v1";
const registrationFonts = {
  "Sem serifa": "system-ui, sans-serif",
  "Com serifa": "Georgia, serif",
  "Monoespaçada": "monospace"
};
const registrationLogoGroups = ["Organizadores", "Patrocinadores", "Colaboradores"];

function registrationStyle() {
  try {
    return JSON.parse(localStorage.getItem(registrationStyleKey)) || {};
  } catch {
    return {};
  }
}

function registrationLogoPreview(urls, group) {
  return urls.map((url,index) => `<div class="registration-logo-item"><img src="${esc(url)}" alt="${group === "school" ? "Logo da escola" : registrationLogoGroups[Number(group)]}">
    <button type="button" data-registration-logo-remove="${group}" data-logo-index="${index}">Remover imagem</button></div>`).join("");
}
function registrationStyleForm() {
  const style = registrationStyle();
  return `<section class="card"><h2>Identidade da ficha de inscrição</h2>
    <p>O logo da escola aparece no cabeçalho da ficha, ao lado do logo principal da Arena.
    Organizadores, patrocinadores e colaboradores aparecem após a lista de participantes.
    A marca d’água fica ao fundo das páginas.</p>
    <p>Estas preferências são usadas na ficha de inscrição e ficam salvas neste navegador.
    O logo principal do sistema é configurado acima e também é usado nos painéis, documentos e QR codes que o incluem.</p>
    <form id="registration-style"><div class="formgrid">
      ${field("Nome da escola", "school", "text", `maxlength="150" value="${esc(style.school || "")}"`)}
      <div><label>Logo da escola · arquivo do computador<input type="file" data-registration-logo-file="school" accept="image/png,image/jpeg,image/webp"></label>
        ${field("Ou URL HTTPS do logo da escola", "schoolLogoURL", "url", `maxlength="1500" value="${esc(style.schoolLogo?.startsWith("https://") ? style.schoolLogo : "")}"`)}
        <input type="hidden" name="schoolLogo" value="${esc(style.schoolLogo || "")}">
        <div data-registration-logo-preview="school" class="registration-logo-preview">${registrationLogoPreview(style.schoolLogo ? [style.schoolLogo] : [],"school")}</div></div>
      <label>Fonte<select name="font">${Object.keys(registrationFonts).map(font =>
        `<option ${style.font === font ? "selected" : ""}>${esc(font)}</option>`).join("")}</select></label>
      ${field("Tamanho do texto (pt)", "size", "number", `min="9" max="16" required value="${esc(style.size || 11)}"`)}
      ${field("Texto da marca d’água", "watermark", "text", `maxlength="60" value="${esc(style.watermark || "")}"`)}
      ${registrationLogoGroups.map((group,i) => {
        const logos = Array.isArray(style.logos?.[i]) ? style.logos[i] : [];
        return `<div><label>Logos de ${group.toLowerCase()} · arquivos do computador<input type="file" data-registration-logo-file="${i}" accept="image/png,image/jpeg,image/webp" multiple></label>
          <label>Ou links HTTPS · um por linha<textarea name="logos${i}" maxlength="9070">${esc(logos.filter(url=>url.startsWith("https://")).join("\n"))}</textarea></label>
          <input type="hidden" name="logoFiles${i}" value="${esc(JSON.stringify(logos.filter(url=>url.startsWith("data:image/"))))}">
          <div data-registration-logo-preview="${i}" class="registration-logo-preview">${registrationLogoPreview(logos,String(i))}</div></div>`;
      }).join("")}
    </div><p class="muted">PNG, JPG ou WebP, até 5 MB por arquivo. As imagens são reduzidas automaticamente. Até seis logos por grupo.</p>
    <button type="submit">Salvar preferências da ficha</button></form></section>`;
}
let registrationImageBusy = false;
function registrationGroupLogos(form,group) {
  const files = JSON.parse(form.elements["logoFiles"+group].value || "[]");
  return [...form.elements["logos"+group].value.split(/\r?\n/).map(url=>url.trim()).filter(Boolean),...files];
}
function setRegistrationGroup(form,group,urls) {
  form.elements["logos"+group].value = urls.filter(url=>url.startsWith("https://")).join("\n");
  form.elements["logoFiles"+group].value = JSON.stringify(urls.filter(url=>url.startsWith("data:image/")));
  form.querySelector(`[data-registration-logo-preview="${group}"]`).innerHTML = registrationLogoPreview(registrationGroupLogos(form,group),group);
}
document.addEventListener("change", async event => {
  const input = event.target;
  if (!input.hasAttribute("data-registration-logo-file")) return;
  let form = input.closest("#registration-style");
  if (!form || role !== "admin" || !input.files?.length) return;
  if (registrationImageBusy) {toast("Aguarde a preparação das imagens.",true);return;}
  registrationImageBusy = true;
  try {
    const group = input.dataset.registrationLogoFile;
    const files = [...input.files];
    if (group !== "school" && registrationGroupLogos(form,group).length+files.length > 6)
      throw Error("Use até seis logos por grupo. Remova uma imagem antes de adicionar outra.");
    const images = [];
    for (const file of files) images.push(await compactLogo(file));
    if (role !== "admin") return;
    form = document.getElementById("registration-style");
    if (!form) return;
    if (group !== "school" && registrationGroupLogos(form,group).length+images.length > 6)
      throw Error("O grupo já possui seis logos. Remova uma imagem para continuar.");
    if (group === "school") {
      form.elements.schoolLogo.value = images[0];
      form.elements.schoolLogoURL.value = "";
      form.querySelector('[data-registration-logo-preview="school"]').innerHTML = registrationLogoPreview([images[0]],"school");
    } else setRegistrationGroup(form,group,[...registrationGroupLogos(form,group),...images]);
    toast("Prévia preparada. Clique em Salvar preferências da ficha para guardar.");
  } catch (error) {toast(error.message,true);}
  finally {registrationImageBusy=false;input.value="";}
});
document.addEventListener("input", event => {
  const input = event.target, form = input.closest("#registration-style");
  if (!form) return;
  if (input.name === "schoolLogoURL") {
    form.elements.schoolLogo.value = input.value.trim();
    form.querySelector('[data-registration-logo-preview="school"]').innerHTML =
      registrationLogoPreview(input.value.trim() ? [input.value.trim()] : [],"school");
  }
  if (/^logos[0-2]$/.test(input.name)) {
    const group=input.name.slice(-1);
    form.querySelector(`[data-registration-logo-preview="${group}"]`).innerHTML = registrationLogoPreview(registrationGroupLogos(form,group),group);
  }
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-registration-logo-remove]");
  if (!button || registrationImageBusy || role !== "admin") return;
  const form = button.closest("#registration-style"),group=button.dataset.registrationLogoRemove;
  if (group === "school") {
    form.elements.schoolLogo.value="";
    form.elements.schoolLogoURL.value="";
    form.querySelector('[data-registration-logo-preview="school"]').innerHTML="";
  } else {
    const urls=registrationGroupLogos(form,group);
    urls.splice(Number(button.dataset.logoIndex),1);
    setRegistrationGroup(form,group,urls);
  }
});
document.addEventListener("submit", event => {
  const form=event.target;
  if (form.id !== "registration-style") return;
  event.preventDefault();
  if (!admin || role !== "admin") return;
  if (registrationImageBusy) {toast("Aguarde a preparação das imagens.",true);return;}
  try {
    const data=new FormData(form),get=key=>String(data.get(key)||"").trim();
    const schoolLogo=get("schoolLogo"),logos=registrationLogoGroups.map((_,i)=>registrationGroupLogos(form,String(i)));
    const validLogo=url=>(url.length<=1500 && /^https:\/\/[^\s]+$/i.test(url)) ||
      (url.length<=40000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url));
    if ((schoolLogo && !validLogo(schoolLogo)) || logos.some(group=>group.length>6 || group.some(url=>!validLogo(url))))
      throw Error("Use arquivos PNG, JPG ou WebP ou links HTTPS válidos, até seis logos por grupo.");
    localStorage.setItem(registrationStyleKey,JSON.stringify({
      school:get("school"),schoolLogo,font:get("font"),size:Number(get("size")),watermark:get("watermark"),logos
    }));
    toast("Preferências da ficha salvas neste navegador.");
  } catch (error) {toast(error.message || "Não foi possível salvar as preferências.",true);}
});

function printRegistrationSheet(championship) {
  const rows = prompt("Quantas linhas de inscrição? (1 a 60)", "20");
  if (rows === null) return;
  const count = Number(rows);
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw Error("Informe um número inteiro de 1 a 60.");
  }

  const style = registrationStyle();
  const font = Object.hasOwn(registrationFonts, style.font) ? registrationFonts[style.font] : registrationFonts["Sem serifa"];
  const size = Number.isInteger(style.size) && style.size >= 9 && style.size <= 16 ? style.size : 11;
  const partners = registrationLogoGroups.map((group, i) => {
    const urls = style.logos?.[i];
    if (!Array.isArray(urls) || !urls.length) return "";
    return `<section><strong>${group}</strong><div class="partner-logos">${urls.map((url) =>
      `<img src="${esc(url)}" alt="${group}">`).join("")}</div></section>`;
  }).join("");
  const sheet = window.open("", "_blank");
  if (!sheet) throw Error("Permita que o Arena abra a ficha em uma nova aba.");
  sheet.opener = null;
  const logo = state.settings.logo || "";
  const hasLogo = /^https:\/\//i.test(logo) || /^data:image\/(png|jpeg|webp);base64,/i.test(logo);
  const participants = Array.from({length:count}, (_, i) =>
    `<tr><td>${i + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");
  sheet.document.open();
  sheet.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
    <title>Ficha de inscrição — ${esc(championship.name)}</title>
    <style>
      @page{size:A4;margin:15mm} body{font:${size}pt ${font};color:#111;margin:24px}
      header{display:flex;align-items:center;gap:16px} img{max-width:96px;max-height:64px}
      table{border-collapse:collapse;width:100%;margin-top:16px}
      th,td{border:1px solid #777;padding:6px;text-align:left;height:22px}
      h1{font-size:20pt;line-height:1.15;margin:6px 0}
      h2{font-size:14pt;line-height:1.2;margin:12px 0 8px}
      body>p{margin:8px 0}
      .registration-players{table-layout:fixed;font-size:${Math.min(size,11)}pt;margin-top:10px}
      .registration-players th,.registration-players td{
        box-sizing:border-box;padding:1mm 1.5mm;overflow-wrap:break-word;line-height:1.2;height:7mm}
      .registration-players th{vertical-align:middle;font-size:10pt}
      .registration-players th:first-child,.registration-players td:first-child{
        white-space:nowrap;overflow-wrap:normal;text-align:center;padding:1mm}
      .registration-players td:nth-child(3),.registration-players td:nth-child(4){
        white-space:nowrap;text-align:center}
      tr{break-inside:avoid} thead{display:table-header-group} button{margin-top:16px}
      .watermark{position:fixed;inset:42% 8% auto;text-align:center;transform:rotate(-25deg);
        font-size:32pt;font-weight:bold;color:rgba(20,20,20,.12);pointer-events:none;overflow-wrap:anywhere}
      .partner-logos{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:5px 0 12px}
      .partners{margin-top:18px;break-inside:avoid}
      @media print{button{display:none}body{margin:0}}
    </style>
    ${style.watermark ? `<div class="watermark" aria-hidden="true">${esc(style.watermark)}</div>` : ""}
    <header>${style.schoolLogo ? `<img src="${esc(style.schoolLogo)}" alt="Logo da escola">` : ""}${hasLogo ? `<img src="${esc(logo)}" alt="Logo da organização">` : ""}
      <div><strong>${esc(style.school || systemDisplayName())}</strong><h1>Ficha de inscrição</h1></div>
    </header>
    <h2>${esc(championshipTitle(championship))}</h2>
    <p>${esc(championship.sport)} · ${esc(championship.category || "Sem categoria")}</p>
    <p>Equipe: ____________________________________________</p>
    <p>Responsável: _______________________________________</p>
    <table class="registration-players"><colgroup><col style="width:7%"><col style="width:30%"><col style="width:10%"><col style="width:11%"><col style="width:17%"><col style="width:25%"></colgroup><thead><tr><th>Nº</th><th>Nome do participante</th><th>Turma</th><th>Nº da camisa</th><th>Posição</th><th>Assinatura</th></tr></thead>
    <tbody>${participants}</tbody></table>${partners ? `<aside class="partners">${partners}</aside>` : ""}<button type="button" id="print">Imprimir / Salvar PDF</button></html>`);
  sheet.document.close();
  sheet.document.getElementById("print").onclick = async () => {
    await Promise.all([...sheet.document.images].map(img => img.decode().catch(() => {})));
    sheet.print();
  };
}

async function qrLogoData(source) {
  const logo = new Image();
  logo.crossOrigin = "anonymous";
  logo.src = source;
  try {
    await logo.decode();
  } catch {
    throw Error("O logo não pôde ser incorporado. Na aparência do Arena, envie o logo como arquivo ou use um endereço que permita o acesso à imagem.");
  }
  const canvas = document.createElement("canvas");
  const scale = 128 / Math.max(logo.naturalWidth, logo.naturalHeight);
  canvas.width = Math.max(1, Math.round(logo.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(logo.naturalHeight * scale));
  canvas.getContext("2d").drawImage(logo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-share-copy],[data-share-qr],[data-registration-sheet]");
  if (!button) return;
  try {
    if (button.dataset.shareCopy) {
      try {
        await navigator.clipboard.writeText(button.dataset.shareCopy);
        toast("Link público copiado.");
      } catch {
        prompt("Copie o link público", button.dataset.shareCopy);
      }
    } else if (button.dataset.shareQr) {
      const {qrSvg} = await import("./vendor/arena-qrcode.js");
      const logo = button.hasAttribute("data-qr-logo") ? await qrLogoData(state.settings.logo) : "";
      const filename = logo ? "arena-qr-code-com-logo.svg" : "arena-qr-code.svg";
      download(filename, qrSvg(button.dataset.shareQr, logo), "image/svg+xml");
    } else if (admin && canManageChampionships()) {
      const championship = (state.championships || []).find((c) => c.id === button.dataset.registrationSheet);
      if (championship) printRegistrationSheet(championship);
    }
  } catch (error) {
    toast(error.message, true);
  }
});

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
const canManageRosters = () => role === "admin" || (role === "operator" && operatorPermissions.includes("rosters"));
const canCreateMatches = () => role === "admin" || (role === "operator" && operatorPermissions.includes("matchesCreate"));
const canManageChampionships = () => role === "admin" || (role === "operator" && operatorPermissions.includes("championships"));
const canViewAllGames = () => role === "admin" || (role === "operator" && operatorPermissions.includes("gamesView"));
async function sairParaApresentacao() {
  if (!cloud || !window.confirm("Deseja sair da sua conta no Arena?")) return;
  await cloud.auth.signOut(cloud.authentication);
  window.location.replace("apresentacao.html");
}
const accountRole = () => C.demo ? "Demonstração local" : role === "admin" ? "Administrador" : role === "operator" ? "Operador" : "Aguardando autorização";
const accountLabels = {
  mwYVHBGiEJSYfKimTiBUMzcWHhn1: { name: "Wagner Bizza", email: "wagnerbizza@gmail.com" },
  WLMZmXFVXFS8lJUG1KSN2sfEtq13: { name: "Wagner Santiago", email: "wagnersantiago@prof.educacao.sp.gov.br" },
};
const activeAccountLabel = () => !C.demo && role === "admin" ? accountLabels[user?.uid] : null;
const accountName = () => activeAccountLabel()?.name || user?.displayName || (state.users || []).find((p) => p.id === user?.uid)?.name || user?.email?.split("@")[0] || "Conta conectada";
// Títulos por contexto, sem alterar a identidade personalizada salva.
function systemDisplayName(){
 const title=String(state.settings.title||'').trim();
 return !title || /^(arena|arena esportiva)\s*[•—–-]?\s*(esporte|esportes) ao vivo$/i.test(title) ? 'Arena Esportiva' : title;
}
function panelDisplayName(){return trainingMode?'Treinamento — dados fictícios':role==='admin'?'Painel do Administrador':role==='operator'?'Painel do Operador':'Acesso à organização';}
function renderBrandAndIdentity() {
  updateArenaFavicon();
  renderConnectionStatus();
  const brand = $("#systemBrand");
  if (brand) brand.innerHTML = `<span class="system-logo">${state.settings.logo ? `<img src="${esc(state.settings.logo)}" alt="Logo da organização" onerror="this.hidden=true">` : '<span aria-hidden="true">◈</span>'}</span><span class="brand-copy"><b>${esc(systemDisplayName())}</b><small>CENTRAL ESPORTIVA</small></span>`;
  const identity = $("#sessionIdentity");
  if (!identity) return;
  identity.hidden = !admin || (!user && !C.demo);
  document.body.classList.toggle("has-account-menu",!identity.hidden);
  const signature=JSON.stringify([identity.hidden,user?.uid,user?.email,accountName(),accountRole(),role,C.demo]);
  if(identity.dataset.signature!==signature){identity.dataset.signature=signature;identity.innerHTML=identity.hidden?"":accountMenuMarkup();}
  renderConnectionStatus();
}
function settingsView() {
  const s = state.settings;
  return `<div class="card"><h2>Identidade visual e configurações</h2><p class="muted">A aparência é compartilhada pelo painel público e pela central. Somente o administrador principal pode alterá-la.</p><form id="settings"><div class="formgrid">${field("Título do sistema", "title", "text", `value="${esc(s.title)}" required maxlength="100"`)}${field("Subtítulo", "subtitle", "text", `value="${esc(s.subtitle)}" maxlength="200"`)}${field("Cor de destaque", "color", "color", `value="${esc(s.color)}"`)}${field("Lances no resumo do placar (1 a 5)", "summaryLimit", "number", `required min="1" max="5" step="1" value="${esc(s.summaryLimit ?? 5)}"`)}<p class="muted">Quantidade de lances recentes no card do administrador, operador e público. Os demais continuam disponíveis em Ver lances anteriores.</p>${field("Lances por carregamento do histórico (1 a 50)", "historyPageSize", "number", `required min="1" max="50" step="1" value="${esc(s.historyPageSize ?? 20)}"`)}<p class="muted">Quantidade inicial ao abrir Ver lances anteriores. O botão Carregar lances mais antigos traz o próximo grupo.</p>${field("Endereço HTTPS da imagem de capa", "banner", "url", `value="${esc(s.banner)}" maxlength="1500"`)}<label>Logo do sistema (PNG, JPG ou WebP)<input id="systemLogoFile" type="file" accept="image/png,image/jpeg,image/webp"><small>Escolha uma imagem de até 5 MB. Ela será reduzida automaticamente.</small></label><label>Ou endereço HTTPS do logo<input name="logoURL" type="url" maxlength="1500" placeholder="https://..." value="${esc(s.logo?.startsWith("https://") ? s.logo : "")}"></label><input type="hidden" name="logo" value="${esc(s.logo || "")}"><div class="system-logo-preview" id="systemLogoPreview">${systemLogoPreview(s.logo || "")}</div></div><p><button class="primary">Salvar aparência</button></p></form><p class="muted">Escolher ou remover uma imagem só muda a prévia. Clique em Salvar aparência para publicar. O logo salvo também será usado como ícone da aba do navegador. Os escudos dos times são alterados na aba Equipes. A assinatura WagnerBIZZA é preservada.</p></div>`;
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
  return `<section class="google-account"><h3>Entrada com Google</h3>${linked ? `<p><strong>Google vinculado</strong>${linked.email ? "<br>" + esc(linked.email) : ""}</p><p class="muted">Você pode entrar pelo Google usando esta identidade. Suas permissões continuam as mesmas.</p>` : `<p>Conta atual: <strong>${esc(user.email || accountName())}</strong>. Adicione o Google mantendo esta conta e seus acessos.</p><p class="muted">Na janela do Google, selecione preferencialmente o mesmo e-mail desta conta. Se já existir outra conta cadastrada com essa identidade Google, a vinculação será recusada.</p><button type="button" class="google-button" data-google-link ${accessBusy ? "disabled" : ""}>${googleSymbol()}<span>Vincular Google à minha conta atual</span></button>`}</section>`;
}
function googleEntryButton(registerIntent = false) {
  return `<div class="google-entry"><button type="button" class="google-button" data-google-entry="${registerIntent ? "register" : "login"}" ${!cloud || accessBusy ? "disabled" : ""}>${googleSymbol()}<span>${registerIntent ? "Cadastrar com Google" : "Entrar com Google"}</span></button><p class="muted">${registerIntent ? "Escolha uma conta Google para enviar a solicitação de acesso. Se você já tem conta com senha, entre nela e use Minha conta → Vincular Google." : "Já tem conta por e-mail e senha? Entre por ela primeiro e vincule o Google em Minha conta."}</p></div>`;
}
function ownContactForm() {
  if (C.demo || !user || role === "admin") return "";
  const contact = cloud?.ownContact?.();
  if (!contact || ["removal-requested", "loading"].includes(accessStatus)) return "";
  return `<section class="card"><h3>Atualizar meus dados</h3>
    <p>Complete seu nome e telefone para contato com a organização.</p>
    <form id="own-contact">
    ${field("Nome completo", "name", "text", `required maxlength="100" autocomplete="name" value="${esc(contact.name)}"`)}
    ${field("E-mail da conta", "email", "email", `readonly value="${esc(user.email || "")}"`)}
    ${field("Telefone com DDD", "phone", "tel", `required maxlength="25" autocomplete="tel" placeholder="(11) 99999-9999" value="${esc(contact.phone)}"`)}
    <p><button class="primary">Salvar meus dados</button></p></form></section>`;
}
function ownRemovalForm() {
  if (C.demo || !user || role === "admin" || accessStatus === "removal-requested" || accessStatus === "incomplete" || accessStatus === "loading") return "";
  return `<section class="card"><h3>Solicitar exclusão do meu acesso</h3>
    <p>Ao enviar, suas permissões serão revogadas e o administrador receberá a solicitação no painel.
    O administrador conclui a remoção do acesso. O login do Firebase Authentication é tratado pelo console do Firebase.</p>
    <form id="request-own-removal"><label>Motivo<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>
    <label>Digite EXCLUIR para confirmar<input name="confirmation" required autocomplete="off"></label>
    <p><button type="submit">Solicitar exclusão do meu acesso</button></p></form></section>`;
}
function accountPendingBanner() {
  if (role !== "admin" || C.demo) return "";
  const pending = (state.users || []).filter(u => !u.deleted && u.role === "pending" && !u.removalRequested).length;
  const removals = (state.users || []).filter(u => !u.deleted && u.removalRequested).length;
  if (!pending && !removals) return "";
  return `<section class="card public-notice" role="status" aria-live="polite"><h3>Solicitações aguardando você</h3>
    <p>${pending} solicitação(ões) de acesso · ${removals} solicitação(ões) de exclusão</p>
    <button type="button" data-review-account-requests>Revisar solicitações</button></section>`;
}
function accountView() {
  if (C.demo) return `<section class="card"><h2>Minha conta</h2><p>Você está na demonstração local. Nome, e-mail e recuperação de senha aparecem ao entrar com uma conta do Firebase.</p></section>`;
  if (!user) return "";
  const providers = [...new Set((user.providerData || []).map((p) => ({password:"E-mail e senha", "google.com":"Google", "microsoft.com":"Microsoft"})[p.providerId] || p.providerId))];
  return `<section class="card"><h2>Minha conta</h2><p class="muted">Confira a conta que está usando nesta sessão.</p><dl class="account-details"><div><dt>Nome</dt><dd>${esc(accountName())}</dd></div><div><dt>Conectado como</dt><dd>${esc(user.email || "Não informado")}</dd></div>${activeAccountLabel() ? `<div><dt>Identificação da sessão</dt><dd>Conta ativa</dd></div><div><dt>Conta principal</dt><dd>Wagner Bizza · wagnerbizza@gmail.com</dd></div><div><dt>Conta secundária</dt><dd>Wagner Santiago · wagnersantiago@prof.educacao.sp.gov.br</dd></div>` : ""}<div><dt>Perfil de acesso</dt><dd>${esc(accountRole())}</dd></div><div><dt>Permissão de cadastros</dt><dd>${canManageRosters()?"Autorizado a gerenciar equipes e jogadores":"Não concedida"}</dd></div><div><dt>Confirmação do e-mail</dt><dd>${user.emailVerified ? "Confirmado" : "Ainda não confirmado"}</dd></div><div><dt>Formas de entrada já vinculadas</dt><dd>${esc(providers.join(", ") || "Não informado")}</dd></div></dl>${role === "admin" ? '<p class="public-notice">Sua conta continua como administrador principal. Nenhuma opção desta tela altera suas permissões.</p>' : '<p class="muted">Seu acesso às partidas é definido pelo administrador principal.</p>'}<div class="toolbar"><button type="button" data-account-recover ${!user.email ? "disabled" : ""}>Alterar minha senha</button><button type="button" data-account-exit>Sair desta conta</button></div><p class="muted">Para quem entra com e-mail e senha: clique em Alterar minha senha para receber um link em <strong>${esc(user.email)}</strong>. Abra esse e-mail para escolher a nova senha; confira também o spam. Não é necessário vincular o Google. O administrador não vê sua senha.</p>${googleLinkPanel()}</section>${ownContactForm()}${ownRemovalForm()}`;
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
    checks: [...f.elements].filter(e=>e.name&&["checkbox","radio"].includes(e.type)).map(e=>({name:e.name,value:e.value,checked:e.checked})),
    multi: [...f.querySelectorAll("select[multiple]")].map((e) => [e.name, [...e.selectedOptions].map((o) => o.value)]),
    values: [...f.elements]
      .filter((e) => e.name && e.type !== "password" && !e.hasAttribute("data-private-password"))
      .map((e) => [e.name, e.value]),
  }));
  render();
  for (const f of forms) {
    const target = document.getElementById(f.id);
    if (target)
      for (const [name, value] of f.values)
        if (target.elements[name]) target.elements[name].value = value;
    if(target)for(const check of f.checks)for(const el of target.elements)if(el.name===check.name&&el.value===check.value&&["checkbox","radio"].includes(el.type))el.checked=check.checked;
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
  const registrationForm = $("#registration-style");
  if (registrationForm) {
    const schoolLogo=registrationForm.elements.schoolLogo.value;
    registrationForm.querySelector('[data-registration-logo-preview="school"]').innerHTML=registrationLogoPreview(schoolLogo ? [schoolLogo] : [],"school");
    for (let i=0;i<registrationLogoGroups.length;i++)
      registrationForm.querySelector(`[data-registration-logo-preview="${i}"]`).innerHTML=registrationLogoPreview(registrationGroupLogos(registrationForm,String(i)),String(i));
  }
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
    state.teams.filter(t=>!t.archived),
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
function clockStatus(m, now = Date.now()) {
  if (!m.clock) return "Aguardando ativação do cronômetro";
  if (m.clock.mode === "down" && M.elapsed(m, now) >= m.clock.durationMs) return "TEMPO ESGOTADO";
  return m.clock.running ? "EM CONTAGEM" : "PARADO";
}
function addedClock(m, now = Date.now()) {
  const minutes = m.addedTime?.stage === m.stage ? m.addedTime.minutes : 0;
  const started = m.addedTime?.stage === m.stage &&
    (m.addedTime.phase === "started" || Object.hasOwn(m.clock?.segments || {}, "acrescimos"));
  const waiting = m.status === "Ao vivo" && minutes > 0 && !started &&
    m.addedTime.phase === "announced" &&
    (!m.clock?.running || clockStatus(m, now) === "TEMPO ESGOTADO");
  return {
    caption: started || waiting ? "Acréscimos" : m.clock?.mode === "down" ? "Tempo restante" : "Tempo de jogo",
    time: waiting ? prettyTime(minutes * 60000) : m.clock ? M.clockText(m, now) : "—",
    status: waiting ? "AGUARDANDO INÍCIO" : clockStatus(m, now),
    waiting,
  };
}
function clockMarkup(m) {
  const clock = addedClock(m);
  return `<div class="game-clock"><span class="clock-caption">${clock.caption}</span><strong data-clock="${esc(m.id)}">${clock.time}</strong><small data-clock-status>${clock.status}</small>${m.addedTime?.stage === m.stage && m.addedTime.minutes > 0 ? `<span class="tag">Acréscimos +${esc(m.addedTime.minutes)} min</span>` : ""}</div>`;
}
function updateClocks() {
  for (const el of document.querySelectorAll("[data-clock]")) {
    const m = state.matches.find((m) => m.id === el.dataset.clock);
    if (!m) continue;
    const now = Date.now();
    const clock = addedClock(m, now);
    el.textContent = clock.time;
    el.parentElement.querySelector(".clock-caption").textContent = clock.caption;
    const label = el.parentElement.querySelector("[data-clock-status]");
    if (label) label.textContent = clock.status;
  }
  if (admin && selected) {
    const match = state.matches.find(item => item.id === selected);
    if (match?.status === "Ao vivo") {
      const expired = clockStatus(match) === "TEMPO ESGOTADO";
      const waiting = addedClock(match).waiting;
      const blocked = expired && !waiting;
      for (const button of document.querySelectorAll('[data-clock-command="iniciar"],[data-guided-start]')) {
        button.disabled = busy || accessBusy || blocked;
        button.textContent = blocked ? "Tempo esgotado" : waiting ? "Iniciar acréscimos" :
          button.hasAttribute("data-guided-start") ? "Iniciar cronômetro" : "Iniciar relógio";
      }
      const heading = document.querySelector("[data-clock-guide-label]");
      if (heading && expired && !waiting) heading.textContent = "Tempo esgotado · aguardando decisão da arbitragem";
    }
  }
}
// Um intervalo apenas na tela: nenhum acesso ao Firestore a cada segundo.
setInterval(updateClocks, 250);
function eventLabel(e, m) {
  if (e.type === "status") return `Situação: ${e.from||"—"} → ${e.to||"—"}`;
  if (e.type === "acréscimos") return e.value ? `Acréscimos autorizados: +${e.value} min` : "Aviso de acréscimos retirado";
  if (e.type === "cronômetro") return e.text || ({iniciar:"Cronômetro iniciado",parar:"Cronômetro parado","iniciar-acrescimos":"Acréscimos iniciados",ajustar:"Cronômetro ajustado"}[e.from] || "Alteração do cronômetro");
  if (e.type === "ponto")
    return e.correctionOf
      ? (m.sport === "Futebol" || m.sport === "Futsal" ? "Gol anulado" : "Pontuação anulada") + " (" + e.value + ")"
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
    e.type === "cadastro" ? "Partida cadastrada na central" : e.text || (e.type==="status"?`${e.from||"—"} → ${e.to||"—"}`:e.type==="acréscimos"?`Acréscimos autorizados: +${e.value||0} min`:""),
  ).trim();
  const reason = String(e.reason || "").trim();
  if (text && reason && text !== reason) {
    return `${text} — Motivo: ${reason}`;
  }
  return text || reason || "—";
}

function matchEventSummary(m) {
  const events = Array.isArray(m.publicEvents)
    ? m.publicEvents
    : admin && Array.isArray(m.events)
      ? m.events
      : [];
  if (!events.length) return "";
  const corrected = new Set(
    events.filter((e) => e.correctionOf).map((e) => e.correctionOf),
  );
  const relevant = events.filter(
    (e) =>
      (e.type === "ponto" && ((e.value > 0 && !corrected.has(e.id)) || (e.value < 0 && e.correctionOf))) ||
      [
        "cartão amarelo",
        "cartão vermelho",
        "falta",
        "substituição",
        "tempo",
        "observação",
      ].includes(e.type),
  );
  if (!relevant.length) return "";
  const configuredLimit = Number(state.settings.summaryLimit ?? 5);
  const summaryLimit = Number.isInteger(configuredLimit) && configuredLimit >= 1 && configuredLimit <= 5
    ? configuredLimit : 5;
  const shown = relevant.slice(-summaryLimit).reverse();
  const rows = shown
    .map((e) => {
      const athlete = (m.roster || []).find((p) => p.id === e.player);
      const playerName = athlete
        ? `${athlete.number ? athlete.number + " • " : ""}${athlete.name}`
        : e.playerName
          ? `${e.number ? e.number + " • " : ""}${e.playerName}`
          : "Atleta não informado";
      const teamName = [0, 1].includes(e.side)
        ? name([m.home, m.away][e.side])
        : "";
      const label = eventLabel(e, m);
      let icon = "";
      if (!admin) {
        const cardColor = e.type === "cartão amarelo" ? "#ffd43b"
          : e.type === "cartão vermelho" ? "#ff5263" : "";
        if (cardColor) {
          icon = `<svg width="12" height="17" viewBox="0 0 12 17" aria-hidden="true" focusable="false" style="vertical-align:-.2em"><rect x="1" y="1" width="10" height="15" rx="1.5" fill="${cardColor}" stroke="#111" /></svg>`;
        } else if (e.type === "ponto" && (m.sport === "Futebol" || m.sport === "Futsal")) {
          icon = '<span aria-hidden="true">⚽</span>';
        }
      }
      const eventMarkup = (icon ? icon + " " : "") + esc(label);
      return `<li><span>${eventMarkup}${teamName ? " • " + esc(teamName) : ""}</span><strong>${esc(playerName)}</strong>${e.text ? `<small>${esc(e.text)}</small>` : ""}</li>`;
    })
    .join("");
  const remaining = relevant.length - shown.length;
  return `<section class="match-events" aria-label="Lances da partida"><strong>Gols e ocorrências</strong><ul>${rows}</ul>${remaining ? `<small>+ ${remaining} lance(s) anterior(es)</small>` : ""}</section>`;
}

let timelineOpenId = "", timelineRows = [], timelineCursor = null, timelineMore = false;
let timelineStop = null, timelineLoading = false, timelineError = "", timelineRequest = 0;
let timelineAppliedSize = 20;
function configuredHistoryPageSize() {
  const size = Number(state.settings.historyPageSize ?? 20);
  return Number.isInteger(size) && size >= 1 && size <= 50 ? size : 20;
}
function closeTimeline() {
  timelineRequest++;
  timelineStop?.();
  timelineStop = null;
  timelineOpenId = "";
  timelineRows = [];
}
function timelineControl(m) {
  return `<div class="match-timeline"><button type="button" data-timeline-toggle="${esc(m.id)}" aria-expanded="${timelineOpenId === m.id}">
    ${timelineOpenId === m.id ? "Fechar lances anteriores" : "Ver lances anteriores"}</button>
    ${timelineOpenId === m.id ? `<section id="timeline-panel-${esc(m.id)}" aria-label="Lances anteriores da partida">${timelineContent(m)}</section>` : ""}</div>`;
}
function timelineContent(m) {
  const summaryOnly = !timelineRows.length && (m.publicEvents || []).length > 0;
  const rows = (summaryOnly ? m.publicEvents.slice(-configuredHistoryPageSize()).map((e,i) => ({...e,revision:i+1,stage:m.stage})) : timelineRows)
    .slice().sort((a,b) => b.revision-a.revision);
  return `<div class="toolbar"><button type="button" data-timeline-scroll="recent">↑ Recentes</button>
    <button type="button" data-timeline-scroll="older">↓ Anteriores</button>
    ${role === "admin" && !C.demo ? '<button type="button" data-timeline-publish>Publicar lances antigos</button>' : ""}</div>
    <p role="status">${timelineError ? esc(timelineError) : timelineLoading ? "Carregando lances…" : rows.length + (summaryOnly ? " lance(s) do resumo recente. O histórico completo ainda precisa ser publicado pelo administrador." : " lance(s) carregado(s)")}</p>
    <div class="timeline-scroll" data-timeline-list tabindex="0" aria-label="Lista de lances, do mais recente para o mais antigo">
    ${rows.map(e => {
      const side = [0,1].includes(e.side) ? name([m.home,m.away][e.side]) : "";
      const label = e.type === "status" ? `Situação: ${e.from} → ${e.to}` :
        e.type === "etapa" ? `Etapa: ${e.to}` : e.type === "set" ? "Set encerrado" : eventLabel(e,m);
      return `<article class="timeline-event"><strong>${esc(label)}${side ? " · "+esc(side) : ""}</strong>
        ${e.playerName ? `<p>${esc(e.number ? e.number+" · " : "")}${esc(e.playerName)}</p>` : ""}
        <small>Etapa ${esc(e.stage)} · ${esc(e.at ? format(e.at?.toDate ? e.at.toDate().toISOString() : e.at) : "Horário não disponível no resumo")}</small></article>`;
    }).join("") || '<p>Nenhum lance publicado neste histórico.</p>'}</div>
    <p class="muted">Até ${configuredHistoryPageSize()} lances por carregamento.</p>
    <p><button type="button" data-timeline-more ${timelineLoading || !timelineMore ? "disabled" : ""}>Carregar lances mais antigos</button></p>`;
}
function paintTimeline() {
  const panel = document.getElementById("timeline-panel-"+timelineOpenId);
  const match = state.matches.find(m => m.id === timelineOpenId);
  if (!panel || !match) return;
  const scroll = panel.querySelector("[data-timeline-list]")?.scrollTop || 0;
  panel.innerHTML = timelineContent(match);
  panel.querySelector("[data-timeline-list]").scrollTop = scroll;
}
function stopInvisibleTimeline() {
  if (timelineOpenId && !document.getElementById("timeline-panel-"+timelineOpenId)) closeTimeline();
}
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-timeline-toggle],[data-timeline-scroll],[data-timeline-more],[data-timeline-publish]");
  if (!button) return;
  try {
    if (button.dataset.timelineToggle) {
      const matchId = button.dataset.timelineToggle;
      const previous = timelineOpenId;
      closeTimeline();
      if (previous === matchId) { render(); return; }
      const match = state.matches.find(m => m.id === matchId);
      if (!match) return;
      timelineOpenId = matchId;
      timelineAppliedSize = configuredHistoryPageSize();
      timelineRows = [];
      timelineCursor = null;
      timelineMore = false;
      timelineError = "";
      timelineLoading = !C.demo;
      render();
      if (C.demo) {
        timelineRows = (match.events || match.publicEvents || []).map((e,i) => ({...e,revision:i+1}));
        timelineLoading = false;
        paintTimeline();
        return;
      }
      const request = timelineRequest;
      let publishingOld = role === "admin";
      timelineStop = cloud.watchTimeline(matchId, page => {
        if (request !== timelineRequest) return;
        const known = new Map(timelineRows.map(row => [row.id,row]));
        for (const row of page.rows) known.set(row.id,row);
        timelineRows = [...known.values()];
        if (!timelineCursor) {timelineCursor=page.cursor;timelineMore=page.more;}
        timelineLoading = publishingOld;
        timelineError = "";
        paintTimeline();
      }, error => {
        if (request !== timelineRequest) return;
        timelineLoading = false;
        timelineError = "Não foi possível carregar os lances: "+error.message;
        paintTimeline();
      });
      if (publishingOld) {
        try {
          const count = await cloud.publishTimeline(matchId);
          if (request === timelineRequest && count) toast(count+" lance(s) antigo(s) publicado(s).");
        } finally {
          publishingOld = false;
          if (request === timelineRequest) {timelineLoading=false;paintTimeline();}
        }
      }
      return;
    }
    const panel = document.getElementById("timeline-panel-"+timelineOpenId);
    if (!panel) return;
    if (button.dataset.timelineScroll) {
      const list = panel.querySelector("[data-timeline-list]");
      list.scrollTo({top:button.dataset.timelineScroll === "recent" ? 0 : list.scrollHeight,
        behavior:preferences.motion ? "auto" : "smooth"});
      return;
    }
    if (timelineLoading) return;
    const request = timelineRequest, matchId = timelineOpenId;
    timelineLoading = true;
    paintTimeline();
    try {
      if (button.hasAttribute("data-timeline-publish")) {
        const count = await cloud.publishTimeline(matchId);
        if (request !== timelineRequest) return;
        toast(count ? count+" lance(s) antigo(s) publicado(s)." : "O histórico já está publicado. Nenhum lance adicional encontrado.");
      } else if (timelineMore && timelineCursor) {
        const page = await cloud.loadTimeline(matchId,timelineCursor);
        if (request !== timelineRequest) return;
        const known = new Map(timelineRows.map(row => [row.id,row]));
        for (const row of page.rows) known.set(row.id,row);
        timelineRows = [...known.values()];
        timelineCursor = page.cursor;
        timelineMore = page.more;
      }
    } finally {
      if (request === timelineRequest) { timelineLoading = false; paintTimeline(); }
    }
  } catch (error) {
    timelineLoading = false;
    timelineError = error.message;
    paintTimeline();
    toast(error.message,true);
  }
});

function field(label, name, type = "text", extra = "") {
  // Senhas nunca entram na cópia de formulários, mesmo quando visíveis.
  if (type === "password") {
    const id = "credential-" + name;
    return `<div class="password-field"><label for="${esc(id)}">${label}</label><div class="password-control"><input id="${esc(id)}" name="${esc(name)}" type="password" data-private-password ${extra}><button type="button" data-toggle-password aria-controls="${esc(id)}" aria-pressed="false" aria-label="Mostrar ${esc(label.toLowerCase())}">${passwordEye(false)}<span>Mostrar</span></button></div></div>`;
  }
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
  setConnectionStatus(C.demo?"DEMONSTRAÇÃO LOCAL":"conectando");
  if (C.demo) {
    try {
      state = JSON.parse(localStorage.getItem(key)) || (trainingMode ? trainingSeed() : D.fresh());
      if (trainingMode) trainingStore(state);
    } catch {
      toast(
        "Dados locais inválidos. Limpe o armazenamento para reiniciar.",
        true,
      );
    }
    state = publicEditionState(state);
    role = "admin";
    if (trainingMode) setConnectionStatus("DEMONSTRAÇÃO ISOLADA");
    render();
    window.addEventListener("storage", (e) => {
      if (e.key === key) {
        state = publicEditionState(e.newValue ? JSON.parse(e.newValue) : (trainingMode ? trainingSeed() : D.fresh()));
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
        testRawState = publicEditionState(s);
        state = activeSportsState(testRawState);
        refresh();
      },
      onSession: (u, r, access = {}) => {
        accessStatus = access.status || "loading";
        if(user?.uid!==u?.uid || r!=="admin"){credentialRows=[];credentialLoaded=false;testSelection.clear();testPlan=null;testBackup=false;}
        user = u;
        role = r;
        operatorPermissions = Array.isArray(access.permissions)?access.permissions:[];
        operatorEditions = Array.isArray(access.followedEditions) ? access.followedEditions : [];
        listFilters.matches.edition = "";
        listFilters.matches.team = "";
        render();
      },
      onError: (e) => toast(admin?e.message:"Não foi possível atualizar os resultados. Confira a conexão.", true),
      onConnection: setConnectionStatus,
    });
    render();
  } catch (e) {
    setConnectionStatus("conexão indisponível");
    toast(admin?"Não foi possível conectar: " + e.message:"Não foi possível carregar os resultados. Tente novamente em instantes.", true);
  }
}
async function dispatch(a) {
  if (a.type === "clock" && a.command === "iniciar") {
    const match = state.matches.find(item => item.id === a.matchId);
    if (match && addedClock(match).waiting && !match.clock?.running)
      a = {...a,command:"iniciar-acrescimos"};
    else if (match && clockStatus(match) === "TEMPO ESGOTADO")
      throw Error("Tempo esgotado. Ajuste o relógio ou decida a próxima etapa antes de iniciar.");
  }
  if (busy) throw Error("Aguarde a operação anterior.");
  if (a.type === "notes" && role !== "admin") {
    throw Error("Somente o administrador pode editar as observações da súmula.");
  }
  busy = true;
  app.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    if (C.demo) {
      if (trainingMode && role === "operator" && !((canManageRosters()&&(["team","player"].includes(a.type)||(a.type==="import"&&["team","player"].includes(a.kind))))||(canCreateMatches()&&a.type==="match"&&!a.data?.id)||(canManageChampionships()&&a.type==="championship")) && ["team","player","match","settings","import","championship","championshipLink","correct","teamArchive"].includes(a.type)) throw Error("Esta ação é do administrador na simulação. Troque o perfil para treinar essa função.");
      const latest = JSON.parse(localStorage.getItem(key)) || D.fresh();
      if (!["team", "player", "match", "settings", "import", "championship","teamArchive"].includes(a.type)) {
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
        const publicId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        const r = M.applyMatch(current, { ...a, publicId, championship: a.championshipId ? (latest.championships || []).find((c) => c.id === a.championshipId) : null }, original),
          event = {
            ...r.detail,
            id: publicId,
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
        if(["team","player","teamArchive"].includes(a.type)){
          const entity=a.type==="player"?"players":"teams",target=a.teamId||a.data?.id||state[entity].at(-1)?.id;
          state.teamLocalAudit=state.teamLocalAudit||[];state.teamLocalAudit.push({ID:crypto.randomUUID?crypto.randomUUID():"local-"+Date.now()+"-"+Math.random().toString(36).slice(2),entity,target,actor:"demonstração",at:new Date().toISOString(),before:latest[entity].find(r=>r.id===target)||null,after:state[entity].find(r=>r.id===target),detail:{type:a.type==="teamArchive"?(a.archived?"arquivamento":"reativação"):"cadastro / edição",reason:a.reason||"",text:"Alteração na demonstração"}});
        }
        if (a.type === "match") {
          const m = state.matches[state.matches.length - 1];
          m.clock = M.emptyClock();
          m.publicNotice = "";
        }
      }
      trainingMode ? trainingStore(state) : localStorage.setItem(key, JSON.stringify(state));
    } else {
      if (!cloud) throw Error("Aguarde a conexão com o Firebase.");
      const savedClock = await cloud.send(a);
      if (a.type === "clock" && a.command === "ajustar" && savedClock) {
        const match = state.matches.find((item) => item.id === a.matchId);
        if (match && (match._revision ?? 0) < savedClock.revision) {
          match.clock = savedClock.clock;
        }
      }
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
document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-public-visibility]");
  if (!control || !admin || role !== "admin" || !cloud || C.demo) return;
  const match = state.matches.find((item) => item.id === control.dataset.publicVisibility);
  if (!match || !finalStatuses.includes(match.status)) return;
  const hidden = !match.publicHidden;
  const description = name(match.home) + " × " + name(match.away);
  const question = hidden
    ? "Ocultar " + description + " dos resultados e estatísticas públicas? A súmula e o histórico interno serão preservados."
    : "Publicar novamente o resultado de " + description + "?";
  if (!confirm(question)) return;
  control.disabled = true;
  try {
    await dispatch({type:"matchVisibility", matchId:match.id, hidden});
    toast(hidden ? "Partida ocultada do painel público." : "Partida republicada.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    control.disabled = false;
  }
});
function matchCard(m, button = false) {
  const points = D.score(m),
    sc = gameResult(m),
    a = team(m.home),
    b = team(m.away),
    isLive = m.status === "Ao vivo",
    isFinished = ["Encerrada", "Homologada"].includes(m.status);
  return `<article id="match-card-${esc(m.id)}" class="card match-card ${isLive ? "is-live" : ""}"><div class="match-top"><span class="tag">${esc(m.sport)}</span><span class="status ${isLive ? "live" : isFinished ? "is-finished" : ""}" ${isLive ? 'aria-label="Partida ao vivo"' : ""}>${isLive ? '<span class="live-status-dot" aria-hidden="true"></span>' : ""}${esc(m.status)}</span></div><p class="competition-name">${esc(m.competition || "Partida avulsa")}</p><div class="score"><div>${badge(a)}<div class="name">${esc(a.name)}</div></div><strong>${sc[0]} <span class="muted">:</span> ${sc[1]}</strong><div>${badge(b)}<div class="name">${esc(b.name)}</div></div></div>${clockMarkup(m)}<div class="stage-line">Etapa: ${esc(m.stage)} ${m.sport.startsWith("Vôlei") ? " • Pontos do set: " + points.join(" × ") : ""}</div>${m.sets.length ? '<p class="muted">Parciais: ' + m.sets.map((s) => s.score.join("–")).join(" / ") + "</p>" : ""}${matchEventSummary(m)}${timelineControl(m)}${m.publicNotice ? `<div class="public-notice"><strong>${["Pausada", "Suspensa", "Adiada", "Cancelada"].includes(m.status) ? "Informação da partida" : "Aviso da organização"}</strong><p>${esc(m.publicNotice)}</p></div>` : ""}<p class="match-meta">${esc(format(m.date))}<br>${esc(m.place || "Local a definir")}</p><div class="match-bottom">${button && (role === "admin" || (trainingMode && role === "operator" && !operatorPermissions.includes("gamesView")) || cloud?.canOperate(m.id)) ? `<button type="button" class="primary" data-open="${esc(m.id)}">${finalStatuses.includes(m.status) ? "Ver detalhes" : "Operar partida"} →</button>` : ""}${button && admin && role === "admin" && cloud && !C.demo && finalStatuses.includes(m.status) ? `<details><summary>Mais ações</summary><button type="button" data-public-visibility="${esc(m.id)}">${m.publicHidden ? "Publicar novamente" : "Ocultar do painel público"}</button></details>` : ""}<span class="brand-signature">WagnerBIZZA</span></div></article>`;
}

function liveStatusPanel(context) {
  const active = state.matches.filter((match) => ["Ao vivo", "Pausada", "Suspensa"].includes(match.status))
    .sort((a, b) => (a.status === "Ao vivo" ? 0 : 1) - (b.status === "Ao vivo" ? 0 : 1) || a.date.localeCompare(b.date));
  const upcoming = state.matches.filter((match) => ["Agendada", "Adiada"].includes(match.status))
    .slice().sort((a, b) => a.date.localeCompare(b.date))[0];
  const liveCount = active.filter((match) => match.status === "Ao vivo").length;
  const accessibleActive = context !== "admin" || role === "admin" ? active : active.filter((match) => cloud?.canOperate(match.id));
  const restrictedOperator = context === "admin" && role === "operator" && !active.length && !upcoming;
  const statusText = restrictedOperator ? "Nenhum jogo disponível para esta conta" : liveCount
    ? `${liveCount} jogo${liveCount === 1 ? "" : "s"} ao vivo agora`
    : active.length
      ? `Nenhum jogo ao vivo • ${active.length} interrompido${active.length === 1 ? "" : "s"}`
      : "Nenhum jogo ao vivo no momento";
  const detail = restrictedOperator
    ? "O administrador define as partidas para operar e os campeonatos para acompanhar."
    : upcoming
    ? `${name(upcoming.home)} × ${name(upcoming.away)} • ${esc(format(upcoming.date))}`
    : active.length || liveCount
      ? "Confira a situação e os controles da partida."
      : "Não há partidas em andamento ou programadas.";
  const jumpButtons = accessibleActive.map((match) => {
    const attribute = context === "admin" ? `data-live-jump="${esc(match.id)}"` : `data-public-live-jump="${esc(match.id)}"`;
    return `<button type="button" class="live-jump-button" ${attribute}><span>${esc(name(match.home))} × ${esc(name(match.away))}</span><small>${esc(match.status)} • ${esc(match.sport)}</small></button>`;
  }).join("");
  const fallback = context === "admin"
    ? '<button type="button" class="live-status-action" data-section="matches">Ver partidas</button>'
    : `<button type="button" class="live-status-action" data-public-area="${upcoming ? "schedule" : "live"}">${upcoming ? "Abrir agenda" : "Ver jogos ao vivo"}</button>`;
  return `<section class="live-status-panel ${liveCount ? "has-live-games" : "no-live-games"}" aria-label="Situação dos jogos"><div class="live-status-copy"><span class="live-status-indicator" aria-hidden="true"><span class="live-status-dot"></span></span><div><h2>${esc(statusText)}</h2><p>${detail}</p></div></div><div class="live-status-actions">${jumpButtons || fallback}</div></section>`;
}

function render() {
  if (timelineOpenId && timelineAppliedSize !== configuredHistoryPageSize()) closeTimeline();
  resetTeamProfileContext();
  resetRemovedContext();
  hideContextHelp();
  document.documentElement.style.setProperty("--accent", state.settings.color);
  document.title = systemDisplayName()+" — "+(admin?panelDisplayName():"Jogos e Resultados");
  renderBrandAndIdentity();
  syncArenaLayout();
  document.body.classList.toggle("report-mode", admin && ["matchSheets","reports","auditReports"].includes(section));
  $("#logout")?.classList.toggle("hidden", C.demo || !user);
  if (admin && !C.demo && (!user || !role)) {
    app.innerHTML = accessView();
    closeTimeline();
    if (accessBusy) app.querySelectorAll("button").forEach((b) => b.disabled = true);
    return;
  }
  if (!admin) {
    app.innerHTML = `<section class="hero" id="hero"><span class="tag">CENTRAL DE RESULTADOS / TEMPORADA</span><h1>${esc(publicEdition || systemDisplayName())}</h1><p class="muted">${esc(state.settings.subtitle)}</p></section>${C.demo ? "" : shareEditionControls(publicEdition)}${liveStatusPanel("public")}${personalTopShortcuts()}<div class="sectionhead"><h2>Acompanhe os jogos</h2><select id="filter" aria-label="Filtrar modalidade"><option value="">Todas as modalidades</option>${options(
      D.SPORTS,
      (x) => x,
      (x) => x,
    )}</select></div>${publicHub()}`;
    $("#filter").value = publicFilter;
    if (state.settings.banner)
      $("#hero").style.backgroundImage =
        `linear-gradient(90deg,#0c1014ed,#0c1014b0),url("${encodeURI(state.settings.banner).replace(/"/g, "%22")}")`;
    stopInvisibleTimeline();
    return;
  }
  // Uma sessão rebaixada ou trocada não mantém uma aba administrativa aberta.
  if (role !== "admin" && !["overview", "matches", "account", "documentation", ...(canManageRosters()?["teams","players","imports"]:[]), ...(canManageChampionships()?["championships"]:[]), ...(canCreateMatches()?["createMatch"]:[])].includes(section)) {
    section = "overview";
    selected = "";
  }
  if (selected && !state.matches.some((m) => m.id === selected)) selected = "";
  const sections = [
    ["overview", "Visão geral"],
    ["championships", "Campeonatos"],
    ["standings", "Classificação"],
    ["teams", "Equipes"],
    ["players", "Jogadores"],
    ["createMatch", "Cadastrar partida"],
    ["matches", "Acompanhar jogos"],
    ["matchSheets", "Súmulas"],
    ["reports", "Relatórios esportivos"],
    ["auditReports", "Relatório geral"],
    ["certificates", "Certificados"],
    ["cleanup", "Limpeza de testes"],
    ["testData", "Dados de teste"],
    ["credentials", "Credenciais de eventos"],
    ["settings", "Configurações"],
    ["users", "Usuários e permissões"],
    ["account", "Minha conta"],
    ["documentation", "Backups e suporte"],
    ["monitor", "Operadores e partidas"],
    ["imports", "Importar"],
  ];
  app.innerHTML = `<div class="sectionhead admin-heading noprint"><div><span class="tag">${esc(panelDisplayName())}</span><h1>${esc(selected && section==="matches" ? "Operação de partida" : sections.find(([id])=>id===section)?.[1] || "Visão geral")}</h1><p class="muted">${esc(navigationDescriptions[section]?.description || "Organize o evento e acompanhe os jogos.")}</p></div><span class="status">${C.demo ? "Demonstração" : role === "admin" ? "Administrador principal" : "Operador"}</span></div>${accountPendingBanner()}${liveStatusPanel("admin")}${workspaceNavigation(sections)}${locationTrail()}<div id="view">${role==="operator" && section==="overview"?operatorStartPanel(true):""}${view()}</div>`;
  stopInvisibleTimeline();
  applyArenaDrawer();
  if (busy || accessBusy) app.querySelectorAll("button").forEach((b) => (b.disabled = true));
  if (["matchSheets","reports"].includes(section) && $("[name=reportMatch]")) {
    $("[name=reportMatch]").value = reportFilter;
    $("#reportOutput").innerHTML = section==="matchSheets"
      ? documentMatches().map(reportMatch).join("")
      : sportsReportPreview();
  }
}
function publicMatches(filter) {
  const list = state.matches.filter(m=>(!filter||m.sport===filter)&&
    (publicArea==="live"?m.status==="Ao vivo":publicArea==="schedule"?["Agendada","Adiada"].includes(m.status):publicArea==="results"?finalStatuses.includes(m.status):!finalStatuses.includes(m.status)));
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
     : publicArea==="active"
      ? `<section class="card public-empty-state"><h3>Nenhum jogo atual nesta seleção</h3><p>Não há partidas agendadas, em andamento ou interrompidas${filter?" nesta modalidade":""}. Consulte os jogos concluídos em Resultados.</p><button type="button" class="primary" data-public-area="results">Ver resultados</button></section>`
      : empty("Nenhuma partida publicada para esta seleção.");
}
function view() {
  if(section==="testData" && role==="admin")return testDataPanel();
  if(section==="credentials" && role==="admin")return credentialsPanel();
  if(section==="teams"&&selectedTeamId&&canManageRosters())return teamProfileView();
  if(section==="documentation")return documentationView();
  if(section==="certificates")return role==="admin"?certificatePanel():empty("Certificados disponíveis somente para o administrador principal.");
  if(section==="auditReports")return role==="admin"?generalAuditPanel():empty("Relatórios gerais disponíveis somente para o administrador principal.");
  if(section==="monitor"&&role==="admin")return operatorMonitor();
  if (section === "cleanup" && role === "admin") return cleanupPanel();
  if (section === "standings" && role === "admin") return standingsPanel();
  if (section === "account") return accountView();
  if (section === "championships" && canManageChampionships()) return championshipsView();
  if (section === "users" && role === "admin") return usersView();
  if (section === "overview")return overviewMatchView();
  if (section === "teams") return teamsDirectoryView();
  if (section === "players")
    return `<div class="card"><h2>Cadastrar jogador</h2><p class="muted">Cadastre o elenco antes de criar a partida. A súmula preserva uma cópia do elenco daquela data.</p><form id="player"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome", "name", "text", "required")}${select("Equipe", "team", teamOptions())}${field("Número", "number")}${field("Posição", "position")}${select("Escalação", "reserve", '<option value="false">Titular</option><option value="true">Reserva / banco</option>')}</div><button class="primary">Salvar jogador</button> <button type="button" data-section="imports">Importar jogadores</button></form></div>${listPanel("players")}`;
  if (section === "createMatch" && canCreateMatches())
    return `<div class="card"><h2>Cadastrar partida</h2><p class="muted">Programe um jogo novo. Para acompanhar ou operar partidas, use Jogos.</p><form id="match"><div class="formgrid">${championshipSelectForCreate()}${select(
      "Modalidade",
      "sport",
      options(
        D.SPORTS,
        (x) => x,
        (x) => x,
      ),
    )}${select("Equipe da casa", "home", teamOptions())}${select("Equipe visitante", "away", teamOptions())}${field("Data e horário (horário deste computador)", "date", "datetime-local", "required")}${field("Local", "place")}${field("Competição / edição (partida sem vínculo)", "competition", "text", 'maxlength="150"')}${field("Árbitros e mesários", "referees")}${field("Etapa inicial (ex.: 1 ou 1º quarto)", "stage", "text", 'value="1"')}</div><button class="primary">Criar partida</button></form></div>`;
  if (section === "matches" && role !== "admin" && !selected) {
    const edition = listFilters.matches.edition;
    const teams = [...new Set(state.matches.filter((m) => !edition || (m.championshipId && m.competition === edition))
      .flatMap((m) => [m.home, m.away]))].sort((a,b) => name(a).localeCompare(name(b), "pt-BR"));
    const choices = operatorEditions.length ? `<div class="card"><h2>Meus campeonatos</h2>
      <div class="formgrid">
        ${filterSelect("matches", "edition", "Campeonato", operatorEditions, "Todos os jogos disponíveis")}
        ${filterSelect("matches", "team", "Equipe", teams.map((id) => [id,name(id)]), "Todas as equipes")}
      </div></div>` : "";
    return `${choices}<div class="card"><h2>${canViewAllGames() || operatorEditions.length ? "Acompanhar jogos" : "Partidas atribuídas"}</h2><p>${canViewAllGames()?"Consulte todas as partidas publicadas — próximas, ao vivo e encerradas. Para alterar placar e relógio, o administrador precisa liberar a partida individualmente ou autorizar a operação do campeonato.":"Você pode operar as partidas liberadas individualmente ou por campeonato. Os lances públicos estão em Ver lances anteriores. A auditoria administrativa e os relatórios são exclusivos do administrador."}</p></div>${listPanel("matches")}`;
  }
  if (section === "matches")
    return selected ? operate() : listPanel("matches");
  if (section === "imports") return importView();
  if (section === "matchSheets") return role==="admin"?matchSheetsView():empty("Súmulas disponíveis somente para o administrador principal.");
  if (section === "reports") return role==="admin"?reports():empty("Relatórios disponíveis somente para o administrador principal.");
  if (section === "settings") return settingsView() + registrationStyleForm();
  return "";
}
// 3 — O Firestore valida permissões, auditoria e transições em firestore.rules.
// 4 — Operação da partida. Sem apagar eventos: pontos errados recebem estorno.
function quickMatchControls(m,locked,live,c) {
  return `<section class="quick-control-group"><h3>Tempo</h3><div class="toolbar">
    <button type="button" data-clock-command="${c.running ? "parar" : "iniciar"}" ${locked || (!c.running && !live) ? "disabled" : ""}>${c.running ? "Parar relógio" : "Iniciar relógio"}</button>
    <button type="button" data-open-clock ${locked ? "disabled" : ""}>Ajustar tempo</button>
    </div>
    ${m.sport === "Futebol" ? `<h3>Acréscimos</h3><div class="toolbar">
      ${[1,2,3].map(minutes => `<button type="button" data-fast-added="${minutes}" ${!live ? "disabled" : ""}>Anunciar +${minutes} min</button>`).join("")}
      <button type="button" data-clock-command="iniciar-acrescimos" ${!live || c.running || c.segments?.acrescimos || m.addedTime?.phase === "started" || m.addedTime?.stage !== m.stage || !m.addedTime.minutes ? "disabled" : ""}>Iniciar acréscimos</button>
      </div><p class="muted">Anunciar publica a duração. Iniciar acréscimos começa a contagem com o relógio normal parado.</p>` : ""}
    </section><section class="quick-control-group"><h3>Avisos rápidos</h3><div class="toolbar">
      <button type="button" data-fast-notice="arbitragem" ${locked ? "disabled" : ""}>Aguardando arbitragem</button>
      <button type="button" data-fast-notice="atendimento" ${locked ? "disabled" : ""}>Atendimento em quadra</button>
      <button type="button" data-fast-notice="retirar" ${locked || !m.publicNotice ? "disabled" : ""}>Retirar aviso</button>
      </div><p class="muted">Os avisos aparecem ao público. Para interromper a partida, use Pausar jogo.</p></section>`;
}
let operationPanel = "tempo";
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
      ["Ao vivo", "Iniciar jogo e cronômetro"],
      ["Adiada", "Adiar"],
      ["Cancelada", "Cancelar"],
    ],
    Adiada: [
      ["Ao vivo", "Iniciar jogo e cronômetro"],
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
        (status !== "Ao vivo" || locked) && (role === "admin" ||
        (!["Cancelada", "Homologada"].includes(status) && !locked)),
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
        )}</select></label><div class="quick-buttons">${(m.sport === "Basquete" ? [1, 2, 3] : [1]).map((v) => `<button class="quick-score primary" data-quick="${v}" data-side="${side}" ${!live ? "disabled" : ""}>+${v}<small>${m.sport === "Futebol" || m.sport === "Futsal" ? "GOL" : v > 1 ? "PONTOS" : "PONTO"}</small></button>`).join("")}</div><div class="quick-event-buttons">
        ${["Futebol","Futsal","Handebol","Vôlei","Vôlei de praia"].includes(m.sport) ? `
          <button type="button" class="quick-yellow" data-fast-event="cartão amarelo" data-side="${side}" ${!live ? "disabled" : ""}>Amarelo</button>
          <button type="button" class="quick-red" data-fast-event="cartão vermelho" data-side="${side}" ${!live ? "disabled" : ""}>Vermelho</button>` : ""}
        <button type="button" data-fast-event="falta" data-side="${side}" ${!live ? "disabled" : ""}>Falta</button>
      </div></section>`;
    })
    .join("");
  const elapsedMs = M.elapsed(m);
  const clockDisplayMs = c.mode === "down" ? Math.max(0, c.durationMs - elapsedMs) : elapsedMs;
  return `<button data-back>← Voltar às partidas</button><div class="live-console"><div class="console-score">${matchCard(m)}${matchStartGuide(m)}${role === "admin" ? championshipLinkForm(m) : ""}<div class="card"><h3>Jogo e interrupções</h3><form id="interruption"><div class="formgrid"><label>Motivo de pausa / suspensão<select name="pauseReason"><option>Intervalo</option><option>Atendimento em quadra</option><option>Chuva ou condições do local</option><option>Problema técnico</option><option>Decisão da arbitragem</option><option>Outro motivo</option></select></label><label>Detalhes para o público<input name="pauseDetails" maxlength="220" placeholder="Ex.: retorno previsto em 10 minutos"></label></div><div class="toolbar">${buttons}</div></form><p class="muted">Pausar ou suspender o jogo para o cronômetro e informa o motivo ao público. O placar é preservado.</p>${!locked ? `<form id="stage" class="row"><input name="stage" aria-label="Etapa" value="${esc(m.stage)}" required style="max-width:180px"><button>Atualizar etapa</button></form>${m.sport.startsWith("Vôlei") ? "<p><button data-set>Fechar set e iniciar próximo</button></p>" : ""}</div><div class="card"><div class="toolbar" aria-label="Controles da mesa"><button type="button" data-operation-panel="tempo" aria-pressed="${operationPanel === "tempo"}" class="${operationPanel === "tempo" ? "primary" : ""}">Tempo</button><button type="button" data-operation-panel="avisos" aria-pressed="${operationPanel === "avisos"}" class="${operationPanel === "avisos" ? "primary" : ""}">Avisos</button></div><div id="mesa-tempo" ${operationPanel === "tempo" ? "" : "hidden"}><h3>Cronômetro</h3>${m.sport === "Futebol" && live ? `<form id="added-time"><label>Acréscimos da etapa (minutos)
     <input name="addedMinutes" type="number" min="0" max="30" step="1" required value="${m.addedTime?.stage === m.stage ? esc(m.addedTime.minutes) : 0}">
     </label><div class="toolbar">${[1, 2, 3].map(minutes => `<button type="button" data-added-minutes="${minutes}">+${minutes} min</button>`).join("")}
     <button type="submit" class="primary">Publicar acréscimos</button>
     <button type="button" data-clock-command="iniciar-acrescimos" ${c.running || c.segments?.acrescimos || m.addedTime?.phase === "started" || m.addedTime?.stage !== m.stage || !m.addedTime.minutes ? "disabled" : ""}>Iniciar acréscimos</button></div>
     <p class="muted">Pare o relógio normal para iniciar a contagem dos acréscimos. Use 0 para retirar o aviso.</p></form>` : ""}<div class="toolbar"><button data-clock-command="${c.running ? "parar" : "iniciar"}" ${!c.running && !live ? "disabled" : ""}>${c.running ? "Parar somente o relógio" : "Iniciar relógio"}</button></div><details id="clockSettings"><summary>Configurar duração e ajustar cronômetro</summary><p>Escolha um atalho ou preencha os tempos abaixo conforme o regulamento do seu evento. O atalho apenas preenche; clique em Salvar ajuste para aplicar.</p><div class="toolbar">${[10,20,45].map(n=>`<button type="button" data-clock-preset="${n}" ${c.running?"disabled":""}>${n} minutos</button>`).join("")}</div><form id="clock-config"><div class="formgrid"><label>Modo<select name="clockMode"><option value="up" ${c.mode === "up" ? "selected" : ""}>Crescente (00:00 →)</option><option value="down" ${c.mode === "down" ? "selected" : ""}>Regressivo (duração → 00:00)</option></select></label>${field("Duração da etapa (min)", "durationMin", "number", `min="0" max="360" value="${Math.floor((c.durationMs || 600000) / 60000)}"`)}${field("Tempo no visor (min)", "displayMin", "number", `min="0" max="360" value="${Math.floor(clockDisplayMs / 60000)}"`)}${field("Tempo no visor (seg)", "displaySec", "number", `min="0" max="59" value="${Math.floor(clockDisplayMs / 1000) % 60}"`)}${field("Motivo do ajuste", "clockReason", "text", 'required maxlength="300"')}</div><button ${c.running ? "disabled" : ""}>Salvar ajuste do cronômetro</button><p class="muted">No regressivo, informe quanto falta. No crescente, informe o tempo decorrido. Pare o relógio para ajustar. A troca de etapa não zera o tempo automaticamente. Ao chegar a zero, a contagem regressiva aguarda a decisão da arbitragem.</p></form></details>` : ""}</div><div id="mesa-avisos" ${operationPanel === "avisos" ? "" : "hidden"}><h3>Aviso para quem está assistindo</h3><form id="public-notice"><label>Mensagem pública<textarea name="notice" maxlength="300" ${locked ? "disabled" : ""}>${esc(m.publicNotice || "")}</textarea></label><p><button ${locked ? "disabled" : ""}>Publicar aviso</button> <button name="noticeAction" value="clear" ${locked || !m.publicNotice ? "disabled" : ""}>Retirar aviso</button></p></form></div></div></div><div class="console-actions"><div class="card quick-panel"><span class="tag">LANÇAMENTO RÁPIDO</span><h2>Marcar ponto</h2><p class="muted">Selecione o atleta, se desejar, e toque na pontuação da equipe.</p><div class="quick-grid">${quick}</div>${!live ? '<p class="public-notice">Os lançamentos ficam disponíveis quando o jogo está Ao vivo.</p>' : ""}
    ${quickMatchControls(m,locked,live,c)}</div><div class="card"><details><summary>Cartões, faltas, substituições e outros lances</summary>${
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
  }</details></div><div class="card"><h3>Observações operacionais da súmula</h3>${role === "admin" ? `<form id="notes"><label>Ocorrências<textarea name="notes" maxlength="5000" ${locked ? "disabled" : ""}>${esc(m.notes)}</textarea></label><p><button ${locked ? "disabled" : ""}>Salvar observações</button></p></form>` : `<p>${esc(m.notes || "Sem observações.")}</p><p class="muted">Edição exclusiva do administrador.</p>`}</div></div></div><div class="card"><h3>Histórico da partida</h3>${
    m.events
      .slice()
      .reverse()
      .map(
        (e) =>
          `<div class="event"><div><b>${esc(eventLabel(e, m))}</b> ${[0, 1].includes(e.side) ? esc(name([m.home, m.away][e.side])) : ""}</div><p>${esc(eventDescription(e))}</p><small>${esc(format(e.at))} • ${e.gameMs != null ? "Jogo " + prettyTime(e.gameMs) + " • " : ""}Operador ${esc(responsibleLabel(e))} • Etapa ${esc(e.stage || "—")}${e.player ? " • " + esc(m.roster.find((p) => p.id === e.player)?.name || "") : ""}</small>${!locked && role === "admin" && e.type === "ponto" && e.value > 0 && !m.events.some((x) => x.correctionOf === e.id) ? ` <button data-correct="${e.id}">Estornar</button>` : ""}</div>`,
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
        `<tr><td>${esc(format(e.at))}<small class="cell-sub">${e.gameMs != null ? "Jogo " + prettyTime(e.gameMs) : ""}</small></td><td>${esc(e.stage || "—")}</td><td>${esc(eventLabel(e, m))}</td><td>${[0, 1].includes(e.side) ? esc(name([m.home, m.away][e.side])) : "—"}${e.player ? '<small class="cell-sub">' + esc(m.roster.find((p) => p.id === e.player)?.name || "") + "</small>" : ""}</td><td>${esc(eventDescription(e))}</td><td>${esc(responsibleLabel(e))}</td></tr>`,
    )
    .join("");
  const organizationLogo = state.settings?.logo || "";
  const logoIsSafe = /^https:\/\//i.test(organizationLogo) || /^data:image\/(png|jpeg|webp);base64,/i.test(organizationLogo);
  const organizationLogoMarkup = logoIsSafe ? `<img src="${esc(organizationLogo)}" alt="Logo da organização" style="display:block;max-width:46px;max-height:46px;object-fit:contain;margin-right:12px">` : "";
  return `<article class="card report-sheet"><div class="report-header" style="display:flex;align-items:center;gap:10px"><div style="display:flex;align-items:center;min-width:0">${organizationLogoMarkup}<div><span class="tag">SÚMULA DA PARTIDA</span><h2>${esc(m.competition || "Partida avulsa")} • ${esc(m.sport)}</h2></div></div><span class="report-brand">WagnerBIZZA</span></div><div class="report-score"><div>${badge(team(m.home))}<strong>${esc(name(m.home))}</strong></div><b>${sc.join(" × ")}</b><div>${badge(team(m.away))}<strong>${esc(name(m.away))}</strong></div></div><div class="report-meta"><p><b>Data:</b> ${esc(format(m.date))}<br><b>Local:</b> ${esc(m.place || "Não informado")}</p><p><b>Arbitragem / mesa:</b> ${esc(m.referees || "Não informada")}<br><b>Situação:</b> ${esc(m.status)} • <b>Etapa:</b> ${esc(m.stage)} • <b>Relógio:</b> ${m.clock ? M.clockText(m) : "Não utilizado"}</p></div>${m.publicNotice ? '<p class="report-alert"><b>Aviso:</b> ' + esc(m.publicNotice) + "</p>" : ""}${m.sets.length ? "<p><b>Parciais:</b> " + m.sets.map((s) => esc(s.score.join(" × "))).join(" / ") + "</p>" : ""}<div class="roster-grid">${roster}</div><h3>Histórico e ocorrências</h3><div class="tablewrap report-events"><table><thead><tr><th>Horário / jogo</th><th>Etapa</th><th>Acontecimento</th><th>Equipe / atleta</th><th>Descrição / motivo</th><th>Responsável</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Nenhum lançamento carregado.</td></tr>'}</tbody></table></div><small>Nomes antigos são recuperados do cadastro disponível; quando ausentes, o UID é preservado.</small><section class="report-notes"><h3>Observações da súmula</h3><p>${esc(m.notes || "Sem observações.")}</p></section><section class="signatures"><div>Árbitro(a): __________________________</div><div>Mesa: __________________________</div><div>Responsável da equipe da casa: __________________________</div><div>Responsável da equipe visitante: __________________________</div><small>Súmula do sistema. Campos para assinatura em papel.</small></section></article>`;
}
function certificatePanel() {
  return `<section class="card certificate-panel noprint"><span class="tag">EMISSÃO DE DOCUMENTOS</span><h2>Certificados</h2><p class="muted">Preencha os dados e abra a visualização de impressão para imprimir ou salvar o certificado em PDF. Também é possível baixar os dados preenchidos em JSON; o sistema não mantém um arquivo permanente de certificados emitidos.</p><datalist id="certificateChampionships">${(state.championships||[]).map(c=>`<option value="${esc(championshipTitle(c))}">${esc(c.sport)}</option>`).join("")}</datalist><form id="arenaCertificateForm"><div class="formgrid">${field("Nome completo do participante", "certificateName", "text", 'required maxlength="120" placeholder="Nome que aparecerá no certificado"')}${field("Participação / reconhecimento", "certificateRole", "text", 'required maxlength="120" value="Participação"')}${field("Evento / campeonato", "certificateEvent", "text", 'required maxlength="150" list="certificateChampionships" placeholder="Nome do evento ou campeonato"')}${field("Modalidade", "certificateSport", "text", 'maxlength="80" placeholder="Ex.: Futebol, Basquete, Vôlei"')}${field("Local", "certificatePlace", "text", 'maxlength="120" placeholder="Cidade ou local do evento"')}${field("Data de emissão", "certificateDate", "date", `required value="${new Date().toISOString().slice(0,10)}"`)}${field("Responsável pela emissão", "certificateIssuer", "text", 'required maxlength="100" value="WagnerBIZZA"')}</div><div class="toolbar"><button class="primary" type="submit">Visualizar / imprimir ou salvar em PDF</button><button type="button" data-certificate-json>Baixar dados do certificado (JSON)</button></div></form><div class="certificate-institutional"><h3>Certificado institucional do projeto</h3><p>Documento de reconhecimento da idealização e do desenvolvimento da plataforma Arena Esportiva.</p><div class="toolbar"><button type="button" data-institutional-certificate>Visualizar / imprimir em PDF</button><button type="button" data-institutional-certificate-json>Baixar dados institucionais (JSON)</button></div></div><p class="muted">Cada emissão recebe um código identificador. Nesta etapa, o código identifica o documento, mas ainda não representa uma validação pública online nem um registro permanente no Firebase.</p></section>`;
}
function certificateDocument({name:person, role:participation, event, sport, place, date, issuer, institutional=false}) {
  const code = "ARENA-" + new Date().getFullYear() + "-" + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2,10)).replace(/-/g,"").slice(0,12).toUpperCase();
  // Reutiliza o logo já salvo em Configurações, sem criar outro cadastro de imagem.
  const organizationLogo = state.settings?.logo || "";
  const logoIsSafe = /^https:\/\//i.test(organizationLogo) || /^data:image\/(png|jpeg|webp);base64,/i.test(organizationLogo);
  const organizationLogoMarkup = logoIsSafe
    ? `<img class="certificate-logo" src="${esc(organizationLogo)}" alt="Logo da organização">`
    : "";
  const title = institutional ? "CERTIFICADO INSTITUCIONAL" : "CERTIFICADO DE PARTICIPAÇÃO";
  const recipient = institutional ? "Wagner BIZZA" : person;
  const description = institutional
    ? "Por idealizar e desenvolver a plataforma ARENA ESPORTIVA, um projeto independente dedicado à organização, gestão e acompanhamento de eventos e competições esportivas, reunindo tecnologia, informação e incentivo ao esporte."
    : `Certificamos que ${recipient} participou como ${participation} do evento ${event}${sport ? `, na modalidade ${sport}` : ""}${place ? `, realizado em ${place}` : ""}, recebendo este reconhecimento pela sua participação.`;
  const safe = v => esc(v);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} • Arena Esportiva</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#18232e;font-family:Arial,Helvetica,sans-serif}.sheet{width:297mm;height:210mm;margin:0 auto;padding:13mm;background:#fff;position:relative;overflow:hidden}.frame{height:100%;border:2px solid #183b52;padding:12mm 17mm;position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center}.frame:before{content:"";position:absolute;inset:3mm;border:1px solid #b58b45;pointer-events:none}.certificate-logo{position:absolute;top:9mm;right:12mm;display:block;max-width:30mm;max-height:24mm;object-fit:contain}.brand{font-size:13px;font-weight:800;letter-spacing:5px;color:#183b52}.mark{font-size:34px;color:#b58b45;margin:3mm 0}.eyebrow{font-size:13px;letter-spacing:4px;color:#536879;margin:2mm 0}.title{font-family:Georgia,serif;font-size:31px;letter-spacing:2px;color:#183b52;margin:4mm 0 8mm}.intro{font-size:15px;color:#53616c}.recipient{font-family:Georgia,serif;font-size:31px;font-weight:bold;color:#142f42;margin:5mm 0 7mm;border-bottom:1px solid #b58b45;padding:0 15mm 4mm}.description{font-family:Georgia,serif;font-size:17px;line-height:1.65;max-width:220mm;margin:0 auto}.bottom{width:100%;display:flex;justify-content:space-between;align-items:end;margin-top:13mm;font-size:12px;color:#465663}.signature{min-width:65mm;border-top:1px solid #536879;padding-top:3mm}.code{position:absolute;bottom:5mm;right:8mm;font-size:9px;color:#65737d}.seal{position:absolute;top:10mm;right:12mm;border:1px solid #b58b45;border-radius:50%;width:24mm;height:24mm;display:grid;place-content:center;color:#183b52;font-size:9px;font-weight:bold;transform:rotate(12deg)}@media print{body{background:white}.sheet{margin:0;box-shadow:none}}@media screen{.sheet{margin:18px auto;box-shadow:0 8px 35px #0002}}@media(max-width:800px){.sheet{transform-origin:top left;}}</style></head><body><main class="sheet"><div class="frame">${organizationLogoMarkup || '<div class="seal">ARENA<br>ESPORTIVA</div>'}<div class="brand">WAGNERBIZZA • ARENA ESPORTIVA</div><div class="mark">◇</div><div class="eyebrow">RECONHECIMENTO OFICIAL DO PROJETO</div><h1 class="title">${title}</h1><p class="intro">Certificamos para os devidos fins que</p><div class="recipient">${safe(recipient)}</div><p class="description">${safe(description)}</p><div class="bottom"><div class="signature">${safe(issuer || "WagnerBIZZA")}<br>Responsável pela emissão</div><div>${safe(date)}${place ? `<br>${safe(place)}` : ""}</div><div class="signature">Arena Esportiva<br>Gestão esportiva</div></div><div class="code">Código do documento: ${code}</div></div></main><script>window.addEventListener('load',()=>{const logo=document.querySelector('.certificate-logo');let printed=false;const print=()=>{if(printed)return;printed=true;setTimeout(()=>window.print(),180)};if(logo&&!logo.complete){logo.addEventListener('load',print,{once:true});logo.addEventListener('error',print,{once:true});setTimeout(print,3000)}else print()});</script></body></html>`;
  const win = window.open("", "_blank");
  if (!win) { toast("Permita janelas pop-up para gerar o certificado.", true); return; }
  win.document.open(); win.document.write(html); win.document.close();
}
let generalAuditRows=[],generalAuditLoaded=false,generalAuditBusy=false,generalAuditSearch="";
function filteredAuditRows(rows=generalAuditRows) {
 const normalize=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const q=normalize(generalAuditSearch);
 return rows.filter(r=>!q||normalize([responsibleLabel(r),r.target,r.entity,JSON.stringify(r.detail),JSON.stringify(r.before),JSON.stringify(r.after)].join(" ")).includes(q));
}
function auditReportDate(value){
 if(!value)return "Data não informada";
 const date=value?.toDate?.()||new Date(value||0);
 return Number.isNaN(date.getTime())?"Data não informada":date.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
}
function auditReportValue(value){
 if(value==null)return "—";
 if(typeof value==="boolean")return value?"Sim":"Não";
 if(Array.isArray(value))return value.length>6?`${value.length} itens`:value.join(", ")||"Nenhum";
 const text=typeof value==="object"?JSON.stringify(value):String(value);
 return text.length>180?text.slice(0,177)+"…":text;
}
function auditReportPreview(){
 if(!generalAuditLoaded)return '<p class="muted">Clique em Consultar alterações para ver os registros do Firebase. A consulta inclui cadastros, partidas, configurações, permissões e exclusões.</p>';
 const rows=filteredAuditRows().slice().sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
 if(!rows.length)return empty("Nenhuma alteração registrada.");
 const visible=rows.slice(0,100),entityNames={settings:"Configurações",teams:"Equipe",players:"Jogador",matches:"Partida",championships:"Campeonato",users:"Acesso de usuário"};
 const details=(items,open=false)=>items.map(r=>{
  const before=r.before||{},after=r.after||{},keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!["_audit","_updatedAt","updatedAt","createdAt","revision","auditId"].includes(k)&&JSON.stringify(before[k]??null)!==JSON.stringify(after[k]??null));
  const changes=keys.slice(0,30).map(k=>tr([k,auditReportValue(before[k]),auditReportValue(after[k])]));
  const description=[r.detail?.text,r.detail?.reason?`Motivo: ${r.detail.reason}`:""].filter(Boolean).join(" • ");
  const target=after.name||before.name||r.target||"—";
  return `<details class="event" ${open?"open":""}><summary>${esc(auditReportDate(r.at))} • ${esc(entityNames[r.entity]||r.entity||"Registro")} • ${esc(r.detail?.type||"Alteração")} • ${esc(target)}</summary><p>Responsável (UID): ${esc(responsibleLabel(r))}<br>ID do registro: ${esc(r.target||"—")}${description?`<br>${esc(description)}`:""}</p>${changes.length?table(["Campo","Antes","Depois"],changes):'<p class="muted">Sem diferenças de campos disponíveis.</p>'}${keys.length>changes.length?`<small>Exibindo ${changes.length} de ${keys.length} campos alterados.</small>`:""}</details>`;
 }).join("");
 return `<h2 class="audit-print-title">Relatório geral de alterações</h2><p class="muted" role="status">${rows.length} alteração(ões) encontradas. ${rows.length>visible.length?"Na tela, exibindo as 100 mais recentes; a impressão e as exportações incluem todas.":""} Os horários são de Brasília.</p><div class="audit-screen-only">${details(visible)}</div><div class="audit-print-only">${details(rows,true)}</div>`;
}
function generalAuditPanel(){
 return `<section class="card noprint"><h2>Relatório geral de alterações</h2><p>Consulte as alterações registradas no Firebase: equipes, jogadores, campeonatos, partidas, configurações, permissões de operadores e exclusões de partidas de teste. A visualização mostra as 100 alterações mais recentes; as exportações incluem todos os registros que correspondem à pesquisa.</p>${field("Pesquisar nome, UID, campeonato, equipe ou acontecimento","audit-search","search",`value="${esc(generalAuditSearch)}"`)}<p>Deixe a pesquisa vazia para incluir todos os registros.</p><div class="toolbar"><button type="button" data-audit-view ${generalAuditBusy?"disabled":""}>${generalAuditBusy?"Consultando…":generalAuditLoaded?"Atualizar e visualizar alterações":"Consultar alterações"}</button><button type="button" data-audit-pdf>Imprimir / salvar relatório em PDF</button><button type="button" data-audit-json>Baixar relatório completo (JSON)</button><button type="button" data-audit-excel>Baixar relatório completo (Excel)</button></div></section><div id="generalAuditOutput">${auditReportPreview()}</div>`;
}
function documentMatches(includeSelection = true) {
 const f=documentFilters;
 const normalize=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 return state.matches.filter(m=>{
  const c=(state.championships||[]).find(c=>c.id===m.championshipId);
  const day=String(m.date||"").slice(0,10);
  return (!includeSelection||!reportFilter||m.id===reportFilter)
   && (!f.championship||m.championshipId===f.championship)
   && (!f.sport||m.sport===f.sport) && (!f.status||m.status===f.status)
   && (!f.from||day>=f.from) && (!f.to||day<=f.to)
   && (!f.query||normalize([m.id,m.competition,c?.name,c?.season,c?.category,name(m.home),name(m.away),m.place].join(" ")).includes(normalize(f.query)));
 }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function responsibleLabel(e) {
 const id=e.actor||"";
 const person=(state.users||[]).find(p=>p.id===id);
 const title=e.actorName||person?.name||person?.email||(id===user?.uid?(user.displayName||user.email):"");
 const adminActor=e.actorRole==="admin"||cloud?.isAdministratorUID?.(id);
 return `${title||"Nome não disponível"} • ${adminActor?"Administrador":e.actorRole==="operator"||person?"Operador":"Perfil não registrado"}${id?" • UID: "+id:""}`;
}
function reportMatchSelector() {
 if (reportFilter && !documentMatches(false).some(m=>m.id===reportFilter)) reportFilter="";
 const f=documentFilters;
 const pick=(label,key,rows)=>select(label,"document-"+key,'<option value="">Todos</option>'+rows.map(([id,text])=>`<option value="${esc(id)}" ${f[key]===id?"selected":""}>${esc(text)}</option>`).join(""));
 return `<div class="formgrid">${pick("Campeonato / temporada","championship",(state.championships||[]).map(c=>[c.id,championshipTitle(c)+" • "+c.sport+(c.category?" • "+c.category:"")]))}${pick("Modalidade","sport",[...new Set(state.matches.map(m=>m.sport))].map(v=>[v,v]))}${pick("Situação","status",[...new Set(state.matches.map(m=>m.status))].map(v=>[v,v]))}${field("Pesquisar equipe, campeonato, local ou ID","document-query","search",`value="${esc(f.query)}"`)}${field("De","document-from","date",`value="${esc(f.from)}"`)}${field("Até","document-to","date",`value="${esc(f.to)}"`)}${select("Partida","reportMatch",'<option value="">Todas as partidas filtradas</option>'+options(documentMatches(false),m=>m.id,m=>name(m.home)+" × "+name(m.away)+" • "+format(m.date)+" • "+(m.competition||"Avulsa")))}</div><p role="status">${documentMatches().length} partida(s) selecionada(s). Os filtros são usados na visualização e nas exportações.</p><button type="button" data-document-clear>Limpar filtros dos documentos</button>`;
}
function matchSheetsView() {
 return `<section class="card noprint"><h2>Súmulas</h2><p>Escolha uma partida para visualizar sua súmula, imprimir ou salvar em PDF. A exportação JSON contém os dados das partidas selecionadas.</p>${reportMatchSelector()}<div class="toolbar"><button type="button" data-report-pdf>Visualizar / salvar súmula em PDF</button><button type="button" data-report-print>Imprimir visualização</button><button type="button" data-match-json>Baixar súmula (JSON)</button></div></section><div id="reportOutput">${documentMatches().map(reportMatch).join("") || empty("Cadastre uma partida para gerar a súmula.")}</div>`;
}
function sportsReportPreview(){
 const matches=documentMatches();
 if(!matches.length)return empty("Nenhuma partida corresponde à seleção.");
 return `<section class="card"><h3>Resultados das partidas • ${matches.length}</h3>${table(["Modalidade","Campeonato","Partida","Placar","Data","Local","Situação"],matches.map(m=>tr([m.sport,m.competition||"Partida avulsa",name(m.home)+" × "+name(m.away),gameResult(m).join(" × "),format(m.date),m.place||"Não informado",m.status])))}</section>`;
}
function reports() {
 return `<section class="card noprint"><h2>Relatórios esportivos</h2><p>Visualize resultados das partidas e exporte os dados selecionados. O Excel detalhado contém resultados, elencos, eventos e parciais.</p>${reportMatchSelector()}<div class="toolbar"><button type="button" data-sports-report-pdf>Imprimir / salvar relatório em PDF</button><button type="button" data-report-excel class="primary">Baixar relatório (Excel)</button><button type="button" data-sports-report-json>Baixar relatório (JSON)</button></div></section><div id="reportOutput">${sportsReportPreview()}</div>`;
}
document.addEventListener("submit", event => {
  if (event.target?.id !== "arenaCertificateForm") return;
  event.preventDefault();
  if (role !== "admin") { toast("Somente o administrador principal pode emitir certificados.", true); return; }
  const data = new FormData(event.target);
  certificateDocument({name:data.get("certificateName"),role:data.get("certificateRole"),event:data.get("certificateEvent"),sport:data.get("certificateSport"),place:data.get("certificatePlace"),date:new Date(data.get("certificateDate")+"T12:00:00").toLocaleDateString("pt-BR"),issuer:data.get("certificateIssuer")});
});
document.addEventListener("click",event=>{
 const button=event.target.closest("[data-certificate-json],[data-institutional-certificate-json]");
 if(!button||role!=="admin")return;
 try{
  if(button.hasAttribute("data-institutional-certificate-json")){
   download("certificado-institucional-dados.json",JSON.stringify({formato:"arena-certificado-dados-v1",tipo:"institucional",titular:"Wagner BIZZA",projeto:"Arena Esportiva",emissor:"WagnerBIZZA",data:new Date().toISOString()},null,2));return;
  }
  const form=$("#arenaCertificateForm");
  if(!form?.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));
  download("certificado-dados.json",JSON.stringify({formato:"arena-certificado-dados-v1",tipo:"participacao",dados:values,geradoEm:new Date().toISOString()},null,2));
 }catch(error){toast(error.message,true);}
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-institutional-certificate]");
  if (!button) return;
  if (role !== "admin") { toast("Somente o administrador principal pode emitir certificados.", true); return; }
  certificateDocument({date:new Date().toLocaleDateString("pt-BR"),issuer:"WagnerBIZZA",institutional:true});
});

function exportExcel() {
  sheetReady();
  const ms = documentMatches(),
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
        "Responsável": responsibleLabel(e),
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
      "Responsável",
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
function download(name, value, type = "application/json") {
  const u = URL.createObjectURL(
      new Blob([value], { type }),
    ),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
// 7 — Acesso e aprovação. Senhas ficam somente no Firebase Authentication.
let registrationDraft = null;
let registrationContact = null;
function accessView() {
  const wrap = (content) => `<section class="card access-card" style="max-width:520px;margin:40px auto"><span class="tag">ACESSO À CENTRAL</span>${content}</section>`;
  if (user) {
    const messages = {
      loading: "Conferindo sua autorização…",
      incomplete: "Sua conta foi criada, mas a solicitação de acesso ainda precisa ser concluída.",
      verify: "Confirme seu e-mail pelo link enviado pelo Firebase. A operação também depende da aprovação do administrador principal.",
      pending: "E-mail confirmado. Sua solicitação aguarda aprovação do administrador principal.",
      "removal-requested": "Sua solicitação de exclusão foi enviada ao administrador. Seu acesso está suspenso enquanto aguarda a conclusão.",
      blocked: "Seu acesso está bloqueado. Procure o administrador principal.",
      unauthorized: "Esta conta ainda não está autorizada. Procure o administrador principal."
    };
    return wrap(`<h2>Situação do acesso</h2><p>${esc(user.email || "")}</p><p role="status">${messages[accessStatus] || messages.unauthorized}</p>${accessStatus === "incomplete" ? `<form id="complete-access"><p>Complete seus dados para enviar o pedido ao administrador.</p>
    ${field("Nome completo", "name", "text", `required maxlength="100" autocomplete="name" value="${esc(registrationDraft?.name || user.displayName || "")}"`)}
    ${field("E-mail da conta", "email", "email", `readonly value="${esc(user.email || "")}"`)}
    ${field("Telefone com DDD", "phone", "tel", `required maxlength="25" autocomplete="tel" value="${esc(registrationDraft?.phone || "")}"`)}<p><button class="primary">Concluir solicitação</button></p></form>` : ""}<div class="toolbar">${!user.emailVerified && accessStatus !== "loading" ? '<button type="button" data-access-verify>Enviar confirmação de e-mail</button>' : ""}<button type="button" data-access-refresh>Já confirmei / Atualizar acesso</button><button type="button" data-access-exit>Sair desta conta</button></div><p class="muted">O cadastro não autoriza alterações de placar. A senha não é exibida para a organização.</p>${googleLinkPanel()}${ownContactForm()}${ownRemovalForm()}`);
  }
  if (authMode === "register") {
    if (!registrationDraft) return wrap(`<h2>Cadastro de operador</h2><p>Etapa 1 de 2 · Seus dados</p>
      <form id="registration-details"><div style="display:grid;gap:14px">
      ${field("Nome completo", "name", "text", `required maxlength="100" autocomplete="name" value="${esc(registrationContact?.name || "")}"`)}
      ${field("E-mail", "email", "email", `required maxlength="254" autocomplete="email" value="${esc(registrationContact?.email || "")}"`)}
      ${field("Telefone com DDD", "phone", "tel", `required maxlength="25" autocomplete="tel" placeholder="(11) 99999-9999" value="${esc(registrationContact?.phone || "")}"`)}
      </div><p class="muted">Nome e contato serão apresentados ao administrador para avaliar seu pedido de acesso. O telefone serve para contato com a organização.</p>
      <p><button class="primary">Continuar</button></p></form>
      <button type="button" data-access-mode="login">Já tenho conta · Entrar</button>`);
    return wrap(`<h2>Criar acesso</h2><p>Etapa 2 de 2 · Escolha como entrar</p>
      <p><strong>${esc(registrationDraft.name)}</strong><br>${esc(registrationDraft.email)}<br>${esc(registrationDraft.phone)}</p>
      <button type="button" data-registration-back>Corrigir meus dados</button>
      ${googleEntryButton(true)}
      <p class="muted">Para usar Google, selecione a conta com o e-mail informado. Contas escolares podem exigir autorização da instituição.</p>
      <form id="register"><input type="hidden" name="name" value="${esc(registrationDraft.name)}">
      <input type="hidden" name="email" value="${esc(registrationDraft.email)}">
      <input type="hidden" name="phone" value="${esc(registrationDraft.phone)}">
      ${field("Senha (mínimo de 8 caracteres)", "password", "password", 'required minlength="8" autocomplete="new-password"')}
      ${field("Confirmar senha", "confirmPassword", "password", 'required minlength="8" autocomplete="new-password"')}
      <p><button class="primary">Criar conta e solicitar acesso</button></p></form>
      <p class="muted">Depois de confirmar o e-mail, aguarde a aprovação do administrador.</p>`);
  }
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
    "auth/admin-restricted-operation": "O Firebase está impedindo novos cadastros. Peça ao administrador para conferir as configurações de cadastro no Authentication.",
    "auth/web-storage-unsupported": "O navegador bloqueou o armazenamento necessário para a entrada com Google. Tente uma janela comum com o armazenamento do site permitido.",
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
let accessAuditExpanded = false;
function championshipOperationPicker(operator) {
  const granted = new Set(operator.operatedChampionships || []);
  const groups = new Map();
  for (const c of state.championships || []) {
    const title = championshipTitle(c);
    if (!groups.has(title)) groups.set(title,[]);
    groups.get(title).push(c);
  }
  return `<fieldset><legend>Operar campeonato inteiro</legend>
    <p>Autoriza placar, relógio, cartões e avisos de todas as partidas vinculadas às modalidades e categorias marcadas, incluindo partidas criadas depois.</p>
    ${[...groups].map(([title,items]) => `<section class="championship-operation-group">
      <label class="confirmation-check"><input type="checkbox" data-operated-all ${items.every(c => granted.has(c.id)) ? "checked" : ""}>
        <span><strong>${esc(title)}</strong><br>Todas as modalidades e categorias abaixo</span></label>
      <div>${items.map(c => `<label class="confirmation-check"><input type="checkbox" name="operatedChampionships" value="${esc(c.id)}" ${granted.has(c.id) ? "checked" : ""}>
        <span>${esc(c.sport)} · ${esc(c.category || "Sem categoria")}</span></label>`).join("")}</div>
      </section>`).join("") || "<p>Nenhum campeonato cadastrado.</p>"}
    <p class="muted">Se adicionar outra modalidade ou categoria ao campeonato, revise esta autorização. As permissões de criar partidas e gerenciar cadastros são concedidas nas opções próprias.</p></fieldset>`;
}
function operatorPermissionSummary(operator) {
  const direct = (operator.matches || []).length;
  const operated = (operator.operatedChampionships || []).length;
  const current = state.matches.filter(m => (operator.matches || []).includes(m.id) ||
    (m.championshipId && (operator.operatedChampionships || []).includes(m.championshipId))).length;
  return `<div class="public-notice"><strong>Autorizações de operação salvas</strong>
    <p>${current} partida(s) atual(is) · ${direct} atribuição(ões) individual(is) · ${operated} modalidade(s)/categoria(s) de campeonato</p>
    <p>Operar campeonato inclui as novas partidas vinculadas às opções autorizadas.</p></div>`;
}
function updateOperationSummary(form) {
  const output = form.querySelector("[data-permission-preview]");
  if (!output) return;
  const matches = [...form.querySelectorAll('input[name="assignedMatches"]:checked')].map(input => input.value);
  const championships = [...form.querySelectorAll('input[name="operatedChampionships"]:checked')].map(input => input.value);
  const count = state.matches.filter(m => matches.includes(m.id) || (m.championshipId && championships.includes(m.championshipId))).length;
  output.textContent = count+" partida(s) atual(is) para operar, mais as novas vinculadas às modalidades/categorias marcadas.";
}
document.addEventListener("change", event => {
  const form = event.target.closest("#access-user");
  if (!form) return;
  if (event.target.hasAttribute("data-operated-all")) {
    for (const input of event.target.closest(".championship-operation-group").querySelectorAll('input[name="operatedChampionships"]'))
      input.checked = event.target.checked;
  }
  for (const group of form.querySelectorAll(".championship-operation-group")) {
    const items = [...group.querySelectorAll('input[name="operatedChampionships"]')];
    const selected = items.filter(input => input.checked).length;
    const all = group.querySelector("[data-operated-all]");
    all.checked = selected === items.length;
    all.indeterminate = selected > 0 && selected < items.length;
  }
  updateOperationSummary(form);
});
function operatorMatchPicker(operator) {
  const selected = new Set(operator.matches || []);
  const groups = [["scheduled","Agendadas"],["running","Em andamento"],["history","Histórico"]];
  const rows = state.matches.slice().sort((a,b) => new Date(a.date) - new Date(b.date)).map((match) => {
    const group = finalStatuses.includes(match.status) ? "history"
      : ["Agendada","Adiada"].includes(match.status) ? "scheduled" : "running";
    const teams = name(match.home) + " × " + name(match.away);
    const date = format(match.date);
    return `<label class="confirmation-check" data-assignment-row="${group}" data-assignment-hidden="${Boolean(match.publicHidden)}"
      data-assignment-search="${esc(searchText([teams,match.competition,match.place,match.sport,match.status,date].join(" ")))}"
      ${group === "scheduled" ? "" : 'hidden style="display:none"'}>
      <input type="checkbox" name="assignedMatches" value="${esc(match.id)}" ${selected.has(match.id) ? "checked" : ""}>
      <span><strong>${esc(teams)}</strong> · ${esc(match.status)} · ${esc(date)}
      ${match.publicHidden ? " · Oculta do público" : ""}${selected.has(match.id) ? " · Já atribuída" : ""}
      <br><small>${esc([match.sport,match.competition,match.place].filter(Boolean).join(" · "))}</small></span>
    </label>`;
  }).join("");
  return `<fieldset data-assignment-picker><legend>Operar partidas específicas</legend><p>Use para liberar jogos avulsos ou complementar os campeonatos autorizados acima.</p>
    <div class="row" role="group" aria-label="Situação da partida">${groups.map(([id,label]) =>
      `<button type="button" data-assignment-group="${id}" aria-pressed="${id === "scheduled"}"
        class="${id === "scheduled" ? "primary" : ""}">${label}</button>`).join("")}</div>
    <label>Buscar partida<input type="search" data-assignment-query placeholder="Equipe, Copa, local ou modalidade"></label>
    <label class="confirmation-check"><input type="checkbox" data-assignment-hidden-only><span>Exibir só partidas ocultas do público</span></label>
    <p class="muted" data-assignment-count aria-live="polite">${selected.size} partida(s) selecionada(s)</p>
    <div>${rows}</div>
    <p class="muted" data-assignment-empty ${state.matches.some(m => ["Agendada","Adiada"].includes(m.status)) ? "hidden" : ""}>Nenhuma partida nesta seleção.</p>
    <p class="muted">As marcações são mantidas ao trocar de grupo ou usar a busca.</p>
  </fieldset>`;
}

function updateOperatorMatchPicker(picker) {
  const group = picker.querySelector('[data-assignment-group][aria-pressed="true"]').dataset.assignmentGroup;
  const query = searchText(picker.querySelector("[data-assignment-query]").value);
  const hiddenOnly = picker.querySelector("[data-assignment-hidden-only]").checked;
  let visible = 0;
  for (const row of picker.querySelectorAll("[data-assignment-row]")) {
    const show = row.dataset.assignmentRow === group && row.dataset.assignmentSearch.includes(query)
      && (!hiddenOnly || row.dataset.assignmentHidden === "true");
    row.hidden = !show;
    row.style.display = show ? "" : "none";
    visible += Number(show);
  }
  picker.querySelector("[data-assignment-empty]").hidden = visible > 0;
  const count = picker.querySelectorAll('input[name="assignedMatches"]:checked').length;
  picker.querySelector("[data-assignment-count]").textContent = count + " partida(s) selecionada(s)";
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-assignment-group]");
  if (!button) return;
  const picker = button.closest("[data-assignment-picker]");
  for (const tab of picker.querySelectorAll("[data-assignment-group]")) {
    tab.setAttribute("aria-pressed", String(tab === button));
    tab.classList.toggle("primary", tab === button);
  }
  updateOperatorMatchPicker(picker);
});
document.addEventListener("input", (event) => {
  if (event.target.matches('[data-assignment-query],[data-assignment-hidden-only],input[name="assignedMatches"]')) {
    updateOperatorMatchPicker(event.target.closest("[data-assignment-picker]"));
  }
});

let showRemovedOperators = false;
function usersView() {
  if (C.demo) return `<div class="card"><h2>Usuários e permissões</h2><p>Esta função utiliza as contas reais do Firebase e não está disponível na demonstração local.</p></div>`;
  const owner = cloud?.mainUID;
  const users = (state.users || []).filter((u) => u.id !== owner && !cloud?.isAdministratorUID?.(u.id) && (showRemovedOperators ? u.deleted === true : u.deleted !== true)).slice().sort((a,b) =>
    Number(b.role === "pending") - Number(a.role === "pending") || (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id));
  const label = (u) => u.deleted === true ? "Acesso removido" : u.removalRequested ? "Exclusão solicitada" : u.role === "pending" ? "Aguardando aprovação" : u.role === "operator" ? u.enabled === false ? "Bloqueado" : "Operador aprovado" : "Perfil antigo — revisar";
  const link = new URL("painel.html", location.href);
  link.search = "?acesso=cadastro";
  const editing = users.find((u) => u.id === managedUserId);
  const followed = editing?.followedEditions || [];
  const editionChoices = [...new Set([...(state.championships || []).map(championshipTitle), ...followed])].sort();
  const editionOptions = editionChoices.map((title) => `<label class="confirmation-check">
    <input type="checkbox" name="followedEditions" value="${esc(title)}" ${followed.includes(title) ? "checked" : ""}>
    <span>${esc(title)}</span></label>`).join("") || "<p>Nenhum campeonato cadastrado.</p>";
  const methodLabel = uid => {
    const record = (state.accountMethods || []).find(item => item.id === uid);
    return record ? record.methods.map(method => method === "google.com" ? "Google" : "E-mail e senha").join(" · ") || "Não informado"
      : "Aguardando próxima entrada";
  };
  const editor = editing && editing.deleted !== true ? `<section class="card"><h3>Permissões de ${esc(editing.name || editing.email || "Operador cadastrado")}</h3>
    ${editing.removalRequested ? `<div class="public-notice"><strong>Solicitação de exclusão recebida</strong><p>${esc(editing.removalReason || "")}</p><p>Use Excluir acesso do operador abaixo para concluir. Salvar permissões decide novamente o acesso desta pessoa.</p></div>` : ""}
    <p><strong>Entrada vinculada</strong> · ${esc(methodLabel(editing.id))}</p>
    <p><strong>Telefone de contato</strong> · ${esc(editing.phone || "Não informado no cadastro antigo")}</p><p>${esc(editing.email || "E-mail não registrado no perfil antigo")}<br><small>UID: ${esc(editing.id)}</small></p><form id="access-user"><input type="hidden" name="userId" value="${esc(editing.id)}"><label>Situação do acesso<select name="access"><option value="pending" ${editing.role === "pending" ? "selected" : ""}>Aguardando aprovação</option><option value="active" ${editing.role === "operator" && editing.enabled !== false ? "selected" : ""}>Aprovar / manter operador ativo</option><option value="blocked" ${editing.role === "operator" && editing.enabled === false ? "selected" : ""}>Bloquear acesso</option></select></label><p class="muted">Mesmo aprovado, o operador precisa confirmar o e-mail. Nenhum operador pode promover usuários ou acessar seus relatórios.</p>${operatorPermissionSummary(editing)}${championshipOperationPicker(editing)}${operatorMatchPicker(editing)}
    <p class="public-notice" data-permission-preview aria-live="polite">As alterações abaixo entram em vigor ao salvar as permissões.</p>
    <fieldset><legend>Cadastros esportivos</legend><p class="muted">Conceda apenas os cadastros que este operador precisa administrar.</p><label class="confirmation-check"><input type="checkbox" name="rosterPermission" ${(editing.permissions||[]).includes("rosters")?"checked":""}><span>Equipes e jogadores: cadastrar, editar e importar dados, inclusive técnicos e elencos.</span></label><label class="confirmation-check"><input type="checkbox" name="championshipPermission" ${(editing.permissions||[]).includes("championships")?"checked":""}><span>Campeonatos e temporadas: cadastrar e editar competições.</span></label><label class="confirmation-check"><input type="checkbox" name="matchCreatePermission" ${(editing.permissions||[]).includes("matchesCreate")?"checked":""}><span>Partidas: cadastrar novos jogos. Isso não concede operação dos jogos.</span></label></fieldset><fieldset><legend>Acompanhar campeonatos</legend><p>Consulta dos jogos publicados. Para liberar gols, cartões e relógio, use Operar campeonato inteiro ou Operar partidas específicas.</p>${editionOptions}<label class="confirmation-check"><input type="checkbox" name="gamesViewPermission" ${(editing.permissions||[]).includes("gamesView")?"checked":""}><span>Consultar todos os jogos publicados — próximos, ao vivo e encerrados — sem alterar placares. Para operar, autorize o campeonato ou selecione partidas específicas acima.</span></label></fieldset><label>Motivo da alteração<textarea name="reason" required maxlength="500" placeholder="Ex.: responsável pelos jogos da quadra 1"></textarea></label><p><button class="primary">Salvar permissões</button> <button type="button" data-access-cancel>Fechar edição</button></p></form><hr><h3>Excluir acesso do operador</h3><p>Remove da lista ativa e revoga partidas, campeonatos e cadastros autorizados. A auditoria é preservada. O login do Firebase Authentication pode ser excluído pelo console do Firebase.</p><form id="remove-operator"><input type="hidden" name="userId" value="${esc(editing.id)}"><label>Motivo da exclusão<textarea name="reason" required minlength="5" maxlength="500"></textarea></label><label>Digite EXCLUIR para confirmar<input name="confirmation" required autocomplete="off"></label><p><button type="submit">Excluir acesso do operador</button></p></form></section>` : "";
  const registrationPermissions = (permissions) => [
    permissions.includes("rosters") && "Equipes e jogadores",
    permissions.includes("championships") && "Campeonatos",
    permissions.includes("matchesCreate") && "Novas partidas",
  ].filter(Boolean).join(", ") || "Nenhum";
  const permissionNames={rosters:"Equipes e jogadores",championships:"Campeonatos",matchesCreate:"Novas partidas",gamesView:"Acompanhar todos os jogos"};
  const accessAuditRows=(state.accessAudit||[]).slice().sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
  const accessAuditDate=value=>value?.toDate?.().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})||"Aguardando confirmação do servidor";
  const accessAuditValue=(key,value)=>{
    if(value==null)return "—";
    if(key==="role")return value==="operator"?"Operador":value==="pending"?"Aguardando aprovação":String(value);
    if(key==="enabled")return value?"Ativo":"Bloqueado / sem acesso";
    if(key==="matches")return (value||[]).map(id=>{const m=state.matches.find(item=>item.id===id);return m?`${name(m.home)} × ${name(m.away)} (${m.sport})`:id;}).join(", ")||"Nenhuma";
    if(key==="operatedChampionships")return (value||[]).map(id => {
      const c=state.championships.find(item=>item.id===id);
      return c ? championshipTitle(c)+" · "+c.sport+" · "+(c.category||"Sem categoria") : id;
    }).join(", ") || "Nenhum";
    if(key==="followedEditions")return value.join(", ") || "Nenhum";
    if(key==="permissions")return (value||[]).map(p=>permissionNames[p]||p).join(", ")||"Nenhuma";
    if(typeof value==="object")return JSON.stringify(value);
    return String(value);
  };
  const accessAuditReport=accessAuditRows.map(a=>{
    const before=a.before||{},after=a.after||{},keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!["createdAt","updatedAt","auditId","revision"].includes(k)&&JSON.stringify(before[k]??null)!==JSON.stringify(after[k]??null));
    const details=table(["Campo","Antes","Depois"],keys.map(k=>tr([k,accessAuditValue(k,before[k]),accessAuditValue(k,after[k])])));
    return `<details class="event" ${accessAuditExpanded?"open":""}><summary>${esc(accessAuditDate(a.at))} • ${esc(a.action||"Alteração")} • ${esc(after.name||before.name||a.target||"Usuário")}</summary><p>${esc(after.email||before.email||"E-mail não informado")}<br>Motivo: ${esc(a.reason||"Não informado")}<br>UID: ${esc(a.target||"—")}</p>${details}</details>`;
  }).join("")||empty("Nenhuma alteração de permissão registrada.");
  const accessLabel = (u) => u.enabled !== false && u.role === "operator" && (u.permissions||[]).includes("gamesView") ? "Sim" : "Não";
  return `<section class="card"><h2>Usuários e permissões</h2><p><strong>${esc(accountRole())}: ${esc(user?.email || "Wagner")}</strong><br>Sua conta é protegida. Esta tela não permite alterar, bloquear ou remover sua autoridade.</p><label>Link para solicitar acesso<input readonly value="${esc(link.href)}"></label><p><button type="button" data-access-copy>Copiar link de cadastro</button></p><p class="muted">Envie esse link ao novo operador. Para testar outra conta neste computador, use uma janela anônima.</p></section><section class="card"><h3>Solicitações e operadores</h3><div class="toolbar" role="group" aria-label="Situação dos operadores"><button type="button" data-operators-group="current" aria-pressed="${!showRemovedOperators}" class="${!showRemovedOperators ? "primary" : ""}">Atuais</button><button type="button" data-operators-group="removed" aria-pressed="${showRemovedOperators}" class="${showRemovedOperators ? "primary" : ""}">Excluídos</button></div><h4>${showRemovedOperators ? "Operadores excluídos" : "Solicitações e operadores atuais"}</h4>${table(["Pessoa", "Situação", "Métodos de entrada", "Partidas para operar", "Cadastros esportivos", "Acompanha jogos", "Ação"], users.map((u) => `<tr><td>${esc(u.name || "Operador cadastrado")}<br><small>${esc(u.email || u.id)}</small></td><td>${esc(label(u))}</td><td>${esc(methodLabel(u.id))}</td><td>${state.matches.filter(m => (u.matches || []).includes(m.id) || (m.championshipId && (u.operatedChampionships || []).includes(m.championshipId))).length}${u.operatedChampionships?.length ? " · por campeonato" : ""}</td><td>${esc(registrationPermissions(u.permissions||[]))}</td><td>${accessLabel(u)}</td><td><button type="button" data-access-edit="${esc(u.id)}" ${u.deleted ? "disabled" : ""}>Revisar permissões</button></td></tr>`))}${users.length ? "" : empty("Nenhuma solicitação recebida ainda.")}</section>${editor}<section id="accessAuditReport" class="card"><h3>Últimos 50 registros de permissões</h3><p class="muted">Abra um registro para ver seus detalhes, ou expanda todos para revisar e imprimir o histórico completo.</p><div class="toolbar noprint"><button type="button" data-access-audit-expand>Expandir todos</button><button type="button" data-access-audit-collapse>Recolher todos</button><button type="button" data-access-audit-print>Imprimir / salvar em PDF</button><button type="button" data-access-audit-json>Baixar registros (JSON)</button><button type="button" data-access-audit-excel>Baixar registros (Excel)</button></div><p class="muted">${accessAuditRows.length} de até 50 registros mais recentes.</p>${accessAuditReport}</section>`;
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
    if (f.id === "registration-details") {
      const digits = d.phone.replace(/[^0-9]/g, "");
      if (!d.name.trim() || !/^[+0-9() .-]+$/.test(d.phone) || digits.length < 10 || digits.length > 15)
        throw Error("Preencha o nome completo e um telefone com DDD válido.");
      registrationDraft = {name:d.name.trim(), email:d.email.trim(), phone:d.phone.trim()};
      registrationContact = registrationDraft;
      render();
      return;
    }
    if (["login", "register", "recover", "complete-access", "access-user", "remove-operator", "request-own-removal", "own-contact"].includes(f.id)) {
      await accessAction(async () => {
        if (f.id === "own-contact") {
          await cloud.updateOwnContact({name:d.name, phone:d.phone});
          toast("Dados atualizados e disponíveis para o administrador.");
          return;
        }
        if (f.id === "request-own-removal") {
          if (d.confirmation !== "EXCLUIR") throw Error("Digite EXCLUIR para confirmar.");
          await cloud.requestOwnRemoval(d.reason);
          toast("Solicitação enviada. O acesso foi suspenso.");
          return;
        }
        if (f.id === "remove-operator") {
      if (role !== "admin" || !cloud) throw Error("Ação exclusiva do administrador.");
      if (d.confirmation !== "EXCLUIR") throw Error("Digite EXCLUIR para confirmar.");
      await cloud.removeOperator(d.userId, d.reason);
      const removed = state.users?.find((item) => item.id === d.userId);
      if (removed) Object.assign(removed, {
        deleted: true, enabled: false, matches: [], permissions: [], followedEditions: [],
      });
      managedUserId = "";
      showRemovedOperators = true;
      render();
      toast("Acesso excluído. Operador disponível na aba Excluídos e permissões revogadas.");
      return;
    }
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
          await cloud.requestAccess(d.name, d.phone);
          await cloud.resendVerification();
          toast(user?.emailVerified ? "Solicitação registrada. Aguarde a aprovação do administrador principal." : "Solicitação registrada. Confira a confirmação enviada ao seu e-mail.");
        } else {
          await cloud.manageUser({userId:d.userId, access:d.access,
            matches: new FormData(f).getAll("assignedMatches"), followedEditions: new FormData(f).getAll("followedEditions"), operatedChampionships: new FormData(f).getAll("operatedChampionships"), permissions:[...(f.elements.rosterPermission.checked?["rosters"]:[]),...(f.elements.matchCreatePermission.checked?["matchesCreate"]:[]),...(f.elements.championshipPermission.checked?["championships"]:[]),...(f.elements.gamesViewPermission.checked?["gamesView"]:[])], reason:d.reason});
          managedUserId = "";
          toast("Permissões salvas e registradas no histórico.");
        }
      });
      return;
    }
    if (f.id === "team-player") {
      if (!canManageRosters()) throw Error("Conta sem acesso aos cadastros.");
      const t=state.teams.find(t=>t.id===selectedTeamId);
      if(!t||t.archived||section!=="teams"||teamProfileTab!=="roster"||!teamPlayerDraft) throw Error("Abra uma equipe ativa para alterar o elenco.");
      const id=teamPlayerDraft.id||"";
      if(id&&!state.players.some(p=>p.id===id&&p.team===t.id)) throw Error("Jogador indisponível nesta equipe. Reabra o cadastro.");
      const record={id,team:t.id,name:d.name.trim(),number:d.number.trim(),position:d.position.trim(),reserve:d.reserve==="true"};
      teamPlayerDraft=record;
      await dispatch({type:"player",data:record});
      teamPlayerDraft=null;teamHistoryLoaded=false;render();
      toast(id?"Jogador atualizado nesta equipe.":"Jogador adicionado nesta equipe.");
      return;
    }
    if (["team", "player", "match", "settings", "championship"].includes(f.id)) {
      if (f.id === "settings") {
        if (systemLogoBusy) throw Error("Aguarde a preparação do logo antes de salvar.");
        delete d.logoURL;
      }
      if (f.id === "team") {
        delete d.badgeURL;
        d.sports=new FormData(f).getAll("sports");
      }
      if (f.id === "player") d.reserve = d.reserve === "true";
      if (f.id === "match") d.date = new Date(d.date).toISOString();
      await dispatch({ type: f.id, data: d });
      if(f.id==="team"){teamFormVisible=false;teamEditorId="";selectedTeamId=d.id||"";teamProfileTab="data";render();}
      else if (f.id === "championship") { editedChampionshipId = ""; render(); }
      else if (!C.demo) f.reset();
    } else if (f.id === "championship-link") {
      await dispatch({type:"championshipLink", matchId:selected, championshipId:d.championshipId, reason:d.reason});
    } else if (f.id === "clock-config") {
      const durationMs = Number(d.durationMin) * 60000;
      const displayMs = (Number(d.displayMin) * 60 + Number(d.displaySec)) * 1000;
      if (d.clockMode === "down" && displayMs > durationMs)
        throw Error("O tempo restante precisa caber na duração da etapa.");
      await dispatch({
        type: "clock",
        matchId: selected,
        command: "ajustar",
        mode: d.clockMode,
        baseMs: d.clockMode === "down" ? durationMs - displayMs : displayMs,
        durationMs,
        reason: d.clockReason,
      });
    } else if (f.id === "added-time") {
      await dispatch({type:"addedTime", matchId:selected, minutes:Number(d.addedMinutes)});
    } else if (f.id === "public-notice") {
      await dispatch({ type: "notice", matchId: selected, notice: e.submitter?.value === "clear" ? "" : d.notice });
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
    if (b.dataset.operationPanel) {
      operationPanel = b.dataset.operationPanel;
      for (const button of document.querySelectorAll("[data-operation-panel]")) {
        const active = button.dataset.operationPanel === operationPanel;
        button.classList.toggle("primary", active);
        button.setAttribute("aria-pressed", String(active));
      }
      $("#mesa-tempo").hidden = operationPanel !== "tempo";
      $("#mesa-avisos").hidden = operationPanel !== "avisos";
      return;
    }
    if (b.dataset.addedMinutes) {
      $("#added-time").elements.addedMinutes.value = b.dataset.addedMinutes;
      return;
    }
    if (b.hasAttribute("data-live-jump")) {
      const matchId = b.dataset.liveJump;
      const match = state.matches.find((item) => item.id === matchId);
      if (!match || !["Ao vivo", "Pausada", "Suspensa"].includes(match.status))
        throw Error("A situação desta partida mudou. Atualize a lista antes de abrir.");
      if (role !== "admin" && !(trainingMode && role === "operator") && !cloud?.canOperate(matchId))
        throw Error("Sua conta não está autorizada a operar esta partida.");
      cloud?.stopHistory();
      selected = matchId;
      quickPlayers = ["", ""];
      section = "matches";
      render();
      requestAnimationFrame(() => document.getElementById("view")?.scrollIntoView({
        behavior: preferences.motion ? "auto" : "smooth",
        block: "start",
      }));
      if (!C.demo && role === "admin") await cloud.loadHistory([matchId], { live: true });
      return;
    }
    if (b.dataset.googleEntry) {
      if (!cloud || accessBusy) return;
      const registerIntent = b.dataset.googleEntry === "register";
      await accessAction(async () => {
        await cloud.enterGoogle({register:registerIntent, registration:registrationDraft});
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
      await sairParaApresentacao();
      return;
    }
    if (b.hasAttribute("data-remove-system-logo")) {
      systemLogoVersion++; systemLogoBusy = false; setSystemLogoDraft("");
      if ($("#systemLogoFile")) $("#systemLogoFile").value = "";
      toast("Logo removido da prévia. Clique em Salvar aparência para publicar."); return;
    }
    if (b.dataset.addChampionshipCategory) {
      const edition = (state.championships || []).find((c) => c.id === b.dataset.addChampionshipCategory);
      if (!edition || !canManageChampionships()) return;
      editedChampionshipId = "";
      render();
      const form = $("#championship");
      if (form) {
        form.elements.name.value = edition.name;
        form.elements.season.value = edition.season;
        form.scrollIntoView({behavior: "smooth"});
        form.elements.sport.focus({preventScroll: true});
      }
      return;
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
    if (b.dataset.gamesShortcut) {
      if (!admin || !["admin","operator"].includes(role)) return;
      const groups = {live:{group:"active",status:"Ao vivo"},scheduled:{group:"active",status:"Agendada"},finished:{group:"finished",status:""}};
      const filter = groups[b.dataset.gamesShortcut];
      if (!filter) return;
      cloud?.stopHistory();
      selected = "";
      section = "matches";
      listFilters.matches = {...listDefaults.matches,...filter};
      render();
      document.getElementById("view")?.scrollIntoView({block:"start"});
      return;
    }
    if (b.hasAttribute("data-registration-back")) {
      registrationDraft = null;
      render();
      return;
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
      await sairParaApresentacao();
      return;
    }
    if (b.hasAttribute("data-review-account-requests")) {
      if (role !== "admin") return;
      showRemovedOperators = false;
      managedUserId = "";
      section = "users";
      selected = "";
      render();
      document.getElementById("view")?.scrollIntoView({ block: "start" });
      return;
    }
    if (b.dataset.operatorsGroup) {
      showRemovedOperators = b.dataset.operatorsGroup === "removed";
      managedUserId = "";
      render();
      return;
    }
    if (b.dataset.accessEdit) { managedUserId = b.dataset.accessEdit; render(); return; }
    if (b.hasAttribute("data-access-cancel")) { managedUserId = ""; render(); return; }
    if (b.hasAttribute("data-access-copy")) {
      const url = new URL("painel.html?acesso=cadastro", location.href).href;
      try { await navigator.clipboard.writeText(url); toast("Link copiado."); }
      catch { toast("Selecione e copie o endereço exibido no campo Link para solicitar acesso."); }
      return;
    }
    if(b.hasAttribute("data-access-audit-print")){
      if(role!=="admin")throw Error("Histórico exclusivo do administrador principal.");
      const entries=[...document.querySelectorAll("#accessAuditReport details")];
      const previous=entries.map(item=>item.open);
      entries.forEach(item=>item.open=true);
      document.body.classList.add("access-audit-print");
      window.addEventListener("afterprint",()=>{
        document.body.classList.remove("access-audit-print");
        entries.forEach((item,index)=>item.open=previous[index]);
      },{once:true});
      window.print();return;
    }
    if(b.hasAttribute("data-access-audit-expand")||b.hasAttribute("data-access-audit-collapse")){
      accessAuditExpanded=b.hasAttribute("data-access-audit-expand");
      document.querySelectorAll("#accessAuditReport details").forEach(item=>item.open=accessAuditExpanded);
      return;
    }
    if(b.hasAttribute("data-access-audit-json")){
      if(role!=="admin")throw Error("Exportação exclusiva do administrador principal.");
      const rows=(state.accessAudit||[]).slice().sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
      download("historico-permissoes.json",JSON.stringify({formato:"arena-historico-permissoes-v1",geradoEm:new Date().toISOString(),registros:rows},(_key,value)=>value?.toDate?value.toDate().toISOString():value,2));return;
    }
    if(b.hasAttribute("data-access-audit-excel")){
      if(role!=="admin")throw Error("Exportação exclusiva do administrador principal.");
      sheetReady();
      const rows=(state.accessAudit||[]).slice().sort((a,b)=>(b.at?.toMillis?.()||0)-(a.at?.toMillis?.()||0));
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.map(a=>({
        Data:a.at?.toDate?.().toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})||"Aguardando confirmação do servidor",
        Ação:a.action||"",Usuário:a.after?.name||a.before?.name||"",Email:a.after?.email||a.before?.email||"",
        UID:a.target||"",Responsável:a.actor||"",Motivo:a.reason||"",...auditChunks("Antes",a.before),...auditChunks("Depois",a.after)
      }))),"Permissões");
      XLSX.writeFile(wb,"historico-permissoes.xlsx");return;
    }
    if (b.dataset.fastEvent || b.dataset.fastAdded || b.dataset.fastNotice) {
      if (!admin || section !== "matches" || !selected || !["admin","operator"].includes(role))
        throw Error("Abra uma partida autorizada para usar os atalhos.");
      const match = state.matches.find(item => item.id === selected);
      if (!match) throw Error("Partida não encontrada.");
      if (!C.demo && role !== "admin" && !cloud?.canOperate(match.id))
        throw Error("Sua conta não está autorizada a operar esta partida.");
      if (b.dataset.fastEvent) {
        const kind = b.dataset.fastEvent, side = Number(b.dataset.side);
        if (!["cartão amarelo","cartão vermelho","falta"].includes(kind) || ![0,1].includes(side))
          throw Error("Lance inválido.");
        const player = quickPlayers[side] || "";
        const athlete = match.roster.find(item => item.id === player);
        if (kind === "cartão vermelho" && !confirm("Registrar cartão vermelho para "+name([match.home,match.away][side])+
            (athlete ? " · "+athlete.name : " · sem atleta informado")+"?")) return;
        await dispatch({type:"event",matchId:selected,kind,side,value:0,player,text:"Lançamento rápido"});
      } else if (b.dataset.fastAdded) {
        const minutes = Number(b.dataset.fastAdded);
        if (![1,2,3].includes(minutes)) throw Error("Acréscimo inválido.");
        await dispatch({type:"addedTime",matchId:selected,minutes});
      } else {
        const notices = {arbitragem:"Aguardando decisão da arbitragem.",atendimento:"Atendimento em quadra.",retirar:""};
        if (!Object.hasOwn(notices,b.dataset.fastNotice)) throw Error("Aviso inválido.");
        await dispatch({type:"notice",matchId:selected,notice:notices[b.dataset.fastNotice]});
      }
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
    } else if(b.dataset.editTeam){openTeamEditor(b.dataset.editTeam);return;
    } else if (b.dataset.editPlayer) {
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
      if(section==="teams"){selectedTeamId="";teamFormVisible=false;teamEditorId="";}
      selected = "";
      pendingImport = null;
      render();
      if (["matchSheets","reports"].includes(section) && !C.demo) {
        toast("Carregando históricos para as súmulas…");
        await cloud.loadHistory(state.matches.map((m) => m.id));
      } else if (section === "matches" && !C.demo && role === "admin") {
        const monitored = state.matches
          .filter((m) => !["Agendada", "Adiada"].includes(m.status))
          .map((m) => m.id);
        if (monitored.length) {
          toast("Carregando lances das partidas…");
          await cloud.loadHistory(monitored);
        }
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
    } else if (b.hasAttribute("data-document-clear")) {
      documentFilters={championship:"",sport:"",status:"",query:"",from:"",to:""};reportFilter="";render();
    } else if (b.hasAttribute("data-report-pdf")) {
      if (!C.demo) {
        const filter = $("[name=reportMatch]").value;
        await cloud.loadHistory(
          documentMatches().map((m) => m.id),
        );
      }
      toast("Preparando súmula PDF…");
      const { downloadReportPDF } = await import("./report-pdf.js");
      const ms = documentMatches();
      await downloadReportPDF(
        ms.map((m) => ({
          title: m.competition || "Partida avulsa",
          organizationLogo: state.settings?.logo || "",
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
            format(e.at) +
              (e.gameMs != null ? "\nJogo " + prettyTime(e.gameMs) : ""),
            e.stage || "—",
            eventLabel(e, m),
            ([0, 1].includes(e.side) ? name([m.home, m.away][e.side]) : "") +
              (e.player
                ? "\n" + (m.roster.find((p) => p.id === e.player)?.name || "")
                : ""),
            eventDescription(e),
            responsibleLabel(e),
          ]),
          notes: m.notes,
        })),
      );
      toast("PDF gerado.");
    } else if (b.hasAttribute("data-report-print")||b.hasAttribute("data-sports-report-pdf")) {
      if (!C.demo) await cloud.loadHistory(documentMatches().map(m=>m.id));
      render();
      window.print();
    } else if (b.hasAttribute("data-match-json")||b.hasAttribute("data-sports-report-json")) {
      if (!C.demo) await cloud.loadHistory(documentMatches().map(m=>m.id));
      const matches=documentMatches();
      if(!matches.length)throw Error("Não há partidas para exportar nesta seleção.");
      download(b.hasAttribute("data-match-json")?"sumulas-esportivas.json":"relatorio-esportivo.json",JSON.stringify({
        formato:b.hasAttribute("data-match-json")?"arena-sumulas-v1":"arena-relatorio-esportivo-v1",
        geradoEm:new Date().toISOString(),partidas:matches
      },(_key,value)=>value?.toDate?value.toDate().toISOString():value,2));
    } else if (b.hasAttribute("data-report-excel")) {
      if (!C.demo) {
        const filter = $("[name=reportMatch]").value;
        await cloud.loadHistory(
          documentMatches().map((m) => m.id),
        );
      }
      exportExcel();
    } else if (b.hasAttribute("data-audit-view")) {
      if (role !== "admin" || C.demo)
        throw Error("O relatório oficial de alterações exige a conta de administrador conectada ao Firebase.");
      generalAuditBusy=true;render();
      try {
        generalAuditRows=await cloud.auditRows();
        generalAuditLoaded=true;
      } finally {
        generalAuditBusy=false;render();
      }
    } else if (b.hasAttribute("data-audit-pdf")||b.hasAttribute("data-audit-json")) {
      if(role!=="admin"||C.demo)throw Error("O relatório oficial exige a conta de administrador conectada ao Firebase.");
      if(!generalAuditLoaded){generalAuditBusy=true;render();try{generalAuditRows=await cloud.auditRows();generalAuditLoaded=true;}finally{generalAuditBusy=false;render();}}
      if(b.hasAttribute("data-audit-pdf"))window.print();
      else download("relatorio-geral-alteracoes.json",JSON.stringify({formato:"arena-auditoria-v1",geradoEm:new Date().toISOString(),alteracoes:filteredAuditRows()},(_key,value)=>value?.toDate?value.toDate().toISOString():value,2));
    } else if (b.hasAttribute("data-audit-excel")) {
      if (role !== "admin")
        throw Error("Exportação exclusiva do administrador principal.");
      if (C.demo)
        throw Error(
          "Auditoria oficial está disponível após conectar ao Firebase.",
        );
      sheetReady();
      toast("Consultando auditoria…");
      const rows = filteredAuditRows(await cloud.auditRows()),
        wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          rows.map((r) => ({
            ID: r.ID,
            Data: r.at?.toDate?.().toLocaleString("pt-BR") || "",
            Usuário: responsibleLabel(r),
            UID: r.actor,
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
      const byEntity=Object.entries(rows.reduce((counts,r)=>{
        const label={settings:"Configurações",teams:"Equipes",players:"Jogadores",matches:"Partidas",championships:"Campeonatos",users:"Acessos"}[r.entity]||r.entity||"Outros";
        counts[label]=(counts[label]||0)+1;return counts;
      },{})).map(([entidade,quantidade])=>({Entidade:entidade,Quantidade:quantidade}));
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([
        {Informação:"Gerado em",Valor:new Date().toLocaleString("pt-BR")},
        {Informação:"Total de alterações",Valor:rows.length},
        ...byEntity.map(r=>({Informação:`Alterações em ${r.Entidade}`,Valor:r.Quantidade}))
      ]),"Resumo");
      XLSX.writeFile(wb, "auditoria-esportiva.xlsx");
    } else if (b.hasAttribute("data-backup") && role === "admin")
      download("arena-copia.json", JSON.stringify(state, null, 2));
    else if (b.id === "logout") await sairParaApresentacao();
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
      render();
    }
    if (e.target.name === "audit-search") {
      generalAuditSearch=e.target.value;
      $("#generalAuditOutput").innerHTML=auditReportPreview();
    }
    if (e.target.name?.startsWith("document-")) {
      const key=e.target.name.slice(9);
      if (Object.hasOwn(documentFilters,key)) documentFilters[key]=e.target.value;
      reportFilter="";render();
    }
    if (e.target.name === "reportMatch") {
      reportFilter = e.target.value;
      $("#reportOutput").innerHTML = section==="matchSheets"
        ? documentMatches().map(reportMatch).join("")
        : sportsReportPreview();
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
window.addEventListener("offline", () => {if(!C.demo)setConnectionStatus("offline");});
window.addEventListener("online", () => {if(!C.demo)setConnectionStatus("aguardando confirmação do servidor");});

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
  if(el.matches("[data-access-edit]"))return "Permite ao administrador aprovar, bloquear, atribuir partidas e conceder permissões específicas de cadastro esportivo.";
  const key=el.dataset.section;
  const sections={cleanup:"Prévia, cópia e exclusão de partidas de teste. Exclusivo do administrador principal.",standings:"Classificação do futebol calculada pelos jogos encerrados ou homologados de cada campeonato.",overview:"Resumo dos jogos atuais e consulta das finalizadas.",championships:"Cadastro de campeonatos e temporadas. Acesso do administrador ou de operadores autorizados.",createMatch:"Cadastro de uma nova partida. Acesso do administrador ou de operadores autorizados.",teams:"Cadastro e edição de equipes, técnicos, categorias e escudos.",players:"Cadastro do elenco, número, posição e titular ou reserva.",matches:"Acompanhamento dos jogos; placar e lances só podem ser alterados em partidas atribuídas.",imports:"Importa equipes ou jogadores por planilha ou texto, com prévia antes de confirmar.",matchSheets:"Visualiza e exporta súmulas em PDF ou JSON. Exclusivo do administrador principal.",reports:"Visualiza resultados e exporta relatórios esportivos em PDF, Excel ou JSON.",auditReports:"Consulta todas as alterações administrativas e exporta em PDF, Excel ou JSON.",certificates:"Emite certificados e baixa a visualização em PDF ou seus dados em JSON.",settings:"Aparência pública do sistema: logo, título, cores e capa.",users:"Solicitações de acesso, aprovação, bloqueio, partidas atribuídas e permissões específicas.",account:"Identificação da conta conectada e formas de entrada vinculadas."};
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
    if(touchHelp&&!b.closest(".accessibility-bar")&&!b.closest("#arenaTutorial")&&!b.closest("#sessionIdentity")){e.preventDefault();e.stopImmediatePropagation();document.getElementById("touchHelpStatus").textContent=helpFor(b)||"Este controle não possui uma explicação adicional.";showContextHelp(b);}
  },true);
  themeQuery.addEventListener("change",()=>{if(preferences.theme==="auto")applyPreferences();});
}
setupAccessibility();

// 14 — Tour visual. Navega somente na interface; não envia comandos nem grava dados.
let tutorialIndex = 0, tutorialReturnFocus = null, tutorialContext = null;
function tutorialSteps() {
  const step=(title,body,target,area=null,game=false)=>({title,body,target,area,game});
  const common=[
    step("Sua identidade", "Confira a conta e o perfil no cabeçalho. O tour apenas explica: os controles destacados não são acionados. Use Próximo, Anterior ou o índice para explorar.", "#sessionIdentity, #systemBrand"),
  ];
  if (!admin) return [
    step("Painel público", "Acompanhe partidas sem entrar em uma conta. Os dados publicados são atualizados pela organização.", "#hero"),
    step("Modalidade", "Filtre os jogos pela modalidade. O filtro muda a consulta na tela, sem alterar resultados.", "#filter"),
    step("Atalhos e números", "Os indicadores abrem jogos ao vivo, agenda, resultados e equipes.", ".public-metrics"),
    step("Abas de acompanhamento", "Jogos atuais, Ao vivo, Agenda, Resultados, Equipes, Classificação e Diversão organizam o conteúdo público.", ".public-navigation"),
    step("Placar e situação", "O placar pertence às duas equipes mostradas. Ao vivo é a situação da partida; o relógio pode estar parado. Chegar a zero não encerra automaticamente o jogo.", ".match-card .score, #publicHubContent"),
    step("Tempo e acréscimos", "A organização publica os minutos e inicia a contagem separadamente. Tempo esgotado aguarda a decisão de encerramento.", ".match-card [data-clock], .match-card, #publicHubContent"),
    step("Lances anteriores", "Abra Ver lances anteriores para consultar os acontecimentos publicados. Recentes e Anteriores rolam a lista; Carregar lances mais antigos busca outro grupo. Motivos privados e responsáveis da auditoria não são divulgados.", "[data-timeline-toggle], .match-events, .match-card, #publicHubContent"),
    step("Compartilhar e QR code", "Compartilhe o endereço público. Os recursos disponíveis permitem copiar o link e baixar o QR code, inclusive com o logo.", "#publicTools, header"),
    step("Leitura e ajuda", "Tema, tamanho do texto, contraste e movimentos são preferências deste navegador. As setas laterais vão ao topo e ao fim da página.", ".accessibility-float, #arenaPageNavigation, header"),
  ];
  if (!C.demo && (!user || !role)) return [
    ...common,
    step("Entrar ou solicitar acesso", "Use e-mail e senha ou Google. Novo operador informa nome, e-mail e telefone e aguarda aprovação. Uma conta existente deve vincular Google por Minha conta.", "#login, #app"),
    step("Confirmação e aprovação", "Confirme o e-mail quando solicitado. O administrador aprova o acesso e libera partidas ou campeonatos; criar conta não concede operação automaticamente.", "#app"),
    step("Recuperação e segurança", "Use a recuperação de senha quando necessário. A demonstração com dados fictícios é aberta em outra aba, pelo Treinamento.", "#app"),
  ];
  const steps=[...common,
    step("Visão geral e atalhos", "Use os botões de navegação e os atalhos para encontrar as áreas. A busca de funções ajuda a localizar controles.", ".arena-toolbar, #view", "overview"),
    step("Meus atalhos e favoritos", "Escolha as funções no topo. Clique com o botão direito ou segure uma aba para fixar, favoritar e escolher a cor. As preferências são desta conta e deste navegador; as permissões continuam valendo.", ".personal-shortcuts, #view", "overview"),
    step("Localizar partidas", "Pesquise equipe, competição ou local e filtre por modalidade, situação e campeonato. Todas inclui os jogos encerrados.", "#view", "matches"),
    step("Placar da partida", "Confira equipes, modalidade, etapa e situação antes de operar. Se não houver partida acessível, o tour informa a ausência; use o Treinamento para praticar.", ".console-score .score, #view", "matches", true),
    step("Iniciar ou retomar", "O atalho inicia o jogo e o relógio conforme a situação atual. Retomar preserva o tempo acumulado. Não reinicie um período esgotado sem configurar a próxima decisão.", ".match-guide, #view", "matches", true),
    step("Gol ou ponto rápido", "Selecione o atleta quando desejar e use o valor da equipe correta. Basquete possui valores próprios. O lançamento real só fica disponível nas condições autorizadas.", ".quick-grid, #view", "matches", true),
    step("Cartões e faltas rápidos", "Amarelo, vermelho e falta usam a equipe e o atleta selecionados. Vermelho exige conferência. Outros acontecimentos ficam no formulário de lances.", ".quick-buttons, #view", "matches", true),
    step("Interrupção e etapa", "Pausar ou suspender para o relógio e publica o motivo indicado. Atualizar etapa não zera o tempo automaticamente. Encerrar é uma decisão separada.", "[data-status], #view", "matches", true),
    step("Acréscimos", "Defina os minutos e publique. O anúncio aparece no painel, mas a contagem começa em Iniciar acréscimos. Ao zerar, confira a decisão da arbitragem e encerre ou ajuste conforme necessário.", "#added-time, [name=addedMinutes], #view", "matches", true),
    step("Configuração do relógio", "Pare o relógio, escolha modo e duração, informe o tempo já decorrido e o motivo e salve. Os atalhos de duração apenas preenchem; confirme em Salvar ajuste.", "#clockSettings, #view", "matches", true),
    step("Avisos ao público", "Use a aba Avisos e os atalhos para comunicar decisões. A mensagem publicada é pública. Não escreva dados pessoais ou orientações internas nesse campo.", "[data-operation-panel], #view", "matches", true),
    step("Histórico público e auditoria", "Lances anteriores mostra a publicação esportiva. O administrador consulta também a auditoria privada e pode publicar lances antigos. A quantidade exibida é definida em Configurações.", "[data-timeline-toggle], #view", "matches", true),
  ];
  if (role==="admin" || canManageRosters()) steps.push(
    step("Equipes", "Cadastre nome, sigla, técnico e escudo. O perfil da equipe reúne elenco e informações. Arquivar preserva os vínculos; alterações atuais não reescrevem súmulas antigas.", "#view", "teams"),
    step("Jogadores", "Informe equipe, nome, camisa, posição e titular ou reserva. Confira o elenco antes de criar a partida, pois a súmula guarda a escalação daquele momento.", "#view", "players"),
    step("Importar com prévia", "Escolha equipes ou jogadores, carregue os dados e confira a prévia. Só a confirmação importa os registros. O tour nunca confirma importação.", "#view", "imports"));
  if (role==="admin" || canManageChampionships()) steps.push(step("Campeonatos e fichas", "Cadastre temporada, modalidade e categoria. Use as fichas de inscrição com camisa e posição. Encerrar um campeonato impede novas partidas vinculadas, sem encerrar os jogos existentes.", "#view", "championships"));
  if (role==="admin" || canCreateMatches()) steps.push(step("Cadastrar partida", "Vincule o campeonato, escolha equipes diferentes e informe data e local. O vínculo identifica a competição e ajuda a conceder operação por campeonato.", "#view", "createMatch"));
  if (role==="admin") steps.push(
    step("Anulação e correção", "Na auditoria privada da partida, Estornar exige justificativa e preserva o lançamento original. Partidas encerradas precisam de reabertura com motivo. O tour não estorna nem reabre.", "#view", "matches", true),
    step("Classificação", "Confira a classificação dos campeonatos de futebol disponíveis e a situação das partidas usadas no cálculo.", "#view", "standings"),
    step("Operadores e partidas", "Monitore os operadores e as partidas. Aprovação e atribuição são controles distintos; acompanhar um campeonato não equivale a operar.", "#view", "monitor"),
    step("Usuários e permissões", "Aprove, bloqueie e conceda operação por partida ou campeonato inteiro. A exclusão de acesso preserva auditoria e não apaga automaticamente o login do Firebase Authentication.", "#view", "users"),
    step("Súmulas", "Filtre campeonato, modalidade, situação, período e equipe. A súmula inclui elenco, lances, interrupções, acréscimos e responsáveis disponíveis. PDF, impressão e JSON usam a seleção.", "#view", "matchSheets"),
    step("Relatórios esportivos", "Use os mesmos filtros e exporte resultados e detalhes. O Excel separa os dados em abas. O histórico deve estar carregado antes de gerar o documento.", "#view", "reports"),
    step("Auditoria geral", "Consulte alterações e pesquise nome, UID, campeonato, equipe ou acontecimento. Antes e depois ajudam a conferir o que mudou. Esses detalhes são administrativos.", "#view", "auditReports"),
    step("Certificados", "Preencha participante, participação, evento e emissão. O código identifica a emissão, mas não representa validação pública online. O sistema não mantém um arquivo permanente das emissões.", "#view", "certificates"),
    step("Identidade e documentos", "Configure título, logo, cor, capa e limites de lances. Salvar aparência publica a mudança. Os logos e preferências da ficha de inscrição são locais a este navegador.", "#view", "settings"),
    step("Dados de teste", "Prepare os registros antigos, selecione os testes e confira os vínculos. Reservar os mantém no banco, exclusivos do administrador. Contas e senhas são preservadas. Restaurar reativa as permissões antigas dos registros.", "#view", "testData"),
    step("Credenciais de eventos", "Emita identificações por evento com pessoa, função e validade. Consulte, imprima e revogue os crachás. Eles não concedem permissões de login e não têm validação pública online.", "#view", "credentials"),
    step("Limpeza e lixeira", "A limpeza exige conferência e cópia. Partidas elegíveis podem ser recuperadas por 30 dias. A purga definitiva é separada e remove os detalhes; não use sem revisar.", "#view", "cleanup"));
  steps.push(step("Minha conta", "Confira os dados pessoais e os métodos de entrada. Vincule Google à conta existente, mantendo a identidade. Conflitos entre contas precisam ser tratados sem criar cadastros duplicados.", "#view", "account"),
    step("Treinamento e suporte", "Treinamento abre dados fictícios em outra aba. Pratique iniciar, lançar, pausar, publicar acréscimos e encerrar. Este tour não executou nenhuma dessas ações.", "#view", "documentation"));
  return steps;
}
let tutorialFrame=0, tutorialStep=null, tutorialOpenedDetails=[];
function tutorialTarget(selector) {
  for(const part of selector.split(",")){const el=$(part.trim());if(el && !el.closest("[hidden]") && el.getClientRects().length)return el;}
  return null;
}
function positionTutorial() {
  const dialog=$("#arenaTutorial");
  if(!dialog?.open || !tutorialStep)return;
  const panel=$("#arenaTourPanel"), svg=$("#arenaTourShade"), ring=$("#arenaTourRing");
  const w=window.innerWidth,h=window.innerHeight;
  svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
  const target=tutorialTarget(tutorialStep.target);
  const r=target?.getBoundingClientRect();
  const panelTop=panel.getBoundingClientRect().top-12;
  const x=r?Math.max(6,r.left-6):0,y=r?Math.max(6,r.top-6):0;
  const right=r?Math.min(w-6,r.right+6):0,bottom=r?Math.min(panelTop,r.bottom+6):0;
  const visible=r && right>x && bottom>y;
  $("#arenaTourMask").setAttribute("d",`M0 0H${w}V${h}H0Z`+(visible?` M${x} ${y}H${right}V${bottom}H${x}Z`:""));
  ring.hidden=!visible;
  if(visible)Object.assign(ring.style,{left:x+"px",top:y+"px",width:(right-x)+"px",height:(bottom-y)+"px"});
}
function drawTutorial() {
  for(const d of tutorialOpenedDetails)if(d.isConnected)d.open=false;
  tutorialOpenedDetails=[];
  const steps=tutorialSteps();tutorialIndex=Math.max(0,Math.min(tutorialIndex,steps.length-1));
  const step=steps[tutorialIndex];tutorialStep=step;
  if(step.area && admin){section=step.area;selected="";
    if(step.game)operationPanel=step.title==="Avisos ao público"?"avisos":"tempo";
    if(step.game){const match=state.matches.find(m=>m.status==="Ao vivo"&&(role==="admin"||C.demo||cloud?.canOperate(m.id)))||state.matches.find(m=>role==="admin"||C.demo||cloud?.canOperate(m.id));selected=match?.id||"";}
    render();
  }
  const target=tutorialTarget(step.target);
  if(target)for(let d=target.closest("details");d;d=d.parentElement?.closest("details")){if(!d.open){d.open=true;tutorialOpenedDetails.push(d);}}
  $("#arenaTutorialProgress").textContent=`Passo ${tutorialIndex+1} de ${steps.length}`;
  $("#arenaTutorialTitle").textContent=step.title;
  $("#arenaTutorialBody").textContent=step.body+(step.game&&!selected?" Nenhuma partida autorizada está disponível nesta sessão.":"");
  const index=$("#arenaTourIndex");index.innerHTML=steps.map((s,i)=>`<option value="${i}" ${i===tutorialIndex?"selected":""}>${i+1}. ${esc(s.title)}</option>`).join("");
  $("#arenaTutorialPrevious").disabled=tutorialIndex===0;
  $("#arenaTutorialNext").textContent=tutorialIndex===steps.length-1?"Concluir":"Próximo";
  if(target){const r=target.getBoundingClientRect(),available=Math.max(80,window.innerHeight-$("#arenaTourPanel").getBoundingClientRect().height-40);window.scrollTo({top:Math.max(0,window.scrollY+r.top-Math.max(16,(available-Math.min(r.height,available))/2)),behavior:"instant"});}
  cancelAnimationFrame(tutorialFrame);tutorialFrame=requestAnimationFrame(positionTutorial);
  $("#arenaTutorialTitle").focus({preventScroll:true});
}
function setupTutorial() {
  const bar=$(".accessibility-bar");if(!bar)return;
  const open=document.createElement("button");open.type="button";open.dataset.openTutorial="";open.textContent="Demonstração guiada das funções";bar.append(open);
  const dialog=document.createElement("dialog");dialog.id="arenaTutorial";dialog.className="arena-visual-tour noprint";
  dialog.setAttribute("aria-labelledby","arenaTutorialTitle");dialog.setAttribute("aria-describedby","arenaTutorialBody");
  dialog.innerHTML='<svg id="arenaTourShade" aria-hidden="true" preserveAspectRatio="none"><path id="arenaTourMask" fill-rule="evenodd"/></svg><div id="arenaTourRing" aria-hidden="true" hidden></div><section id="arenaTourPanel"><p id="arenaTutorialProgress" aria-live="polite"></p><h2 id="arenaTutorialTitle" tabindex="-1"></h2><p id="arenaTutorialBody"></p><label>Ir para uma função<select id="arenaTourIndex"></select></label><p class="muted">Demonstração explicativa. Nenhum botão do jogo é acionado.</p><div class="toolbar"><button type="button" id="arenaTutorialPrevious">Anterior</button><button type="button" id="arenaTutorialNext" class="primary">Próximo</button><button type="button" id="arenaTutorialClose">Fechar</button></div></section>';
  document.body.append(dialog);
  open.addEventListener("click",()=>{hideContextHelp();tutorialReturnFocus=document.body.classList.contains("has-account-menu")?$("#accountMenuToggle"):$("#publicTools > summary")||document.activeElement;tutorialContext={section,selected,operationPanel,scroll:window.scrollY,role};tutorialIndex=0;dialog.showModal();drawTutorial();});
  $("#arenaTutorialPrevious").addEventListener("click",()=>{tutorialIndex--;drawTutorial();});
  $("#arenaTutorialNext").addEventListener("click",()=>{if(tutorialIndex>=tutorialSteps().length-1)dialog.close();else{tutorialIndex++;drawTutorial();}});
  $("#arenaTourIndex").addEventListener("change",e=>{tutorialIndex=Number(e.target.value);drawTutorial();});
  $("#arenaTutorialClose").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{cancelAnimationFrame(tutorialFrame);tutorialStep=null;for(const d of tutorialOpenedDetails)if(d.isConnected)d.open=false;tutorialOpenedDetails=[];if(tutorialContext){section=tutorialContext.section;selected=tutorialContext.selected;operationPanel=tutorialContext.operationPanel;render();window.scrollTo({top:tutorialContext.scroll,behavior:"instant"});tutorialContext=null;}hideContextHelp();if(tutorialReturnFocus?.isConnected)tutorialReturnFocus.focus({preventScroll:true});});
  const reposition=()=>{cancelAnimationFrame(tutorialFrame);tutorialFrame=requestAnimationFrame(()=>{if(dialog.open && tutorialContext?.role!==role){dialog.close();return;}positionTutorial();});};
  window.addEventListener("resize",reposition,{passive:true});
  window.addEventListener("scroll",reposition,{passive:true});
  new MutationObserver(reposition).observe(app,{childList:true,subtree:true});
}
setupTutorial();

// 15 — TREINAMENTO ISOLADO. O parâmetro só ativa dados locais fictícios.
// Não altera window.CONFIG e não abre conexão com Firebase neste modo.
function trainingSeed() {
  let s = D.fresh();
  s = D.reduce(s,{type:"settings",data:{title:"Arena — Treinamento",subtitle:"Dados fictícios para aprender sem alterar o evento real.",color:"#15c3ed",banner:"",logo:""}});
  for(const [name,short,coach] of [["Treino Azul","AZL","Técnico fictício Azul"],["Treino Verde","VER","Técnico fictício Verde"]]) s=D.reduce(s,{type:"team",data:{name,short,coach,category:"Demonstração",badge:""}});
  for(const t of s.teams) for(let i=1;i<=2;i++) s=D.reduce(s,{type:"player",data:{name:`Atleta fictício ${t.short} ${i}`,team:t.id,number:String(i+6),position:"Treinamento",reserve:i===2}});
  for(const sport of ["Futebol","Basquete"]){
    s=D.reduce(s,{type:"championship",data:{name:`Copa Treino ${sport}`,season:"Demonstração",sport,category:"Treinamento",status:"Planejado"}});
    s=D.reduce(s,{type:"match",data:{sport,championshipId:s.championships.at(-1).id,home:s.teams[0].id,away:s.teams[1].id,date:new Date().toISOString(),place:"Local fictício de treinamento",referees:"Arbitragem fictícia",stage:"1"}});
    const m=s.matches.at(-1);m.score=[0,0];m.clock=M.emptyClock();m.publicNotice="";m.rosterTeams=Object.fromEntries(m.roster.map(p=>[p.id,p.team]));
  }
  return s;
}
function trainingStore(value) {
  try { localStorage.setItem(key,JSON.stringify(value)); }
  catch { throw Error("O navegador não permitiu salvar o treino local. Nenhum dado real foi alterado."); }
}
function setupTraining() {
  const bar=document.querySelector(".accessibility-bar");if(!bar)return;
  if(!trainingMode){
    const link=document.createElement("a");link.className="button";link.style.margin="8px 0 0 8px";
    const url=new URL("painel.html",location.href);url.search="?demonstracao=1";
    link.href=url.href;link.target="_blank";link.rel="noopener";link.dataset.trainingEntry="";link.textContent="Treinamento — dados fictícios";bar.append(link);return;
  }
  const banner=document.createElement("section");banner.className="card noprint";banner.style.cssText="margin:16px 5%;border:3px solid #ba891a";
  banner.innerHTML='<h2>Demonstração — somente dados fictícios</h2><p>Este treino funciona apenas neste navegador, sem conexão com o Firebase. Sua conta e os resultados reais permanecem na outra aba.</p><div class="toolbar"><label>Simular perfil<select id="trainingRole"><option value="admin">Administrador</option><option value="operator">Operador</option><option value="operator-rosters">Operador com cadastros</option><option value="operator-matches">Operador que cria partidas</option><option value="operator-championships">Operador que gerencia campeonatos</option><option value="operator-games-view">Operador que acompanha jogos</option></select></label><button type="button" id="trainingReset">Reiniciar apenas o treino</button><a class="button" id="trainingCentral">Voltar à central real</a><a class="button" id="trainingPublic" target="_blank" rel="noopener">Ver painel público do treino</a></div><p class="muted">Para começar, abra Partidas → Operar partida → Iniciar jogo. Cadastros e lançamentos daqui não são publicados no evento real. As permissões simuladas são apenas uma orientação; não representam contas reais.</p>';
  bar.after(banner);
  const central=new URL("painel.html",location.href);central.search="";document.getElementById("trainingCentral").href=central.href;
  const pub=new URL("index.html",location.href);pub.search="?demonstracao=1";document.getElementById("trainingPublic").href=pub.href;
  for(const link of document.querySelectorAll("header a")) {const url=new URL(link.href,location.href);if(url.origin===location.origin){url.search="?demonstracao=1";link.href=url.href;}}
  document.getElementById("trainingRole").addEventListener("change",e=>{role=e.target.value==="admin"?"admin":"operator";operatorPermissions=e.target.value==="operator-rosters"?["rosters"]:e.target.value==="operator-matches"?["matchesCreate"]:e.target.value==="operator-championships"?["championships"]:e.target.value==="operator-games-view"?["gamesView"]:[];section="overview";selected="";render();toast("Perfil simulado: "+(role==="admin"?"administrador":"operador")+". Dados apenas de treinamento.");});
  document.getElementById("trainingReset").addEventListener("click",()=>{
    if(!confirm("Reiniciar somente os dados fictícios deste treino? Os dados reais não serão alterados."))return;
    try{const seed=trainingSeed();trainingStore(seed);state=seed;selected="";section="overview";pendingImport=null;quickPlayers=["",""];render();toast("Treino reiniciado com dados fictícios.");}catch(e){toast(e.message,true);}
  });
}
setupTraining();

// 16 — CLASSIFICAÇÃO DO FUTEBOL. Calculada sem novas gravações no Firebase.
// Critérios desta versão: pontos, vitórias, saldo de gols e gols pró.
let standingChampionship = "";
function footballTable(matches) {
  const teams = new Map();
  const ensure=id=>{if(!teams.has(id))teams.set(id,{id,points:0,played:0,wins:0,draws:0,losses:0,gf:0,ga:0,gd:0});return teams.get(id);};
  let counted=0,invalid=0;
  for(const m of matches){
    if(m.sport!=="Futebol"||m.status==="Cancelada"||!m.home||!m.away||m.home===m.away)continue;
    const home=ensure(m.home),away=ensure(m.away);
    if(!["Encerrada","Homologada"].includes(m.status))continue;
    const score=D.score(m);
    if(score.length!==2||!score.every(n=>Number.isInteger(n)&&n>=0)){invalid++;continue;}
    counted++;
    for(const [t,gf,ga] of [[home,score[0],score[1]],[away,score[1],score[0]]]){
      t.played++;t.gf+=gf;t.ga+=ga;t.gd=t.gf-t.ga;
      if(gf>ga){t.wins++;t.points+=3;}else if(gf===ga){t.draws++;t.points++;}else t.losses++;
    }
  }
  const comparison=(a,b)=>b.points-a.points||b.wins-a.wins||b.gd-a.gd||b.gf-a.gf;
  const rows=[...teams.values()].sort((a,b)=>comparison(a,b)||name(a.id).localeCompare(name(b.id),"pt-BR"));
  rows.forEach((r,i)=>{r.position=i&&comparison(r,rows[i-1])===0?rows[i-1].position:i+1;r.tied=rows.some(other=>other!==r&&comparison(r,other)===0);});
  return {rows,counted,invalid};
}
function standingChampionships(){
  const choices=new Map();
  if(role==="admin") for(const c of state.championships||[])if(c.sport==="Futebol")choices.set(c.id,championshipTitle(c)+(c.category?" • "+c.category:""));
  // Público usa somente identificadores e resultados já publicados.
  for(const m of state.matches)if(m.sport==="Futebol"&&m.championshipId&&!choices.has(m.championshipId))choices.set(m.championshipId,m.competition||"Campeonato de futebol");
  return [...choices].sort((a,b)=>a[1].localeCompare(b[1],"pt-BR"));
}
function selectedStanding(){
  const choices=standingChampionships();
  if(!choices.some(([id])=>id===standingChampionship))standingChampionship=choices[0]?.[0]||"";
  return footballTable(standingChampionship?state.matches.filter(m=>m.championshipId===standingChampionship):[]);
}
function standingOutput(){
  const {rows,counted,invalid}=selectedStanding();
  return `<p class="muted" role="status">${counted} partida(s) computada(s). ${rows.length} equipe(s) identificada(s) nas partidas não canceladas deste campeonato.</p>${invalid?'<p class="public-notice">Há resultado inválido fora do cálculo. O administrador deve conferir os registros.</p>':""}${rows.length?table(["Posição","Equipe","Pontos","Jogos","Vitórias","Empates","Derrotas","Gols pró","Gols contra","Saldo"],rows.map(r=>tr([r.position+"º"+(r.tied?" (empate)":""),name(r.id),r.points,r.played,r.wins,r.draws,r.losses,r.gf,r.ga,r.gd]))):empty("Ainda não há equipes em partidas deste campeonato. Programe uma partida e vincule ao campeonato de futebol.")}`;
}
function standingsPanel(){
  const choices=standingChampionships();
  if(!admin&&!choices.length)return "";
  selectedStanding();
  return `<section class="card"><h2>Classificação — Futebol</h2><p>Vitória: 3 pontos • Empate: 1 ponto • Derrota: 0 ponto.</p><label>Campeonato de futebol<select id="standingChampionship" ${!choices.length?"disabled":""}>${choices.map(([id,title])=>`<option value="${esc(id)}" ${id===standingChampionship?"selected":""}>${esc(title)}</option>`).join("")||'<option>Nenhum campeonato de futebol disponível</option>'}</select></label><p class="muted">Contam somente partidas Encerradas ou Homologadas. Partidas canceladas, ao vivo, pausadas, suspensas, adiadas ou agendadas não somam resultados. A reabertura retira o jogo do cálculo até ser encerrado novamente.</p><div id="standingOutput">${standingOutput()}</div><p class="muted">Desempate: pontos, vitórias, saldo de gols e gols pró. Se todos forem iguais, a posição é compartilhada; a ordem alfabética serve apenas para exibir as equipes. Não há confronto direto, punições, W.O., pênaltis ou grupos automáticos nesta versão.</p>${admin&&role==="admin"&&choices.length?'<button type="button" data-standing-excel>Exportar classificação em Excel</button>':""}</section>`;
}
document.addEventListener("change",e=>{if(e.target.id!=="standingChampionship")return;standingChampionship=e.target.value;$("#standingOutput").innerHTML=standingOutput();});
document.addEventListener("click",e=>{
  if(!e.target.closest("[data-standing-excel]"))return;
  try{
    if(role!=="admin")throw Error("Exportação exclusiva do administrador.");sheetReady();
    const {rows,counted}=selectedStanding();const title=standingChampionships().find(([id])=>id===standingChampionship)?.[1]||"Futebol";
    const data=rows.map(r=>({Posição:r.position,Equipe:name(r.id),Pontos:r.points,Jogos:r.played,Vitórias:r.wins,Empates:r.draws,Derrotas:r.losses,"Gols pró":r.gf,"Gols contra":r.ga,Saldo:r.gd,"Empate técnico":r.tied?"Sim":"Não"}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),"Classificação");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Campeonato",title],["Partidas computadas",counted],["Pontuação","Vitória 3; empate 1; derrota 0"],["Situações","Encerrada e Homologada"],["Desempate","Pontos, vitórias, saldo e gols pró. Igualdade mantém empate técnico."],["Gerado em",new Date().toLocaleString("pt-BR")]]),"Critérios");
    XLSX.writeFile(wb,"classificacao-futebol.xlsx");
  }catch(error){toast(error.message,true);}
});

// 17 — Limpeza de partidas de teste: prévia, cópia e confirmação explícita.
let cleanupPlan=null,cleanupBusy=false,cleanupCopied=false;
function cleanupPanel(){
 const eligible=state.matches.filter(m=>!m.championshipId&&!["Ao vivo","Pausada","Suspensa"].includes(m.status)&&!m.clock?.running);
 const p=cleanupPlan,m=p?.before;
 return `<section class="card"><h2>Lixeira e retenção de partidas</h2><p><strong>Partidas vinculadas a campeonatos são preservadas na limpeza de testes.</strong> Partidas avulsas elegíveis podem ser movidas para a lixeira e recuperadas por 30 dias. O placar público é removido durante esse período. A purga definitiva após o prazo apaga a partida e os detalhes da súmula/auditoria, mantendo somente um registro resumido da remoção.</p><p><strong>Partidas ao vivo, pausadas, suspensas ou com relógio rodando não podem ser removidas.</strong> Antes de mover, baixe e confira uma cópia local.</p><label>Partida para conferir<select id="cleanupMatch">${eligible.map(m=>`<option value="${esc(m.id)}" ${p?.matchId===m.id?"selected":""}>${esc(name(m.home)+" × "+name(m.away)+" • "+m.sport+" • "+format(m.date)+" • "+m.status)}</option>`).join("")||'<option value="">Nenhuma partida disponível</option>'}</select></label><button type="button" data-cleanup-preview ${cleanupBusy||!eligible.length?"disabled":""}>Conferir partida antes de mover</button>${m?`<div class="public-notice"><h3>Prévia da lixeira</h3><p>${esc(name(m.home))} × ${esc(name(m.away))}<br>${esc(m.sport)} • ${esc(format(m.date))} • ${esc(m.status)}<br>${esc(m.competition||"Sem campeonato")}<br>Placar: ${esc(D.score(m).join(" × "))}<br>ID: ${esc(m.id)}</p><p>O jogo poderá ser recuperado por 30 dias. Depois desse prazo, a purga definitiva exige uma ação separada e não pode ser desfeita.</p><button type="button" data-cleanup-copy ${cleanupBusy?"disabled":""}>Baixar cópia desta partida</button><form id="cleanupConfirm"><label>Motivo para mover à lixeira<textarea name="cleanupReason" minlength="5" maxlength="500" required></textarea></label><label>Digite LIXEIRA para confirmar<input name="cleanupWord" autocomplete="off" required></label><label class="confirmation-check"><input type="checkbox" name="cleanupSaved" required><span>Baixei e conferi a cópia desta partida.</span></label><button type="submit" ${cleanupBusy||!cleanupCopied?"disabled":""}>Mover para a lixeira por 30 dias</button></form><button type="button" data-cleanup-cancel ${cleanupBusy?"disabled":""}>Cancelar prévia</button></div>`:""}<hr>${removedHistoryPanel()}<hr><button type="button" data-cleanup-history>Baixar histórico resumido (JSON)</button><p class="muted">A lixeira preserva uma cópia até o vencimento. A purga libera armazenamento, mas remove os detalhes completos da auditoria daquela partida.</p></section>`;
}
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-cleanup-preview],[data-cleanup-copy],[data-cleanup-cancel],[data-cleanup-history]");
 if(!b||cleanupBusy)return;
 try{
  if(role!=="admin")throw Error("Limpeza exclusiva do administrador principal.");
  if(b.hasAttribute("data-cleanup-cancel")){cleanupPlan=null;cleanupCopied=false;render();return;}
  if(b.hasAttribute("data-cleanup-copy")){
   if(!cleanupPlan)throw Error("Gere uma prévia primeiro.");
   download("arena-copia-partida-"+cleanupPlan.matchId+".json",JSON.stringify(cleanupPlan.backup,null,2));
   cleanupCopied=true;render();toast("Confira o arquivo baixado antes de confirmar a exclusão.");return;
  }
  if(b.hasAttribute("data-cleanup-history")){
   const logs=C.demo?(state.cleanupAudit||[]):await cloud.cleanupHistory();
   download("arena-historico-exclusoes.json",JSON.stringify(logs,null,2));return;
  }
  const id=$("#cleanupMatch").value;if(!id)throw Error("Escolha uma partida.");
  cleanupBusy=true;cleanupPlan=null;cleanupCopied=false;
  if(C.demo){
   const m=state.matches.find(m=>m.id===id);if(!m)throw Error("Partida indisponível.");
   if(["Ao vivo","Pausada","Suspensa"].includes(m.status)||m.clock?.running)throw Error("Encerre ou cancele antes de limpar.");
   const before=JSON.parse(JSON.stringify(m));cleanupPlan={matchId:id,before,createdAt:Date.now(),backup:{format:"arena-demonstracao-partida-v1",match:before}};
  }else cleanupPlan=await cloud.previewCleanup(id);
 }catch(error){toast(error.message,true);}finally{cleanupBusy=false;render();}
});
document.addEventListener("submit",async e=>{
 if(e.target.id!=="cleanupConfirm")return;e.preventDefault();if(cleanupBusy)return;
 try{
  if(role!=="admin"||!cleanupPlan||!cleanupCopied)throw Error("Gere uma prévia e confira a cópia antes de excluir.");
  const f=e.target,reason=f.elements.cleanupReason.value.trim(),word=f.elements.cleanupWord.value;
  if(!f.elements.cleanupSaved.checked||word!=="LIXEIRA"||reason.length<5||reason.length>500)throw Error("Confira a cópia, preencha o motivo e digite LIXEIRA exatamente.");
  cleanupBusy=true;const plan=cleanupPlan;
  if(C.demo){
   const m=state.matches.find(m=>m.id===plan.matchId);
   if(!m||JSON.stringify(m)!==JSON.stringify(plan.before)||Date.now()-plan.createdAt>600000)throw Error("A partida mudou ou a prévia expirou. Gere uma nova prévia.");
  state.cleanupAudit=state.cleanupAudit||[];state.cleanupAudit.push({target:m.id,entity:"matches",reason,before:m,after:null,at:new Date().toISOString(),actor:"demonstração",state:"lixeira",expiresAt:new Date(Date.now()+30*24*60*60*1000),home:m.home,away:m.away,sport:m.sport,competition:m.competition||"",status:m.status,score:m.score});
   state.matches=state.matches.filter(x=>x.id!==m.id);
   if(trainingMode)trainingStore(state);else localStorage.setItem(key,JSON.stringify(state));
   render();
  }else await cloud.deleteTestMatch(plan,reason,word);
  removedRequest++;removedHistory=[];removedLoaded=false;removedLoading=false;removedError="";
  cleanupPlan=null;cleanupCopied=false;selected="";toast("Partida movida para a lixeira. Recuperação disponível por 30 dias.");
 }catch(error){toast(error.message,true);}finally{cleanupBusy=false;render();}
});

// 18 — Mostrar/ocultar senha. Só muda a exibição do campo nesta tela.
function passwordEye(visible) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${visible?'<path d="m3 3 18 18"/>':""}</svg>`;
}
document.addEventListener("click", e => {
  const button=e.target.closest("[data-toggle-password]");
  if(!button||button.disabled)return;
  const input=document.getElementById(button.getAttribute("aria-controls"));
  if(!input?.hasAttribute("data-private-password"))return;
  const visible=input.type==="password";
  input.type=visible?"text":"password";
  button.setAttribute("aria-pressed",String(visible));
  const label=document.querySelector(`label[for="${input.id}"]`)?.textContent||"senha";
  button.setAttribute("aria-label",(visible?"Ocultar ":"Mostrar ")+label.toLowerCase());
  button.innerHTML=passwordEye(visible)+`<span>${visible?"Ocultar":"Mostrar"}</span>`;
});

// 19 — Histórico de exclusões na tela. Consulta somente; não restaura ou exclui registros.
let removedHistory=[],removedLoaded=false,removedLoading=false,removedQuery="",removedSport="",removedContext="",removedRequest=0,removedError="";
function removedContextKey(){return (C.demo?key:(user?.uid||"anônimo"))+":"+role;}
function resetRemovedContext(){
 const next=removedContextKey();if(next===removedContext)return;
 removedContext=next;removedRequest++;removedHistory=[];removedLoaded=false;removedLoading=false;removedQuery="";removedSport="";removedError="";
}
function removedTime(value){
 if(value?.toMillis)return value.toMillis();
 if(value&&typeof value==="object"&&Number.isFinite(value.seconds??value._seconds))return (value.seconds??value._seconds)*1000;
 const n=Date.parse(value);return Number.isFinite(n)?n:0;
}
function removedDate(value){const n=removedTime(value);return n?new Date(n).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"Data não informada";}
function removedTeam(id){return state.teams.find(t=>t.id===id)?.name||id||"Equipe não informada";}
function removedRows(){
 const logs=C.demo?(state.cleanupAudit||[]):removedHistory;
 const q=searchText(removedQuery);
 return logs.filter(r=>{
  const m=r.before||r;
  return (!removedSport||m.sport===removedSport)&&(!q||searchText([removedTeam(m.home),removedTeam(m.away),m.competition,m.sport,r.reason,r.target,r.actor,removedDate(r.at)].join(" ")).includes(q));
 }).slice().sort((a,b)=>removedTime(b.at)-removedTime(a.at));
}
function removedResults(){
 if(role!=="admin")return "";
 if(removedLoading)return '<p role="status">Consultando histórico…</p>';
 if(removedError)return `<p role="alert">${esc(removedError)} Use Atualizar histórico para tentar novamente.</p>`;
 if(!removedLoaded)return '<p class="muted">Clique em Ver partidas excluídas para consultar o histórico privado.</p>';
 const rows=removedRows(),now=Date.now();
 return `<p role="status">${rows.length} registro(s) nesta visualização. Jogos na lixeira podem ser recuperados por 30 dias. ${C.demo?"Dados locais da demonstração.":"Dados da última consulta; use Atualizar lixeira para buscar alterações."}</p>${rows.length?`<div class="trash-list">${rows.map(r=>{
  const m=r.before||r,score=Array.isArray(m.score)?m.score.join(" × "):"—",expires=removedTime(r.expiresAt),legacy=!r.state,state=r.state||(r.before?"antiga":"purgado");
  const labels={lixeira:"Na lixeira",restaurada:"Recuperada",purgando:"Purga pendente",purgado:"Purgada definitivamente",antiga:"Registro antigo"};
  const canRestore=state==="lixeira"&&expires>now&&!!r.before;
  const canPurge=(state==="lixeira"&&!!r.before&&!r.before.championshipId&&expires>0&&expires<=now)||state==="purgando";
  const actions=`${canRestore?`<button type="button" data-trash-restore="${esc(r.target)}">Recuperar</button>`:""}${canPurge?`<button type="button" class="danger-button" data-trash-purge="${esc(r.target)}">${state==="purgando"?"Retomar purga":"Purgar definitivamente"}</button>`:""}`;
  const expiry=state==="lixeira"?(expires>now?`Recuperável até ${esc(removedDate(r.expiresAt))}`:(r.before?.championshipId?"Prazo vencido; histórico da partida preservado":"Prazo vencido; aguardando purga manual")):state==="purgando"?"Purga iniciada; pode ser retomada":"";
  return `<article class="trash-record"><div class="trash-record-heading"><div><strong>${esc(removedTeam(m.home))} × ${esc(removedTeam(m.away))}</strong><small>${esc(m.sport||"—")} • ${esc(m.competition||"Sem campeonato")} • ${esc(score)}</small></div><span class="trash-state trash-state-${esc(state)}">${esc(labels[state]||state)}</span></div><p>Removida em ${esc(removedDate(r.at))}${expiry?` • ${expiry}`:""}</p><p>Motivo: ${esc(r.reason||"Não informado")}${r.purgeReason?`<br>Motivo da purga: ${esc(r.purgeReason)}`:""}</p>${legacy?'<small>Exclusão anterior à lixeira recuperável; este registro não tem prazo de restauração.</small>':""}<div class="trash-record-actions">${actions||"<small>Sem ações disponíveis.</small>"}</div><small>Responsável: ${esc(r.actor==="demonstração"?"Demonstração":r.actor===user?.uid?"Administrador principal":r.actor||"Não informado")}</small></article>`;
 }).join("")}</div>`:empty(removedQuery||removedSport?"Nenhuma exclusão corresponde aos filtros.":"Nenhuma partida na lixeira.")}`;
}
function removedHistoryPanel(){
 resetRemovedContext();
 return `<section aria-labelledby="removedHistoryHeading"><h3 id="removedHistoryHeading">Lixeira e histórico de remoções</h3><p>Consulta exclusiva do administrador principal. Recupere jogos dentro de 30 dias. Depois do prazo, purgue manualmente para liberar o snapshot e os detalhes da auditoria; fica apenas o registro resumido da remoção.</p><button type="button" data-removed-load ${removedLoading?"disabled":""}>${removedLoaded||removedError?"Atualizar lixeira":"Ver lixeira"}</button><div class="formgrid"><label>Buscar no histórico<input type="search" data-removed-query value="${esc(removedQuery)}" placeholder="Equipe, campeonato, motivo, data ou identificador"></label><label>Modalidade no histórico<select data-removed-sport><option value="">Todas as modalidades</option>${["Futebol","Futsal","Basquete","Vôlei","Vôlei de praia","Handebol"].map(s=>`<option value="${esc(s)}" ${s===removedSport?"selected":""}>${esc(s)}</option>`).join("")}</select></label></div><div id="removedResults">${removedResults()}</div></section>`;
}
let trashActionBusy=false;
document.addEventListener("click",async e=>{
 const restore=e.target.closest("[data-trash-restore]"),purge=e.target.closest("[data-trash-purge]");
 if((!restore&&!purge)||trashActionBusy)return;
 if(role!=="admin")return;
 const button=restore||purge,id=button.dataset.trashRestore||button.dataset.trashPurge;
 try{
  const item=removedRows().find(row=>row.target===id);
  if(!item)throw Error("Registro não encontrado. Atualize a lixeira.");
  if(restore){
   if(!confirm("Recuperar esta partida? Ela voltará aos painéis com o placar e a súmula preservados."))return;
   const reason=prompt("Justificativa para recuperar a partida (5 a 500 caracteres):");if(reason===null)return;
   if(C.demo){
    if(item.state!=="lixeira"||removedTime(item.expiresAt)<=Date.now()||!item.before)throw Error("Prazo de recuperação encerrado ou partida indisponível.");
    const restored={...item.before,_revision:(item.before._revision||0)+1,_updatedBy:"demonstração"};
    state.matches.push(restored);item.before=null;item.after=null;item.state="restaurada";item.restoredBy="demonstração";item.restoredAt=new Date().toISOString();
    state.demoAudit=state.demoAudit||[];state.demoAudit.push({target:id,entity:"matches",actor:"demonstração",at:new Date().toISOString(),detail:{type:"recuperação",reason},before:null,after:restored});trainingMode?trainingStore(state):localStorage.setItem(key,JSON.stringify(state));
   }else await cloud.restoreDeletedMatch(id,reason);
   toast("Partida recuperada e publicada novamente.");
  }else{
   if(C.demo)throw Error("A purga definitiva não está disponível na demonstração.");
   if(!confirm("Esta ação é irreversível. A partida e os detalhes completos da auditoria serão apagados; ficará apenas o registro resumido da remoção. Continuar?"))return;
   const reason=prompt("Justificativa da purga definitiva (5 a 500 caracteres):",item.purgeReason||"");if(reason===null)return;
   await cloud.purgeDeletedMatch(id,reason);
   toast("Purga concluída. A partida não pode mais ser recuperada.");
  }
  removedLoaded=false;removedHistory=[];removedError="";refresh();
  if(!C.demo){const rows=await cloud.cleanupHistory();removedHistory=rows;removedLoaded=true;refresh();}
 }catch(error){toast(error.message,true);}
 finally{trashActionBusy=false;}
});
document.addEventListener("click",async e=>{
 if(!e.target.closest("[data-removed-load]")||removedLoading||role!=="admin")return;
 resetRemovedContext();const context=removedContextKey(),request=++removedRequest;
 removedLoading=true;removedError="";refresh();
 try{
  const rows=C.demo?(state.cleanupAudit||[]):await cloud.cleanupHistory();
  if(request!==removedRequest||context!==removedContextKey()||role!=="admin")return;
  removedHistory=rows;removedLoaded=true;
 }catch(error){if(request===removedRequest){removedLoaded=false;removedError="Não foi possível consultar o histórico. Confira a conexão e seu acesso de administrador.";}}
 finally{if(request===removedRequest){removedLoading=false;refresh();}}
});
document.addEventListener("input",e=>{if(!e.target.hasAttribute("data-removed-query")||role!=="admin")return;removedQuery=e.target.value;const out=$("#removedResults");if(out)out.innerHTML=removedResults();});
document.addEventListener("change",e=>{if(!e.target.hasAttribute("data-removed-sport")||role!=="admin")return;removedSport=e.target.value;const out=$("#removedResults");if(out)out.innerHTML=removedResults();});

// 20 — Menu da conta e preferências. Apenas navegação; conserva autenticação/permissões.
function accountMenuMarkup(){
 const label=C.demo?"Demonstração local":accountName();
 return `<div class="account-summary"><strong>${esc(label)}</strong><small>${esc(accountRole())}</small></div><div class="account-dropdown"><button type="button" id="accountMenuToggle" data-account-menu-toggle aria-expanded="false" aria-controls="accountPopover">Minha conta <span data-connection-dot class="connection-dot" aria-hidden="true"></span><span aria-hidden="true">▾</span></button><div id="accountPopover" class="account-popover" hidden><div class="account-menu-identity"><strong>${esc(label)}</strong>${!C.demo?`<span>${esc(user?.email||"Sem e-mail informado")}</span>`:""}<small>${esc(accountRole())}</small></div>${connectionAccountPanel()}<nav aria-label="Opções da conta">${C.demo||role?'<button type="button" class="account-feature" data-my-account><strong>Minha conta e segurança</strong><small>Perfil, acesso, senha e vínculo com Google</small></button>':'<button type="button" data-access-refresh>Atualizar situação do acesso</button>'}<button type="button" class="account-feature" data-open-accessibility><strong>Aparência e acessibilidade</strong><small>Tema, tamanho do texto, contraste e movimentos</small></button>${role==="admin"?'<button type="button" data-account-settings>Configurações do sistema</button>':""}<button type="button" class="account-feature" data-account-guide><strong>Ajuda e guia de uso</strong><small>Orientações passo a passo para o seu perfil</small></button><a class="button account-feature" href="${esc(new URL("painel.html?demonstracao=1",location.href).href)}" target="_blank" rel="noopener"><strong>Treinamento</strong><small>Pratique em outra aba com dados fictícios</small></a>${C.demo?`<a class="button" href="${esc(new URL("painel.html",location.href).href)}">Sair da demonstração</a>`:'<button type="button" data-account-exit>Sair da conta</button>'}</nav></div></div>`;
}
function closeAccountMenu(focus=false){
 const toggle=$("#accountMenuToggle"),panel=$("#accountPopover");
 if(panel)panel.hidden=true;if(toggle)toggle.setAttribute("aria-expanded","false");
 if(focus)toggle?.focus();
}
function setupAccountTools(){
 const region=document.querySelector(".accessibility-bar"),details=$("#arenaPreferences");
 if(!region||!details)return;
 const dialog=document.createElement("dialog");dialog.id="arenaPreferencesDialog";
 dialog.setAttribute("aria-labelledby","arenaPreferencesTitle");
 dialog.innerHTML='<div class="preferences-dialog-heading"><h2 id="arenaPreferencesTitle" tabindex="-1">Aparência e acessibilidade</h2><button type="button" data-close-accessibility aria-label="Fechar aparência e acessibilidade">Fechar ✕</button></div>';
 for(const child of [...details.children])if(child.tagName!=="SUMMARY")dialog.append(child);
 details.remove();region.append(dialog);
 const icon='<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><circle cx="12" cy="4" r="2"/><path d="M3 8h18M12 7v7m0 0-5 7m5-7 5 7"/></svg>';
 region.insertAdjacentHTML("afterbegin",`<button type="button" class="preferences-entry" data-open-accessibility>${icon}<span>Preferências de leitura</span></button><button type="button" class="accessibility-float" data-open-accessibility aria-label="Abrir opções de acessibilidade" title="Acessibilidade">${icon}</button>`);
 const headerActions=document.querySelector("header .header-actions"),openPanel=headerActions?.querySelector('a[href="index.html"]');
 if(admin&&headerActions&&openPanel)openPanel.before(region.querySelector(".preferences-entry"));
 let returnFocus=null;
 const openPreferences=source=>{hideContextHelp();closeAccountMenu();returnFocus=source?.closest("#accountPopover")?$("#accountMenuToggle"):source?.closest("#publicTools")?$("#publicTools > summary"):source; if(!dialog.open)dialog.showModal();$("#arenaPreferencesTitle").focus();};
 dialog.addEventListener("close",()=>{hideContextHelp();if(returnFocus?.isConnected)returnFocus.focus();});
 document.addEventListener("click",e=>{
  const toggle=e.target.closest("[data-account-menu-toggle]");
  if(toggle){hideContextHelp();const panel=$("#accountPopover"),open=toggle.getAttribute("aria-expanded")!=="true";panel.hidden=!open;toggle.setAttribute("aria-expanded",String(open));return;}
  const accessibility=e.target.closest("[data-open-accessibility]");
  if(accessibility){openPreferences(accessibility);return;}
  if(e.target.closest("[data-close-accessibility]")){dialog.close();return;}
  if(e.target.closest("[data-account-settings]")){
   if(role!=="admin")return;closeAccountMenu();cloud?.stopHistory();section="settings";selected="";render();$("#view h2")?.scrollIntoView({block:"start"});return;
  }
  if(e.target.closest("[data-account-guide]")){closeAccountMenu();document.querySelector("[data-open-tutorial]")?.click();return;}
  if(!e.target.closest(".account-dropdown"))closeAccountMenu();
  else if(e.target.closest("#accountPopover button,#accountPopover a"))closeAccountMenu();
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#accountPopover")&&!$("#accountPopover").hidden){e.preventDefault();closeAccountMenu(true);}});
 document.addEventListener("focusin",e=>{if(!e.target.closest("#sessionIdentity"))closeAccountMenu();});
}
setupAccountTools();

// 21 — Organização da central. Permissões continuam validadas pelo Firebase.
const workspaceDefinitions=[
 {id:"games",title:"Jogos",intro:"Acompanhar e operar partidas",sections:["overview","matches","standings"]},
 {id:"records",title:"Cadastros",intro:"Equipes, jogadores, campeonatos e partidas",sections:["teams","players","championships","createMatch","imports"]},
 {id:"documents",title:"Documentos e suporte",intro:"Súmulas, relatórios, certificados e guias",sections:["documentation","matchSheets","reports","auditReports","certificates"]},
 {id:"administration",title:"Administração",intro:"Operadores, acessos, relatórios e configurações",sections:["monitor","users","matchSheets","reports","auditReports","certificates","settings","cleanup","testData","credentials"]}
];
function allowedWorkspaceSections(group){return group.sections.filter(id=>role==="admin"||["overview","matches","documentation"].includes(id)||(canManageRosters()&&["teams","players","imports"].includes(id))||(canManageChampionships()&&id==="championships")||(canCreateMatches()&&id==="createMatch"));}
function frequentWorkspaceShortcuts(allowed) {
 const games = [["live","Ao vivo"],["scheduled","Agendadas"],["finished","Finalizadas"]];
 const registrations = [
  ["createMatch","Nova partida"],["teams","Equipes"],["players","Jogadores"],
  ["championships","Campeonatos e fichas"],["users","Operadores"],
 ];
 return `<nav class="frequent-shortcuts noprint" aria-label="Atalhos frequentes">
  <div class="toolbar">${allowed.has("matches") ? games.map(([group,label]) =>
   `<button type="button" data-games-shortcut="${group}">${label}</button>`).join("") : ""}
  ${registrations.filter(([id]) => allowed.has(id)).map(([id,label]) =>
   `<button type="button" data-section="${id}">${label}</button>`).join("")}
  <a class="button" href="./index.html" target="_blank" rel="noopener">Painel público ↗</a>
  <button type="button" data-share-qr="${esc(new URL("./index.html",location.href).href)}" ${state.settings.logo ? "data-qr-logo" : ""}>Baixar QR code${state.settings.logo ? " com logo" : ""}</button>
  </div></nav>`;
}
function arenaIcon(name) {
 const paths={overview:"M3 10 12 3l9 7v11h-6v-7H9v7H3Z",games:"M4 4h16v16H4z M8 4v16 M16 4v16 M4 10h16 M4 14h16",records:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.87",documents:"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6",administration:"M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7Z M8 12l3 3 5-6",account:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 22v-3a8 6 0 0 1 16 0v3",menu:"M4 6h16 M4 12h16 M4 18h16",close:"M6 6l12 12 M18 6 6 18",help:"M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",collapse:"M14 6l-6 6 6 6",qr:"M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h3v3h3v3h-6z",cup:"M8 3h8v7a4 4 0 0 1-8 0V3Z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 14v7 M8 21h8"};
 return `<svg class="arena-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.documents}"/></svg>`;
}
function workspaceNavigation(sections){
 const labels=Object.fromEntries(sections),visible=workspaceDefinitions.filter(g=>allowedWorkspaceSections(g).length);
 const seen=new Set(["overview","account"]);
 const brand=$("#systemBrand")?.innerHTML||esc(systemDisplayName());
 const publicHref=trainingMode?"./index.html?demonstracao=1":"./index.html";
 const groups=visible.map(group=>{
   const ids=allowedWorkspaceSections(group).filter(id=>!seen.has(id));ids.forEach(id=>seen.add(id));if(!ids.length)return "";
   const active=ids.includes(section),open=arenaOpenGroups.has(group.id)?arenaOpenGroups.get(group.id):active;
   return `<details class="arena-side-group" data-layout-group="${group.id}" ${open?"open":""}><summary title="${esc(group.title)}" aria-label="${esc(group.title)}">${arenaIcon(group.id)}<span>${esc(group.title)}</span></summary><nav aria-label="${esc(group.title)}">${ids.map(id=>`<button type="button" data-section="${id}" title="${esc(labels[id]||id)}" class="arena-side-item ${section===id?"is-current":""}" ${section===id?'aria-current="page"':""}>${esc(labels[id]||id)}</button>${id==="matches"?'<div class="arena-side-scopes" aria-label="Filtrar jogos"><button type="button" data-games-shortcut="live">Ao vivo</button><button type="button" data-games-shortcut="scheduled">Agenda</button><button type="button" data-games-shortcut="finished">Resultados</button></div>':""}`).join("")}</nav></details>`;
 }).join("");
 return `<aside id="arenaSidebar" class="arena-sidebar noprint" aria-label="Navegação da central" tabindex="-1"><div class="arena-sidebar-brand"><a href="./apresentacao.html" class="arena-side-brand-link" aria-label="${esc(systemDisplayName())}" title="${esc(systemDisplayName())}">${brand}</a><button type="button" data-layout-rail aria-label="Recolher barra lateral" title="Recolher barra lateral" aria-expanded="true" aria-controls="arenaSidebar">${arenaIcon("collapse")}</button><button type="button" data-layout-close aria-label="Fechar menu">${arenaIcon("close")}</button></div><div class="arena-sidebar-nav"><p class="arena-side-caption">ESPAÇO DE TRABALHO</p><button type="button" title="Visão geral" aria-label="Visão geral" class="arena-side-home ${section==="overview"?"is-current":""}" data-section="overview" ${section==="overview"?'aria-current="page"':""}>${arenaIcon("overview")}<span>Visão geral</span></button>${groups}</div><div class="arena-sidebar-footer"><button type="button" data-section="account" title="Minha conta" aria-label="Minha conta">${arenaIcon("account")}<span>Minha conta</span></button><button type="button" data-account-guide title="Demonstração e ajuda" aria-label="Demonstração e ajuda">${arenaIcon("help")}<span>Demonstração e ajuda</span></button><a class="button" href="${esc(publicHref)}" target="_blank" rel="noopener" title="Abrir painel público" aria-label="Abrir painel público">${arenaIcon("games")}<span>Abrir painel público</span></a><button type="button" data-share-qr="${esc(new URL(publicHref,location.href).href)}" ${state.settings.logo?"data-qr-logo":""} title="Baixar QR code" aria-label="Baixar QR code">${arenaIcon("qr")}<span>Baixar QR code${state.settings.logo?" com logo":""}</span></button><small>${esc(C.demo?"Treinamento isolado":accountName())}<br>${esc(accountRole())}</small></div></aside><div class="arena-drawer-backdrop noprint" data-layout-close ${arenaDrawerOpen?"":"hidden"}></div><div class="arena-toolbar noprint"><span class="arena-current-profile">${esc(panelDisplayName())}</span><button type="button" data-account-guide>${arenaIcon("help")} Guia das funções</button></div>${personalTopShortcuts()}<section class="navigation-finder arena-function-search noprint" aria-label="Encontrar função"><label for="functionSearch">Encontrar uma função</label><div class="navigation-search-row"><input id="functionSearch" type="search" placeholder="Ex.: relógio, jogador, súmula ou permissões" value="${esc(navigationQuery)}" autocomplete="off" aria-controls="navigationSearchResults"><button type="button" data-clear-navigation-search>Limpar busca</button></div><div id="navigationSearchResults" aria-live="polite">${navigationSearchResults()}</div></section>`;
}
function syncArenaRail() {
 document.body.classList.toggle("arena-rail-collapsed",arenaRailCollapsed);
 if(arenaRailCollapsed && window.matchMedia("(min-width: 1080px)").matches)for(const group of document.querySelectorAll(".arena-side-group[open]")){group.open=false;arenaOpenGroups.set(group.dataset.layoutGroup,false);}
 for(const button of document.querySelectorAll("[data-layout-rail]")){const label=arenaRailCollapsed?"Expandir barra lateral":"Recolher barra lateral";button.setAttribute("aria-label",label);button.title=label;button.setAttribute("aria-expanded",String(!arenaRailCollapsed));}
}
function syncArenaLayout() {
 document.body.classList.add("arena-layout-v2");
 const ready=admin && (C.demo || (user && role));
 document.body.classList.toggle("arena-central-ready",Boolean(ready));
 document.body.classList.toggle("arena-operation-page",Boolean(ready&&section==="matches"&&selected));
 let toggle=$("#arenaMenuToggle");
 if(admin&&!toggle){toggle=document.createElement("button");toggle.id="arenaMenuToggle";toggle.type="button";toggle.dataset.layoutMenu="";toggle.className="arena-menu-toggle noprint";toggle.setAttribute("aria-controls","arenaSidebar");document.querySelector("header")?.prepend(toggle);}
 if(toggle){toggle.hidden=!ready;toggle.setAttribute("aria-label","Abrir menu da central");toggle.setAttribute("aria-expanded",String(arenaDrawerOpen));toggle.innerHTML=arenaIcon("menu")+"<span>Menu</span>";}
 if(!ready){arenaDrawerOpen=false;releaseArenaInert();}
}
function releaseArenaInert(){for(const [el,value] of arenaInertNodes)el.inert=value;arenaInertNodes=[];document.body.classList.remove("arena-drawer-open");}
function applyArenaDrawer() {
 releaseArenaInert();
 syncArenaRail();
 const side=$("#arenaSidebar"),mobile=window.matchMedia("(max-width: 1079px)").matches;
 if(!side)return;
 const open=arenaDrawerOpen&&mobile;document.body.classList.toggle("arena-drawer-open",open);
 side.setAttribute("role",open?"dialog":"complementary");if(open)side.setAttribute("aria-modal","true");else side.removeAttribute("aria-modal");
 $("#arenaMenuToggle")?.setAttribute("aria-expanded",String(open));
 const shade=document.querySelector(".arena-drawer-backdrop");if(shade)shade.hidden=!open;
 if(open){for(const el of [...app.children,...[...document.body.children].filter(el=>!el.contains(app)&&!["SCRIPT","STYLE"].includes(el.tagName))]){
   if(el===side||el.classList.contains("arena-drawer-backdrop"))continue;
   arenaInertNodes.push([el,el.inert]);el.inert=true;
  }
  if(!side.contains(document.activeElement))requestAnimationFrame(()=>{if(arenaDrawerOpen)side.querySelector("[data-layout-close]")?.focus({preventScroll:true});});
 }
}
document.addEventListener("click",event=>{
 const rail=event.target.closest("[data-layout-rail]");
 if(rail){arenaRailCollapsed=!arenaRailCollapsed;try{localStorage.setItem("arena-barra-recolhida-v1",arenaRailCollapsed?"1":"0");}catch{}syncArenaRail();return;}
 const groupSummary=event.target.closest(".arena-side-group > summary");
 if(groupSummary && arenaRailCollapsed && window.matchMedia("(min-width: 1080px)").matches){event.preventDefault();arenaRailCollapsed=false;try{localStorage.setItem("arena-barra-recolhida-v1","0");}catch{}syncArenaRail();groupSummary.parentElement.open=true;}
 const button=event.target.closest("[data-layout-menu],[data-layout-close]");
 if(button){arenaDrawerOpen=button.hasAttribute("data-layout-menu")?!arenaDrawerOpen:false;applyArenaDrawer();if(!arenaDrawerOpen)$("#arenaMenuToggle")?.focus({preventScroll:true});return;}
 const action=event.target.closest("[data-section],[data-games-shortcut],[data-account-guide],[data-workspace]");
 if(action){const id=action.dataset.section;const group=id&&workspaceDefinitions.find(g=>g.sections.includes(id));if(id||action.dataset.gamesShortcut){for(const g of workspaceDefinitions)arenaOpenGroups.set(g.id,g.id===(group?.id||(action.dataset.gamesShortcut?"games":"")));}arenaDrawerOpen=false;applyArenaDrawer();}
},true);
document.addEventListener("toggle",event=>{
 const group=event.target;if(!group.matches?.("[data-layout-group]")||!group.isConnected)return;
 arenaOpenGroups.set(group.dataset.layoutGroup,group.open);
 if(group.open)for(const other of document.querySelectorAll(".arena-side-group[open]")){if(other!==group){other.open=false;arenaOpenGroups.set(other.dataset.layoutGroup,false);}}
},true);
document.addEventListener("keydown",event=>{
 if(!arenaDrawerOpen)return;
 if(event.key==="Escape"){event.preventDefault();arenaDrawerOpen=false;applyArenaDrawer();$("#arenaMenuToggle")?.focus({preventScroll:true});}
 if(event.key==="Tab"){
  const side=$("#arenaSidebar"),items=[...(side?.querySelectorAll("button,a[href],summary")||[])].filter(el=>!el.disabled && el.getClientRects().length);
  if(!items.length)return;const first=items[0],last=items.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }
},true);
window.addEventListener("resize",()=>{if(window.matchMedia("(min-width: 1080px)").matches)arenaDrawerOpen=false;applyArenaDrawer();},{passive:true});
function documentationView(){
 const central=new URL("painel.html",location.href);central.search="";
 const pub=new URL("index.html",location.href);pub.search="";
 return `<section class="card"><span class="tag">GUIAS E DOCUMENTOS</span><h2>Backups e suporte</h2><p>As funções de documentos estão separadas por finalidade. Escolha abaixo para abrir a visualização e as opções próprias de cada tipo. Os arquivos são preparados na hora; a emissão de certificados não fica arquivada no sistema.</p><div class="documentation-grid">${role==="admin"?`<article><h3>Cópia dos dados carregados</h3><p>Baixa um JSON para consulta. A recuperação de partidas é feita na lixeira do Arena.</p><button type="button" data-backup>Baixar cópia JSON</button></article><article><h3>Recuperação de partidas</h3><p>Consulte a lixeira e recupere partidas elegíveis durante o prazo de retenção.</p><button type="button" data-section="cleanup">Abrir lixeira de partidas</button></article>`:""}<article><h3>Treinamento</h3><p>Pratique com partidas fictícias em uma aba separada.</p><a class="button" href="painel.html?demonstracao=1" target="_blank" rel="noopener">Abrir treinamento</a></article>${role==="admin"?'<article><h3>Súmulas</h3><p>Visualize partidas, imprima ou salve em PDF e baixe os dados em JSON.</p><button type="button" data-section="matchSheets">Abrir súmulas</button></article><article><h3>Relatórios esportivos</h3><p>Resultados das partidas com saída em PDF, Excel ou JSON.</p><button type="button" data-section="reports">Abrir relatórios</button></article><article><h3>Relatório geral de alterações</h3><p>Consulte o histórico administrativo e exporte em PDF, Excel ou JSON.</p><button type="button" data-section="auditReports">Abrir relatório geral</button></article><article><h3>Certificados</h3><p>Preencha os dados e visualize, imprima ou salve como PDF. Baixe os dados do certificado em JSON.</p><button type="button" data-section="certificates">Abrir certificados</button></article><article><h3>Limpeza de testes</h3><p>Remova somente a partida conferida, após baixar a cópia. Histórico e contas são preservados. Não é uma lixeira e não há restauração automática.</p><button type="button" data-section="cleanup">Abrir limpeza de testes</button></article><article><h3>Compartilhar ou entregar o sistema</h3><p>Para colaboração, aprove contas e atribua partidas. Para outra organização independente, use uma cópia do código com GitHub e Firebase próprios. Transferir esta instalação exige revisar a propriedade e o UID principal no código e nas regras; transferir só o repositório não troca esse administrador.</p></article>':""}<article><h3>Operar uma partida</h3><ol><li>Em Jogos → Acompanhar jogos, abra uma partida atribuída à sua conta.</li><li>Inicie o jogo, confira as equipes e registre os lances.</li><li>Use pausas e avisos para informar interrupções. Ao terminar, encerre a partida.</li></ol><button type="button" data-section="matches">Acompanhar jogos</button></article><article><h3>Usar em outro computador</h3><p>Abra o link da central em um navegador com internet. Entre com sua conta Google vinculada ou e-mail e senha. Não é necessário instalar VS Code ou GitHub para operar os jogos.</p><p><a href="${esc(central.href)}" target="_blank" rel="noopener">Abrir central</a> · <a href="${esc(pub.href)}" target="_blank" rel="noopener">Abrir painel público</a></p></article><article><h3>Conta e leitura</h3><p>No menu Minha conta, confira o perfil, os métodos de entrada e a redefinição de senha. Aparência e acessibilidade muda tema, texto e contraste apenas neste navegador.</p><button type="button" data-open-accessibility>Abrir acessibilidade</button></article></div></section>`;
}
function operatorMonitor(){
 if(role!=="admin")return "";
 const people=(state.users||[]).filter(u=>!u.deleted && u.id!==(cloud?.mainUID||user?.uid) && !cloud?.isAdministratorUID?.(u.id));
 const operators=people.filter(u=>u.role==="operator"&&u.enabled!==false),pending=people.filter(u=>u.role==="pending");
 const assigned=new Set(state.matches.filter(m=>operators.some(u=>(u.matches||[]).includes(m.id)||(m.championshipId&&(u.operatedChampionships||[]).includes(m.championshipId)))).map(m=>m.id));
 const operational=state.matches.filter(m=>!["Encerrada","Homologada","Cancelada"].includes(m.status));
 const unassigned=operational.filter(m=>!assigned.has(m.id));
 return `<section class="card"><span class="tag">ADMINISTRAÇÃO</span><h2>Operadores e distribuição de partidas</h2><p>Acompanhe as aprovações e quem tem autorização em cada jogo. “Aprovado” indica permissão de acesso; não indica que a pessoa esteja conectada neste momento.</p><div class="admin-metrics"><article><strong>${operators.length}</strong><span>Operadores aprovados</span></article><article><strong>${pending.length}</strong><span>Solicitações pendentes</span></article><article><strong>${unassigned.length}</strong><span>Partidas em aberto sem operador</span></article></div><button type="button" data-section="users">Gerenciar acessos e atribuições</button>${table(["Pessoa","E-mail","Situação do acesso","Partidas existentes atribuídas"],people.map(u=>tr([u.name||"Operador",u.email||"Não informado",u.role==="pending"?"Aguardando aprovação":u.role==="operator"?(u.enabled===false?"Bloqueado":"Aprovado"):"Revisar perfil",state.matches.filter(m=>(u.matches||[]).includes(m.id)||(m.championshipId&&(u.operatedChampionships||[]).includes(m.championshipId))).map(m=>`${name(m.home)} × ${name(m.away)} (${m.status})`).join("; ")||"Nenhuma"]))) }${people.length?"":empty(C.demo?"A demonstração não contém contas reais de operadores.":"Nenhum operador cadastrado.")}<h3>Relatórios e documentos</h3><p class="muted">A visualização de operadores continua atualizando em tempo real. Para gerar documentos administrativos, escolha o relatório desejado:</p><div class="toolbar"><button type="button" data-section="matchSheets">Súmulas</button><button type="button" data-section="reports">Relatórios esportivos</button><button type="button" data-section="auditReports">Relatório geral de alterações</button><button type="button" data-section="certificates">Certificados</button></div></section><section class="card"><h3>Partidas em aberto sem operador atribuído</h3>${unassigned.length?table(["Partida","Modalidade","Situação","Local"],unassigned.map(m=>tr([name(m.home)+" × "+name(m.away),m.sport,m.status,m.place||"A definir"]))):empty("Todas as partidas em aberto possuem operador aprovado atribuído, ou não há partidas em aberto.")}<p class="muted">O administrador principal continua autorizado a operar todas as partidas.</p></section>`;
}
document.addEventListener("click",e=>{
 const b=e.target.closest("[data-workspace]");if(!b)return;
 const group=workspaceDefinitions.find(g=>g.id===b.dataset.workspace),allowed=group&&allowedWorkspaceSections(group);
 if(!allowed?.length)return;
 const target=allowed.includes(section)?section:allowed[0];cloud?.stopHistory();selected="";pendingImport=null;if(target==="teams"){selectedTeamId="";teamFormVisible=false;teamEditorId="";}section=target;render();
});

// 22 — Painel público: estatísticas dos jogos publicados e diversão apenas local.
let publicArea="active",sportChallengeIndex=0,sportChallengeAnswer="",quizHits=0,quizAttempts=0;
const sportChallenges=[
 {question:"O placar estava 2 × 1 e a equipe visitante marcou. Como fica?",answers:["3 × 1","2 × 2","2 × 1"],correct:1,explanation:"O gol visitante acrescenta um ao segundo número: 2 × 2."},
 {question:"Um time marcou 3 gols e sofreu 1. Qual é o saldo de gols?",answers:["+2","+4","−2"],correct:0,explanation:"Saldo é gols marcados menos sofridos: 3 − 1 = +2."},
 {question:"O relógio marca 12:45. Após 15 segundos, qual será o tempo?",answers:["12:60","13:15","13:00"],correct:2,explanation:"Quinze segundos completam o minuto: 13:00."},
 {question:"Qual jogador tem a função de proteger o gol no futebol?",answers:["Goleiro","Levantador","Pivô"],correct:0,explanation:"O goleiro atua na defesa do gol."},
 {question:"Em qual modalidade a cesta é usada para pontuar?",answers:["Vôlei","Basquete","Futebol"],correct:1,explanation:"A cesta faz parte do basquete."},
 {question:"Qual destas modalidades tem uma rede dividindo a quadra?",answers:["Futebol","Basquete","Vôlei"],correct:2,explanation:"No vôlei, a rede separa os dois lados da quadra."}
];
function publicStatistics(){
 const games=state.matches.filter(m=>!publicFilter||m.sport===publicFilter),ended=games.filter(m=>["Encerrada","Homologada"].includes(m.status));
 const football=ended.filter(m=>m.sport==="Futebol"),goals=football.reduce((sum,m)=>sum+(m.score||[0,0]).reduce((a,n)=>a+(Number.isFinite(n)?n:0),0),0),teams=new Set(games.flatMap(m=>[m.home,m.away]).filter(Boolean));
 const metrics = [
  ["live", games.filter(m => m.status === "Ao vivo").length, "Jogos ao vivo"],
  ["schedule", games.filter(m => ["Agendada","Adiada"].includes(m.status)).length, "Jogos programados"],
  ["results", ended.length, "Jogos concluídos"],
  ["teams", teams.size, "Equipes nas partidas"],
 ];
 return `<nav class="public-metrics" aria-label="Atalhos dos jogos publicados">${metrics.map(([area,count,label]) =>
  `<button type="button" class="metric-shortcut" data-public-area="${area}" aria-pressed="${publicArea === area}">
    <strong>${count}</strong><span>${label}</span></button>`).join("")}</nav>
  ${!publicFilter||publicFilter==="Futebol"?`<p class="muted public-goals">Futebol: ${goals} gol(s) em ${football.length} partida(s) encerrada(s) ou homologada(s).</p>`:""}`;

}
function publicChallenge(){
 const q=sportChallenges[sportChallengeIndex%sportChallenges.length],answered=sportChallengeAnswer!=="";
 return `<section class="card sport-challenge"><span class="tag">INTERVALO ESPORTIVO</span><h2>Desafio rápido</h2><p>Uma brincadeira para aprender enquanto acompanha as partidas. Suas respostas ficam apenas nesta página.</p><p class="quiz-score">Seu placar: <strong>${quizHits} acerto(s) em ${quizAttempts} resposta(s)</strong></p><h3>${esc(q.question)}</h3><div class="toolbar">${q.answers.map((a,i)=>`<button type="button" data-sport-answer="${i}" ${answered?"disabled":""}>${esc(a)}</button>`).join("")}</div>${answered?`<p role="status"><strong>${Number(sportChallengeAnswer)===q.correct?"Acertou!":"Vamos aprender!"}</strong> ${esc(q.explanation)}</p><button type="button" data-sport-next>Próximo desafio</button>`:""}</section>`;
}
function publicHub(){
 const tabs=[["active","Jogos atuais"],["live","Ao vivo"],["schedule","Agenda"],["results","Resultados"],["teams","Equipes"],["standings","Classificação"],["fun","Diversão"]];
 return `${publicStatistics()}${publicSportSummary()}<nav class="public-navigation" aria-label="Conteúdo do painel público">${tabs.map(([id,label])=>`<button type="button" data-public-area="${id}" class="${id===publicArea?"active":""}" ${id===publicArea?'aria-current="page"':""}>${label}</button>`).join("")}</nav><div id="publicHubContent">${publicHubContent()}</div>`;
}
function publicTeamsPanel() {
 const games = state.matches.filter(m => !publicFilter || m.sport === publicFilter);
 const ids = [...new Set(games.flatMap(m => [m.home,m.away]).filter(Boolean))]
  .sort((a,b) => name(a).localeCompare(name(b), "pt-BR"));
 return `<section aria-label="Equipes nas partidas publicadas"><h2>Equipes</h2><div class="grid">${ids.map(id =>
  `<article class="card"><h3>${esc(name(id))}</h3><p>${games.filter(m => m.home === id || m.away === id).length} partida(s) nesta seleção</p></article>`).join("") ||
  empty("Nenhuma equipe nas partidas desta seleção.")}</div></section>`;
}
function publicHubContent(){
 if(publicArea==="teams")return publicTeamsPanel();
 if(publicArea==="fun")return fanZone();
 if(publicArea==="standings")return standingsPanel()||empty("A classificação estará disponível quando houver partidas vinculadas a um campeonato de futebol.");
 return `${publicArea==="active"?'<p class="muted">Partidas encerradas, homologadas e canceladas ficam em <strong>Resultados</strong>.</p>':""}<div id="publicMatches" class="grid">${publicMatches(publicFilter)}</div>${publicArea==="active"?'<section class="card public-locations"><h2>Esporte em diferentes locais</h2><p>Veja o local informado em cada partida. Use a modalidade, a agenda e os jogos ao vivo para acompanhar os eventos publicados pela organização.</p></section>':""}`;
}
function googleSymbol(){return '<svg class="google-symbol" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.78.5 3.82 1.5l2.86-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.7 9.4 5.95 12 5.95Z"/></svg>';}
document.addEventListener("click",e=>{
 if(admin)return;
 const liveJump=e.target.closest("[data-public-live-jump]");
 if(liveJump){
  const match=state.matches.find(item=>item.id===liveJump.dataset.publicLiveJump);
  if(!match||!["Ao vivo","Pausada","Suspensa"].includes(match.status))return;
  publicArea=match.status==="Ao vivo"?"live":"active";
  render();
  requestAnimationFrame(()=>document.getElementById(`match-card-${match.id}`)?.scrollIntoView({behavior:preferences.motion?"auto":"smooth",block:"start"}));
  return;
 }
 const area=e.target.closest("[data-public-area]");
 if(area){
  publicArea=area.dataset.publicArea;
  render();
  requestAnimationFrame(() => document.getElementById("publicHubContent")?.scrollIntoView({
   behavior:preferences.motion?"auto":"smooth",block:"start"
  }));
  return;
 }
 const answer=e.target.closest("[data-sport-answer]");
 if(answer&&sportChallengeAnswer===""){sportChallengeAnswer=answer.dataset.sportAnswer;quizAttempts++;if(Number(sportChallengeAnswer)===sportChallenges[sportChallengeIndex%sportChallenges.length].correct)quizHits++;const out=$("#publicHubContent");if(out)out.innerHTML=fanZone();return;}
 if(e.target.closest("[data-sport-next]")){sportChallengeIndex++;sportChallengeAnswer="";const out=$("#publicHubContent");if(out)out.innerHTML=fanZone();}
});

// 24 — Ficha da equipe. Dados atuais, partidas e lances têm escopos separados.
let teamProfileContext="";
let teamPlayerDraft=null;
function resetTeamProfileContext(){const current=(C.demo?"demo":user?.uid||"anônimo")+":"+role+":"+canManageRosters();if(current===teamProfileContext)return;teamProfileContext=current;teamPlayerDraft=null;teamFormVisible=false;teamEditorId="";selectedTeamId="";teamHistoryRows=[];teamHistoryLoaded=false;teamEventsKey="";teamProfileRequest++;teamProfileBusy=false;}
let teamGameScope="active";
let selectedTeamId="",teamProfileTab="data",teamProfileSport="",teamProfileChamp="",teamHistoryRows=[],teamHistoryLoaded=false,teamProfileBusy=false,teamEventsKey="",teamProfileRequest=0;
function teamSports(t){return [...new Set([...(t.sports||[]),...state.matches.filter(m=>[m.home,m.away].includes(t.id)).map(m=>m.sport)])].sort();}
function teamMatches(){return state.matches.filter(m=>[m.home,m.away].includes(selectedTeamId)&&(!teamProfileSport||m.sport===teamProfileSport)&&(!teamProfileChamp||(m.championshipId||"__unlinked__")===teamProfileChamp));}
function teamMatchKey(){return teamMatches().map(m=>m.id+":"+(m._revision||m.events?.length||0)).sort().join("|");}
function teamStatistics(matches,teamId){
 const groups=new Map();
 for(const m of matches){if(!["Encerrada","Homologada"].includes(m.status))continue;
  const score=gameResult(m),side=m.home===teamId?0:1;
  if(!Array.isArray(score)||score.length!==2||!score.every(n=>Number.isInteger(n)&&n>=0))continue;
  if(!groups.has(m.sport))groups.set(m.sport,{sport:m.sport,games:0,wins:0,draws:0,losses:0,for:0,against:0});
  const r=groups.get(m.sport),a=score[side],b=score[1-side];r.games++;r.for+=a;r.against+=b;if(a>b)r.wins++;else if(a===b)r.draws++;else r.losses++;
 }
 return [...groups.values()].sort((a,b)=>a.sport.localeCompare(b.sport,"pt-BR"));
}
function teamAthleteEvents(matches,teamId){
 const rows=new Map();
 for(const m of matches){if(m.status==="Cancelada")continue;const side=m.home===teamId?0:1;
  for(const e of m.events||[]){if(e.side!==side||!["ponto","cartão amarelo","cartão vermelho","falta"].includes(e.type))continue;
   const player=e.player||"",key=m.sport+":"+player;
   if(!rows.has(key))rows.set(key,{sport:m.sport,player:player?(m.roster||[]).find(p=>p.id===player)?.name||state.players.find(p=>p.id===player)?.name||player:"Sem atleta informado",points:0,yellow:0,red:0,fouls:0});
   const r=rows.get(key);if(e.type==="ponto")r.points+=Number(e.value)||0;if(e.type==="cartão amarelo")r.yellow++;if(e.type==="cartão vermelho")r.red++;if(e.type==="falta")r.fouls++;
  }
 }
 return [...rows.values()];
}
function teamHistoryOutput(){
 if(!teamHistoryLoaded)return empty("Clique em Carregar histórico para consultar as alterações registradas da equipe e de seus jogadores.");
 const labels={name:"Nome",short:"Sigla",coach:"Técnico(a)",category:"Categoria",badge:"Escudo",sports:"Modalidades",archived:"Arquivada",team:"Equipe",number:"Número",position:"Posição",reserve:"Reserva"};
 return teamHistoryRows.map(r=>{
  const changes=Object.entries(labels).filter(([key])=>JSON.stringify(r.before?.[key]??null)!==JSON.stringify(r.after?.[key]??null)).map(([key,label])=>{
   const show=v=>key==="badge"?(v?"Imagem cadastrada":"Sem imagem"):Array.isArray(v)?v.join(", "):typeof v==="boolean"?(v?"Sim":"Não"):v??"—";
   return tr([label,show(r.before?.[key]),show(r.after?.[key])]);
  });
  return `<details class="event"><summary>${esc(r.entity==="teams"?"Equipe":"Jogador")} • ${esc(r.after?.name||r.before?.name||r.target)} • ${esc(r.detail?.type||"Alteração")} • ${esc(removedDate(r.at))}</summary><p>Responsável: ${esc(r.actor||"Não informado")}<br>Motivo/registro: ${esc(r.detail?.reason||r.detail?.text||"Não informado")}<br>ID: ${esc(r.ID||r.id||r.target)}</p>${table(["Campo","Antes","Depois"],changes)}</details>`;
 }).join("")||empty("Não há alterações registradas para esta equipe ou seu elenco nesta versão.");
}
function teamProfileView(){
 const t=state.teams.find(t=>t.id===selectedTeamId);if(!t||!canManageRosters()){selectedTeamId="";return empty("Equipe indisponível para esta conta.");}
 const roster=state.players.filter(p=>p.team===t.id).slice().sort(alphabetical),games=teamMatches();
 const tabs=[["data","Dados e técnico"],["roster","Jogadores"],["games","Jogos da equipe"],...(role==="admin"?[["stats","Estatísticas, cartões e faltas"],["history","Histórico de alterações"]]:[])];
 if(!tabs.some(([id])=>id===teamProfileTab))teamProfileTab="data";
 const championships=[...new Map(state.matches.filter(m=>[m.home,m.away].includes(t.id)).map(m=>[m.championshipId||"__unlinked__",m.championshipId?(m.competition||"Campeonato"):"Sem vínculo com campeonato"])).entries()];
 let content="";
 if(teamProfileTab==="data")content=`<section class="card"><h3>Cadastro atual</h3><dl class="account-details"><div><dt>Nome</dt><dd>${esc(t.name)}</dd></div><div><dt>Sigla</dt><dd>${esc(t.short||"Não informada")}</dd></div><div><dt>Técnico(a)</dt><dd>${esc(t.coach||"Não informado")}</dd></div><div><dt>Categoria</dt><dd>${esc(t.category||"Não informada")}</dd></div><div><dt>Modalidades cadastradas</dt><dd>${esc((t.sports||[]).join(", ")||"Ainda não informadas")}</dd></div><div><dt>Situação</dt><dd>${t.archived?"Arquivada":"Ativa"}</dd></div></dl><p class="muted">O cadastro atual não reescreve os elencos e técnicos congelados nas súmulas das partidas já criadas.</p><button type="button" data-profile-edit>Editar dados e modalidades</button>${role==="admin"?` <button type="button" data-profile-archive ${teamProfileBusy?"disabled":""}>${t.archived?"Reativar equipe":"Arquivar equipe"}</button><p class="muted">Arquivar preserva nome, jogadores, resultados e histórico. A equipe sai das opções de novos jogos e novos jogadores, e pode ser reativada.</p>`:""}</section>`;
 if(teamProfileTab==="roster")content=`<section class="card"><h3>Elenco atual • ${roster.length} jogador(es)</h3>${!t.archived?'<button type="button" data-profile-new-player>Adicionar jogador nesta equipe</button>':'<p>Reative a equipe antes de alterar o elenco.</p>'}${teamPlayerEditor(t)}${roster.length?table(["Nome","Número","Posição","Escalação","Ação"],roster.map(p=>tr([p.name,p.number,p.position,p.reserve?"Reserva / banco":"Titular"]).replace("</tr>",`<td>${!t.archived?`<button type="button" data-profile-player="${esc(p.id)}">Editar jogador</button>`:"—"}</td></tr>`))):empty("Nenhum jogador cadastrado nesta equipe.")}<p class="muted">Cartões, faltas e pontos são registrados na partida. Consulte Estatísticas para os lances dos jogos selecionados.</p></section>`;
 if(teamProfileTab==="games")content=`<section class="card"><h3>Jogos da equipe</h3>${matchScopeButtons("team",teamGameScope)}<p class="muted">Finalizadas inclui encerradas, homologadas e canceladas. Os dados e as súmulas permanecem salvos.</p></section><div class="grid">${scopeMatches(games,teamGameScope).map(m=>matchCard(m,true)).join("")||empty("Nenhuma partida corresponde a esta equipe e aos filtros.")}</div>${role!=="admin"?'<p>Esta conta vê somente suas partidas atribuídas.</p>':""}`;
 if(teamProfileTab==="stats"){
  const stats=teamStatistics(games,t.id),ready=C.demo||teamEventsKey===teamMatchKey(),events=ready?teamAthleteEvents(games,t.id):[];
  content=`<section class="card"><h3>Resultados por modalidade</h3><p>Somente partidas encerradas ou homologadas. No vôlei, o resultado conta sets; nas demais modalidades, o placar. As modalidades não são somadas entre si.</p>${stats.length?table(["Modalidade","Jogos","Vitórias","Empates","Derrotas","A favor","Contra"],stats.map(r=>tr([r.sport,r.games,r.wins,r.draws,r.losses,r.for,r.against]))):empty("Ainda não há partidas concluídas nesta seleção.")}</section><section class="card"><h3>Jogadores, cartões e faltas</h3><p>Lances dos jogos selecionados, incluindo jogos em andamento e excluindo cancelados. Pontos/gols dos lances consideram os estornos registrados. Lances sem atleta ficam em uma linha própria.</p>${!C.demo?`<button type="button" data-profile-events ${teamProfileBusy?"disabled":""}>${teamProfileBusy?"Carregando…":"Carregar / atualizar lances"}</button>`:""}${ready?(events.length?table(["Modalidade","Jogador","Pontos/gols dos lances","Amarelos","Vermelhos","Faltas"],events.map(r=>tr([r.sport,r.player,r.points,r.yellow,r.red,r.fouls]))):empty("Nenhum lance correspondente carregado.")):empty("Carregue os lances para consultar cartões, faltas e pontuação individual.")}</section>`;
 }
 if(teamProfileTab==="history")content=`<section class="card"><h3>Alterações da equipe e elenco</h3><button type="button" data-profile-history ${teamProfileBusy?"disabled":""}>${teamProfileBusy?"Consultando…":"Carregar / atualizar histórico"}</button><p class="muted">Consulta sob demanda, exclusiva do administrador principal. Datas em horário de Brasília.</p>${teamHistoryOutput()}</section>`;
 return `<section class="card team-profile-heading"><button type="button" data-profile-back>← Voltar às equipes</button><div class="team-profile-title">${badge(t)}<div><span class="tag">FICHA DA EQUIPE • ${t.archived?"ARQUIVADA":"ATIVA"}</span><h2>${esc(t.name)}</h2><p>Técnico(a): ${esc(t.coach||"Não informado")}</p></div></div><nav aria-label="Ficha da equipe">${tabs.map(([id,label])=>`<button type="button" data-profile-tab="${id}" class="${id===teamProfileTab?"active":""}">${label}</button>`).join("")}</nav>${["games","stats"].includes(teamProfileTab)?`<div class="formgrid"><label>Modalidade na ficha<select data-profile-sport><option value="">Todas as modalidades</option>${D.SPORTS.map(s=>`<option ${s===teamProfileSport?"selected":""}>${esc(s)}</option>`).join("")}</select></label><label>Campeonato / temporada<select data-profile-champ><option value="">Todos os campeonatos</option>${championships.map(([id,label])=>`<option value="${esc(id)}" ${id===teamProfileChamp?"selected":""}>${esc(label)}</option>`).join("")}</select></label></div>`:""}</section>${content}`;
}
function openTeamEditor(id){
 if(!canManageRosters())return;const t=state.teams.find(t=>t.id===id);if(!t)return;
 selectedTeamId="";teamFormVisible=true;teamEditorId=id;teamProfileBusy=false;teamProfileRequest++;section="teams";render();const f=$("#team");if(!f)return;
 for(const key of ["name","short","coach","category"]){f.elements[key].value=t[key]||"";}f.elements.recordId.value=t.id;
 for(const o of f.elements.sports.options)o.selected=(t.sports||[]).includes(o.value);
 setBadgeDraft(t.badge||"");f.scrollIntoView({block:"start"});f.elements.name.focus({preventScroll:true});toast("Altere os dados e clique em Salvar equipe.");
}
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-team-profile],[data-profile-back],[data-profile-tab],[data-profile-edit],[data-profile-archive],[data-profile-new-player],[data-profile-player],[data-profile-events],[data-profile-history]");if(!b)return;
 try{
  if(!canManageRosters())throw Error("Conta sem acesso aos cadastros.");
  if(b.dataset.teamProfile){teamProfileBusy=false;selectedTeamId=b.dataset.teamProfile;teamGameScope="active";teamProfileTab=["roster","games"].includes(b.dataset.initialTeamTab)?b.dataset.initialTeamTab:"data";teamProfileSport="";teamProfileChamp="";teamHistoryRows=[];teamHistoryLoaded=false;teamEventsKey="";teamProfileRequest++;section="teams";teamPlayerDraft=null;render();return;}
  if(b.hasAttribute("data-profile-back")){teamPlayerDraft=null;teamFormVisible=false;teamEditorId="";selectedTeamId="";teamProfileBusy=false;teamProfileRequest++;render();return;}
  if(b.dataset.profileTab){if(["stats","history"].includes(b.dataset.profileTab)&&role!=="admin")return;teamProfileTab=b.dataset.profileTab;teamPlayerDraft=null;render();return;}
  if(b.hasAttribute("data-profile-edit")){openTeamEditor(selectedTeamId);return;}
  const teamId=b.dataset.profileArchive || selectedTeamId,t=state.teams.find(t=>t.id===teamId);if(!t)return;
  if(b.hasAttribute("data-profile-archive")){
   if(role!=="admin")throw Error("Exclusivo do administrador principal.");
   const reason=prompt((t.archived?"Motivo para reativar ":"Motivo para arquivar ")+t.name+" (5 a 500 caracteres):");if(reason===null)return;
   await dispatch({type:"teamArchive",teamId,archived:!t.archived,reason});teamHistoryLoaded=false;return;
  }
  if(b.hasAttribute("data-profile-new-player")||b.dataset.profilePlayer){
   if(t.archived)throw Error("Reative a equipe antes de alterar seu elenco.");
   const player=b.dataset.profilePlayer?state.players.find(p=>p.id===b.dataset.profilePlayer&&p.team===teamId):null;
   if(b.dataset.profilePlayer&&!player)throw Error("Jogador não encontrado nesta equipe.");
   teamPlayerDraft=player?{...player}:{name:"",number:"",position:"",reserve:false};
   teamProfileTab="roster";render();$("#team-player")?.scrollIntoView({block:"center"});$("#team-player")?.elements.name.focus({preventScroll:true});return;
  }
  if(role!=="admin"||teamProfileBusy)return;
  const request=++teamProfileRequest;teamProfileBusy=true;refresh();
  try{
   if(b.hasAttribute("data-profile-history")){
    const rows=C.demo?(state.teamLocalAudit||[]).filter(r=>(r.entity==="teams"&&r.target===teamId)||(r.entity==="players"&&(r.before?.team===teamId||r.after?.team===teamId))).slice().reverse():await cloud.teamHistory(teamId);
    if(request!==teamProfileRequest||role!=="admin"||selectedTeamId!==teamId)return;teamHistoryRows=rows;teamHistoryLoaded=true;
   }else{const fingerprint=teamMatchKey();if(!C.demo)await cloud.loadHistory(teamMatches().map(m=>m.id));if(request===teamProfileRequest&&role==="admin"&&selectedTeamId===teamId)teamEventsKey=fingerprint;}
  }finally{if(request===teamProfileRequest){teamProfileBusy=false;render();}}
 }catch(error){teamProfileBusy=false;toast(error.message,true);render();}
});
document.addEventListener("change",e=>{if(!canManageRosters())return;if(e.target.hasAttribute("data-profile-sport")){teamProfileSport=e.target.value;render();}if(e.target.hasAttribute("data-profile-champ")){teamProfileChamp=e.target.value;render();}});

function teamRegistrationView(){return `<div class="card"><h3>Dados do cadastro</h3><form id="team"><input name="recordId" type="hidden"><div class="formgrid">${field("Nome da equipe", "name", "text", 'required maxlength="150"')}${field("Sigla", "short", "text", 'maxlength="12"')}${field("Técnico(a)", "coach")}${field("Categoria", "category")}<label>Modalidades da equipe (Ctrl+clique para várias)<select name="sports" multiple size="6">${D.SPORTS.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select><small>Cadastro da equipe. Não altera a modalidade das partidas existentes.</small></label><input name="badge" type="hidden"><label>Imagem do escudo / bandeira<input id="badgeFile" type="file" accept="image/png,image/jpeg,image/webp"><small>Escolha uma imagem do computador. O painel reduz seu tamanho automaticamente.</small></label><label>Ou endereço HTTPS da imagem<input name="badgeURL" type="url" placeholder="https://..."></label><div class="logo-preview" id="badgePreview">${badge({ name: "Time", short: "TIME", badge: "" })}<button type="button" data-remove-badge>Remover imagem</button></div></div><button class="primary">Salvar equipe</button> <button type="button" data-section="imports">Importar equipes</button></form></div>`;}
// 25 — Navegação clara. Lista primeiro; formulários somente ao cadastrar/editar.
let teamFormVisible=false,teamEditorId="";
function teamDirectoryCard(t){
 const roster=state.players.filter(p=>p.team===t.id).length;
 const games=state.matches.filter(m=>[m.home,m.away].includes(t.id)).length;
 return `<article class="card team-directory-card"><div class="team-directory-title">${badge(t)}<span class="status">${t.archived?"Arquivada":"Ativa"}</span></div><h3>${esc(t.name)}</h3><p class="muted">${esc(t.category||"Categoria não informada")}<br>Técnico(a): ${esc(t.coach||"Não informado")}<br>${esc(teamSports(t).join(" • ")||"Modalidade não informada")}</p><p>${roster} jogador(es) • ${games} ${role==="admin"?"partida(s)":"partida(s) autorizada(s)"}</p><div class="toolbar"><button type="button" class="primary" data-team-profile="${esc(t.id)}">Ver dados da equipe</button><details style="width:100%"><summary>Mais ações</summary><div class="toolbar" style="margin-top:8px"><button type="button" data-team-profile="${esc(t.id)}" data-initial-team-tab="roster">Jogadores</button><button type="button" data-team-profile="${esc(t.id)}" data-initial-team-tab="games">Jogos</button><button type="button" data-edit-team="${esc(t.id)}">Editar cadastro</button> ${role==="admin" ? `<button type="button" data-profile-archive="${esc(t.id)}">${t.archived?"Reativar equipe":"Arquivar equipe"}</button>` : ""}</div></details></div></article>`;
}
function teamsDirectoryView(){
 if(teamFormVisible)return `<div class="sectionhead"><h2>${teamEditorId?"Editar equipe":"Nova equipe"}</h2><button type="button" data-team-form-back>← Voltar à lista de equipes</button></div>${teamRegistrationView()}`;
 return `<div class="sectionhead team-directory-heading"><div><h2>Equipes</h2><p>Escolha uma equipe abaixo. Em <strong>Ver dados da equipe</strong> você encontra técnico, modalidades, elenco e jogos.</p></div><div class="toolbar"><button type="button" class="primary" data-new-team-form>+ Nova equipe</button><button type="button" data-section="imports">Importar equipes</button></div></div>${listPanel("teams")}`;
}
function locationTrail(){
 const labels={overview:"Visão geral",matches:"Acompanhar jogos",championships:"Campeonatos",standings:"Classificação",teams:"Equipes",players:"Jogadores",imports:"Importar",documentation:"Guias",matchSheets:"Súmulas",reports:"Relatórios esportivos",auditReports:"Relatório geral",certificates:"Certificados",monitor:"Operadores e partidas",users:"Usuários e permissões",settings:"Configurações",cleanup:"Limpeza de testes",testData:"Dados de teste",credentials:"Credenciais de eventos",account:"Minha conta"};
 if(section==="account")return '<nav class="location-trail" aria-label="Localização atual"><span>Você está em:</span><strong>Minha conta</strong></nav>';
 const group=workspaceDefinitions.find(g=>g.sections.includes(section));
 const profile=section==="teams"&&selectedTeamId?state.teams.find(t=>t.id===selectedTeamId):null;
 const tabs={data:"Dados e técnico",roster:"Jogadores",games:"Jogos da equipe",stats:"Estatísticas, cartões e faltas",history:"Histórico de alterações"};
 return `<nav class="location-trail noprint" aria-label="Localização atual"><span>Você está em:</span>${group?`<button type="button" data-workspace="${group.id}">${group.title}</button><span aria-hidden="true">›</span>`:""}${profile||section==="teams"&&teamFormVisible?'<button type="button" data-team-form-back>Equipes</button>':`<strong>${esc(labels[section]||section)}</strong>`}${profile?`<span aria-hidden="true">›</span><span>${esc(profile.name)}</span><span aria-hidden="true">›</span><strong>${esc(tabs[teamProfileTab]||"Dados e técnico")}</strong>`:section==="teams"&&teamFormVisible?`<span aria-hidden="true">›</span><strong>${teamEditorId?"Editar equipe":"Nova equipe"}</strong>`:""}</nav>`;
}
document.addEventListener("click",e=>{
 if(!e.target.closest("[data-new-team-form],[data-team-form-back]"))return;
 if(!canManageRosters())return;
 selectedTeamId="";teamProfileBusy=false;teamProfileRequest++;teamEditorId="";
 teamFormVisible=!!e.target.closest("[data-new-team-form]");section="teams";render();
 if(teamFormVisible){$("#team")?.scrollIntoView({block:"start"});$("#team")?.elements.name.focus({preventScroll:true});}
});

// 26 — Editor do elenco dentro da equipe. Usa a mesma gravação e auditoria dos cadastros.
function teamPlayerEditor(t){
 if(!teamPlayerDraft||t.archived)return "";
 const p=teamPlayerDraft,v=k=>esc(p[k]||"");
 return `<section class="team-player-editor" aria-labelledby="teamPlayerTitle"><h4 id="teamPlayerTitle">${p.id?"Editar jogador":"Novo jogador"} • ${esc(t.name)}</h4><form id="team-player"><div class="formgrid"><label>Nome do jogador<input name="name" required maxlength="150" value="${v("name")}" autocomplete="off"></label><label>Número da camisa<input name="number" maxlength="8" value="${v("number")}"></label><label>Posição<input name="position" maxlength="50" value="${v("position")}" placeholder="Ex.: goleiro, zagueiro, atacante"></label><label>Escalação no cadastro<select name="reserve"><option value="false" ${!p.reserve?"selected":""}>Titular</option><option value="true" ${p.reserve?"selected":""}>Reserva / banco</option></select></label></div><p class="muted">Salva no elenco atual de ${esc(t.name)}. Não altera jogadores ou escalações das súmulas já criadas. O administrador principal pode consultar a alteração em Histórico de alterações.</p><div class="toolbar"><button class="primary">${p.id?"Salvar alterações do jogador":"Salvar jogador nesta equipe"}</button><button type="button" data-player-editor-cancel>Cancelar edição</button></div></form></section>`;
}
document.addEventListener("click",e=>{if(e.target.closest("[data-player-editor-cancel]")){teamPlayerDraft=null;render();}});

// 27 — Operação guiada. A transição para Ao vivo já inicia o relógio no modelo auditado.
// Se o jogo já estiver Ao vivo, o atalho envia apenas a ação de iniciar o relógio.
let guidedStartBusy=false;
function matchStartGuide(m){
 const ended=["Encerrada","Homologada","Cancelada"].includes(m.status),running=!!m.clock?.running,live=m.status==="Ao vivo";
 const label=live?(running?"Jogo ao vivo e relógio em andamento":"Jogo ao vivo • relógio parado"):ended?"Partida finalizada ou bloqueada":["Pausada","Suspensa"].includes(m.status)?"Partida interrompida":"Prepare o início da partida";
 return `<section class="card match-guide"><span class="tag">MESA DE OPERAÇÃO</span><h3 data-clock-guide-label>${label}</h3><p>${ended?"Confira a súmula e o histórico. Reabrir exige administrador e justificativa.":running?"Use os botões de pontuação para registrar os lances. Pausar o jogo também para o cronômetro.":"Confira as equipes e a etapa. Você pode configurar o tempo antes de começar ou usar o relógio atual."}</p>${!ended?`<div class="toolbar">${!running?`<button type="button" class="primary" data-guided-start ${guidedStartBusy?"disabled":""}>${live?"Iniciar cronômetro":["Pausada","Suspensa"].includes(m.status)?"Retomar jogo e cronômetro":"Iniciar jogo e cronômetro"}</button><button type="button" data-open-clock>Configurar tempo</button>`:""}</div><small>Iniciar/retomar preserva o tempo acumulado. Ajustes e mudanças de etapa continuam disponíveis abaixo.</small>`:""}</section>`;
}
function updateArenaFavicon(){
 const logo=state.settings.logo||"";
 const safe=/^https:\/\//i.test(logo)||/^data:image\/(png|jpeg|webp);base64,/i.test(logo);
 const url=safe?logo:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111c24"/><text x="32" y="46" text-anchor="middle" font-size="44" fill="#baff55" font-family="Arial">A</text></svg>');
 let icon=document.getElementById("arenaFavicon");
 if(!icon){icon=document.createElement("link");icon.id="arenaFavicon";icon.rel="icon";document.head.appendChild(icon);}
 if(icon.getAttribute("href")!==url){icon.removeAttribute("type");icon.href=url;}
}
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-guided-start],[data-open-clock],[data-clock-preset]");if(!b||!admin||!selected)return;
 const m=state.matches.find(m=>m.id===selected);if(!m)return;
 try{
  if(b.hasAttribute("data-open-clock")){const d=$("#clockSettings");if(d){d.open=true;d.scrollIntoView({block:"center"});}return;}
  if(b.dataset.clockPreset){if(m.clock?.running)throw Error("Pare o relógio antes de configurar.");const f=$("#clock-config");f.elements.durationMin.value=b.dataset.clockPreset;f.elements.clockReason.value="Configuração de duração da etapa: "+b.dataset.clockPreset+" minutos";toast("Duração preenchida. Confira o modo e clique em Salvar ajuste do cronômetro.");return;}
  if(guidedStartBusy||busy)return;
  if(!["Agendada","Adiada","Pausada","Suspensa","Ao vivo"].includes(m.status))throw Error("Esta partida não pode iniciar por este atalho.");
  const matchId=m.id;guidedStartBusy=true;b.disabled=true;
  if(m.status!=="Ao vivo")await dispatch({type:"status",matchId,status:"Ao vivo",reason:["Pausada","Suspensa"].includes(m.status)?"Retomada pela mesa de operação":"Início pela mesa de operação"});
  else await dispatch({type:"clock",matchId,command:"iniciar"});
  toast("Partida ao vivo com cronômetro iniciado.");
 }catch(error){toast(error.message,true);}finally{if(guidedStartBusy){guidedStartBusy=false;render();}}
});
function publicSportSummary(){
 const matches=state.matches.filter(m=>(!publicFilter||m.sport===publicFilter)&&["Encerrada","Homologada"].includes(m.status));
 if(!matches.length)return "";
 const groups=new Map();
 for(const m of matches){const score=gameResult(m);if(!Array.isArray(score)||!score.every(n=>Number.isInteger(n)&&n>=0))continue;const r=groups.get(m.sport)||{games:0,total:0};r.games++;r.total+=score[0]+score[1];groups.set(m.sport,r);}
 if(!groups.size)return "";
 return `<details class="card public-sport-summary"><summary>Estatísticas por modalidade • jogos concluídos</summary><p>Somente partidas encerradas ou homologadas nesta seleção. No vôlei, contamos sets vencidos; as modalidades ficam separadas.</p>${table(["Modalidade","Jogos","Total","Média por jogo"],[...groups].sort(([a],[b])=>a.localeCompare(b,"pt-BR")).map(([sport,r])=>tr([sport,r.games,r.total+" "+(sport.startsWith("Vôlei")?"sets":sport==="Futebol"||sport==="Futsal"||sport==="Handebol"?"gols":"pontos"),(r.total/r.games).toLocaleString("pt-BR",{maximumFractionDigits:1})])))}</details>`;
}
// Jogos do público são locais: nenhuma resposta escreve resultados no Firebase.
let fanActivity="quiz",memoryDeck=[],memoryOpen=[],memoryMatched=[],memoryMoves=0;
const memorySymbols=["⚽","🏀","🏐","🏆","🥇","🎯"];
function resetMemory(){memoryDeck=memorySymbols.flatMap((symbol,pair)=>[{symbol,pair},{symbol,pair}]);for(let i=memoryDeck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[memoryDeck[i],memoryDeck[j]]=[memoryDeck[j],memoryDeck[i]];}memoryOpen=[];memoryMatched=[];memoryMoves=0;}
function fanZone(){
 if(!memoryDeck.length)resetMemory();
 const memory=`<section class="card"><span class="tag">JOGO DA MEMÓRIA</span><h2>Encontre os pares esportivos</h2><p>Abra duas cartas. Quando forem diferentes, clique em Virar novamente para continuar.</p><p role="status">${memoryMatched.length/2} de 6 pares • ${memoryMoves} tentativa(s)${memoryMatched.length===12?" • Parabéns, você completou!":""}</p><div class="memory-grid">${memoryDeck.map((card,i)=>{const show=memoryOpen.includes(i)||memoryMatched.includes(i);return `<button type="button" data-memory-card="${i}" aria-label="${show?card.symbol:"Carta "+(i+1)+", fechada"}" ${show||memoryOpen.length===2?"disabled":""}>${show?card.symbol:"?"}</button>`;}).join("")}</div><div class="toolbar">${memoryOpen.length===2?'<button type="button" data-memory-turn>Virar novamente</button>':""}<button type="button" data-memory-reset>Reiniciar memória</button></div></section>`;
 return `<section class="card fan-welcome"><span class="tag">ARQUIBANCADA INTERATIVA</span><h2>Torça, acompanhe e divirta-se</h2><p>Os jogos continuam nas abas Ao vivo e Agenda. As brincadeiras são individuais e não alteram placares nem criam rankings públicos.</p><nav class="toolbar" aria-label="Brincadeiras"><button type="button" data-fan-activity="quiz" aria-pressed="${fanActivity==="quiz"}">Quiz esportivo</button><button type="button" data-fan-activity="memory" aria-pressed="${fanActivity==="memory"}">Memória esportiva</button></nav></section>${fanActivity==="memory"?memory:publicChallenge()}`;
}
document.addEventListener("click",e=>{
 if(admin)return;const b=e.target.closest("[data-fan-activity],[data-memory-card],[data-memory-turn],[data-memory-reset]");if(!b)return;
 if(b.dataset.fanActivity)fanActivity=b.dataset.fanActivity;
 if(b.hasAttribute("data-memory-reset"))resetMemory();
 if(b.hasAttribute("data-memory-turn"))memoryOpen=[];
 if(b.hasAttribute("data-memory-card")){const i=Number(b.dataset.memoryCard);if(!Number.isInteger(i)||!memoryDeck[i]||memoryOpen.length===2||memoryOpen.includes(i)||memoryMatched.includes(i))return;memoryOpen.push(i);if(memoryOpen.length===2){memoryMoves++;if(memoryDeck[memoryOpen[0]].pair===memoryDeck[memoryOpen[1]].pair){memoryMatched.push(...memoryOpen);memoryOpen=[];}}}
 const out=$("#publicHubContent");if(out)out.innerHTML=fanZone();
});

// 28 — Visualizações iniciais mostram os jogos atuais. Nunca remove registros do estado.
let overviewGameScope="active";
function scopeMatches(matches,scope){return matches.filter(m=>scope==="all"||(scope==="finished"?finalStatuses.includes(m.status):!finalStatuses.includes(m.status)));}
function matchScopeButtons(area,value){return `<div class="list-groups" aria-label="Visualização dos jogos">${[["active","Atuais e próximas"],["finished","Finalizadas"],["all","Todas"]].map(([scope,label])=>`<button type="button" data-match-scope="${scope}" data-scope-area="${area}" class="${value===scope?"primary":""}" aria-pressed="${value===scope}">${label}</button>`).join("")}</div>`;}
const shortcutStorageKey = "arena-shortcuts-v1";
function getStoredShortcuts(){
  try {
    const raw = localStorage.getItem(shortcutStorageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function saveStoredShortcuts(value){
  try {
    localStorage.setItem(shortcutStorageKey, JSON.stringify(value));
  } catch {
    // Sem armazenamento persistente, segue com a ordem padrão.
  }
}
function getShortcutCatalog(){
  const actions = [];
  if (role === "admin") {
    actions.push({ id: "overview", label: "Home", detail: "Resumo geral" });
    actions.push({ id: "createMatch", label: "Nova partida", detail: "Programar jogo" });
    actions.push({ id: "championships", label: "Novo campeonato", detail: "Criar edição" });
    actions.push({ id: "teams", label: "Equipes", detail: "Cadastrar times" });
    actions.push({ id: "players", label: "Jogadores", detail: "Cadastrar elenco" });
    actions.push({ id: "users", label: "Operadores", detail: "Aprovar acessos" });
    actions.push({ id: "settings", label: "Configurações", detail: "Logo e identidade" });
  } else {
    if (canManageRosters()) {
      actions.push({ id: "teams", label: "Equipes", detail: "Cadastrar e editar" });
      actions.push({ id: "players", label: "Jogadores", detail: "Atualizar elenco" });
    }
    if (canManageChampionships()) {
      actions.push({ id: "championships", label: "Campeonatos", detail: "Gerenciar temporadas" });
    }
    if (canCreateMatches()) {
      actions.push({ id: "createMatch", label: "Nova partida", detail: "Programar jogo" });
    }
    if (canViewAllGames() || role === "operator") {
      actions.push({ id: "matches", label: "Acompanhar jogos", detail: "Consultar partidas" });
    }
    if (canManageRosters()) {
      actions.push({ id: "imports", label: "Importar", detail: "Planilha de cadastros" });
    }
    actions.push({ id: "overview", label: "Home", detail: "Resumo geral" });
  }
  if(role==="admin")for(const [id,label] of [["matches","Acompanhar jogos"],["standings","Classificação"],["imports","Importar"],["matchSheets","Súmulas"],["reports","Relatórios esportivos"],["auditReports","Auditoria geral"],["certificates","Certificados"],["testData","Dados de teste"],["credentials","Credenciais de eventos"],["monitor","Operadores e partidas"],["cleanup","Limpeza de testes"],["documentation","Guias e suporte"],["account","Minha conta"]])if(!actions.some(a=>a.id===id))actions.push({id,label,detail:"Abrir "+label.toLowerCase()});
  return actions.filter((action) => action.id && (action.id === "overview" || role === "admin" || ["teams","players","championships","createMatch","matches","imports"].includes(action.id)));
}
function getVisibleShortcuts(){
  const catalog = getShortcutCatalog();
  const stored = getStoredShortcuts() || { order: [], hidden: {} };
  const ordered = stored.order && stored.order.length ? stored.order : catalog.map((a) => a.id);
  const hidden = stored.hidden || {};
  const visible = [];
  for (const id of ordered) {
    const match = catalog.find((action) => action.id === id);
    if (!match) continue;
    if (hidden[id]) continue;
    visible.push(match);
  }
  for (const item of catalog) {
    if (!visible.some((action) => action.id === item.id) && !hidden[item.id]) visible.push(item);
  }
  return visible;
}
function persistShortcutOrder(ids){
  const stored = getStoredShortcuts() || { order: [], hidden: {} };
  const hidden = stored.hidden || {};
  saveStoredShortcuts({ order: ids, hidden });
}
function toggleShortcut(id, hide = false){
  const stored = getStoredShortcuts() || { order: [], hidden: {} };
  const hidden = stored.hidden || {};
  if (hide) hidden[id] = true; else delete hidden[id];
  const order = (stored.order && stored.order.length ? stored.order : getShortcutCatalog().map((action) => action.id));
  if (!order.includes(id)) order.push(id);
  saveStoredShortcuts({ order, hidden });
}
function moveShortcut(id, dir){
  const visible = getVisibleShortcuts();
  const index = visible.findIndex((item) => item.id === id);
  if (index < 0) return;
  const targetIndex = Math.max(0, Math.min(visible.length - 1, index + dir));
  const reordered = [...visible];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved);
  const order = reordered.map((item) => item.id);
  persistShortcutOrder(order);
}
function quickActionCards(){
  const actions = getVisibleShortcuts();
  if (!actions.length) return "";
  return `<section class="card"><h2>Atalhos rápidos</h2><div class="shortcut-toolbar"><button type="button" data-shortcut-customize class="secondary-button">Personalizar atalhos</button></div><p class="muted">Ações mais usadas por ${role === "admin" ? "o administrador" : "o operador"}. Todos os acessos seguem as permissões atribuídas.</p><div class="grid">${actions.map(({id,label,detail})=>`<div class="shortcut-panel"><div class="shortcut-header"><button type="button" data-section="${id}" class="shortcut-primary"><strong>${esc(label)}</strong><small>${esc(detail)}</small></button><div class="shortcut-tools"><button type="button" data-shortcut-move="up" data-shortcut-target="${id}" title="Mover para cima" aria-label="Mover ${esc(label)} para cima">↑</button><button type="button" data-shortcut-move="down" data-shortcut-target="${id}" title="Mover para baixo" aria-label="Mover ${esc(label)} para baixo">↓</button><button type="button" data-shortcut-hide="${id}" title="Ocultar atalho" aria-label="Ocultar ${esc(label)}">✕</button></div></div></div>`).join("")}</div></section>`;
}

function operatorStartPanel(showTasks = false) {
  const assigned = state.matches.filter(match =>
    !finalStatuses.includes(match.status) &&
    ((trainingMode && !operatorPermissions.includes("gamesView")) || cloud?.canOperate(match.id))
  ).sort((a, b) => Number(b.status === "Ao vivo") - Number(a.status === "Ao vivo") ||
    String(a.date || "").localeCompare(String(b.date || "")));
  const games = assigned.slice(0, 3).map(match =>
    `<button type="button" class="shortcut-primary" data-open="${esc(match.id)}"><strong>${esc(name(match.home))} × ${esc(name(match.away))}</strong><small>${esc(match.status)} · ${esc(match.sport)} · ${esc(format(match.date))}</small><span>Operar partida →</span></button>`
  ).join("");
  const tasks = [
    ["matches", "Acompanhar jogos", "Consulte as partidas disponíveis para sua conta."],
    ["documentation", "Como operar", "Abra o guia antes de iniciar sua primeira partida."]
  ];
  if (canCreateMatches()) tasks.push(["createMatch", "Cadastrar partida", "Escolha as equipes, a modalidade e o horário."]);
  if (canManageRosters()) {
    tasks.push(["teams", "Equipes", "Confira ou atualize os times."]);
    tasks.push(["players", "Jogadores", "Cadastre ou edite o elenco."]);
  }
  return `<section class="card"><h2>Minhas partidas para operar</h2>
    ${games ? `<div class="grid">${games}</div>` : '<p class="muted">Nenhuma partida atual atribuída para operação. Em Administração → Usuários e permissões, o administrador pode autorizar o campeonato inteiro ou atribuir partidas específicas a esta conta. Para consultar os jogos publicados, use Painel público.</p>'}
    ${operatorEditions.length ? '<p><button type="button" data-section="matches">Meus campeonatos</button></p>' : ""}
    ${assigned.length > 3 ? '<p><button type="button" data-section="matches">Ver todas as partidas disponíveis</button></p>' : ""}
  </section>${showTasks ? `<section class="card"><h2>O que você quer fazer?</h2><div class="grid">
    ${tasks.map(([id, title, detail]) => `<button type="button" class="shortcut-primary" data-section="${id}"><strong>${title}</strong><small>${detail}</small></button>`).join("")}
  </div></section>` : ""}`;
}

function overviewMatchView(){
 const rows=scopeMatches(state.matches,overviewGameScope).slice().sort((a,b)=>{if(overviewGameScope!=="finished"){const priority=m=>m.status==="Ao vivo"?0:m.status==="Pausada"?1:2;const d=priority(a)-priority(b);if(d)return d;}return overviewGameScope==="finished"?new Date(b.date)-new Date(a.date):new Date(a.date)-new Date(b.date);});
 return `<details class="card arena-quick-actions"><summary>Ações rápidas e personalização</summary>${quickActionCards()}</details><div class="grid">${[["Equipes",state.teams.length,"teams"],["Jogadores",state.players.length,"players"],["Partidas ao vivo",state.matches.filter(m=>m.status==="Ao vivo").length,"live"]].filter(([, , target]) => target === "live" || canManageRosters()).map(([label,n,target]) =>
  `<button type="button" class="card overview-shortcut" ${target === "live" ? 'data-games-shortcut="live"' : `data-section="${target}"`}><span>${label}</span><strong class="kpi">${n}</strong></button>`).join("")}</div><section class="card"><h2>Quadra e campo</h2>${matchScopeButtons("overview",overviewGameScope)}<p class="muted">Jogos encerrados ficam em Finalizadas. Esta seleção muda apenas a visualização.</p></section><div class="grid">${rows.slice(0,6).map(m=>matchCard(m,true)).join("")||empty(overviewGameScope==="active"?"Nenhuma partida atual. Consulte Finalizadas ou programe um novo jogo.":"Nenhuma partida nesta seleção.")}</div>${rows.length>6?'<p>Exibindo seis partidas. Abra Jogos → Acompanhar jogos para consultar a lista completa.</p>':""}`;
}
document.addEventListener("click",e=>{
 const b=e.target.closest("[data-match-scope]");if(!b||!admin||!['active','finished','all'].includes(b.dataset.matchScope))return;
 if(b.dataset.scopeArea==="overview")overviewGameScope=b.dataset.matchScope;
 if(b.dataset.scopeArea==="team")teamGameScope=b.dataset.matchScope;
 render();
});
document.addEventListener("click",e=>{
  const customize=e.target.closest("[data-shortcut-customize]");
  if(customize){
    const current = getVisibleShortcuts();
    const all = getShortcutCatalog();
    const stored = getStoredShortcuts() || { order: [], hidden: {} };
    const hidden = stored.hidden || {};
    const choices = all.map((item) => ({ ...item, hidden: !!hidden[item.id] || !current.some((x) => x.id === item.id) }));
    const html = `<section class="card"><h2>Personalizar atalhos</h2><p class="muted">Ocultar ou reorganizar ações rápidas, sem alterar as permissões da conta.</p><div class="shortcut-config">${choices.map((item) => `<div class="shortcut-config-row ${item.hidden ? "is-hidden" : ""}"><span><strong>${esc(item.label)}</strong><small>${esc(item.detail)}</small></span><div class="shortcut-config-actions"><button type="button" data-shortcut-hide="${item.id}" ${item.hidden ? "" : "class=\"primary\""}>${item.hidden ? "Mostrar" : "Ocultar"}</button></div></div>`).join("")}</div><div class="toolbar"><button type="button" data-shortcut-reset class="primary">Restaurar padrão</button><button type="button" data-section="overview">Voltar para tela inicial</button></div></section>`;
    const panel = document.getElementById("view");
    if (panel) panel.innerHTML = html;
    return;
  }
  const move = e.target.closest("[data-shortcut-move]");
  if (move) {
    const dir = move.dataset.shortcutMove === "up" ? -1 : 1;
    moveShortcut(move.dataset.shortcutTarget, dir);
    render();
    return;
  }
  const hide = e.target.closest("[data-shortcut-hide]");
  if (hide && hide.dataset.shortcutHide) {
    toggleShortcut(hide.dataset.shortcutHide, !getStoredShortcuts()?.hidden?.[hide.dataset.shortcutHide]);
    render();
    return;
  }
  const reset = e.target.closest("[data-shortcut-reset]");
  if (reset) {
    saveStoredShortcuts({ order: [], hidden: {} });
    render();
  }
});

// 29 — Navegação expansível e busca local. Resultados respeitam o perfil atual.
let navigationQuery="";
const expandedNavigation=new Set();
const navigationDescriptions={
 overview:{label:"Visão geral",description:"Resumo dos jogos atuais e consulta das finalizadas.",keywords:"inicio home encerradas finalizadas atuais próximas"},
 matches:{label:"Acompanhar jogos",description:"Consultar jogos próximos, ao vivo e encerrados; operar somente os atribuídos.",keywords:"gol gols ponto pontos iniciar tempo relogio pausa intervalo etapa cartao cartões faltas substituicoes var estorno anular arbitragem juiz local futebol basquete volei"},
 createMatch:{label:"Cadastrar partida",description:"Programar uma nova partida (se autorizado).",keywords:"criar cadastrar programar nova jogo partida"},
 championships:{label:"Campeonatos",description:"Cadastrar competições e temporadas (se autorizado).",keywords:"competicao torneio campeonato temporada edicao categoria"},
 standings:{label:"Classificação",description:"Consultar tabela e classificação do campeonato de futebol.",keywords:"tabela ranking saldo vitorias pontos"},
 teams:{label:"Equipes",description:"Consultar e editar times, escudos, técnicos e elencos.",keywords:"time equipe bandeira escudo tecnico treinador modalidades arquivar reativar ficha elenco historico"},
 players:{label:"Jogadores",description:"Cadastrar e editar atletas, camisa, posição e titular/reserva.",keywords:"jogador atleta numero camisa posicao titular reserva banco elenco"},
 documentation:{label:"Guias e documentação",description:"Orientações e links para usar em outro computador.",keywords:"ajuda manual guia documento link computador compartilhar"},
 matchSheets:{label:"Súmulas",description:"Visualizar súmulas de partidas e salvar em PDF ou JSON.",keywords:"sumula partida jogo imprimir pdf json evento histórico"},
 reports:{label:"Relatórios esportivos",description:"Consultar resultados e baixar relatório em PDF, Excel ou JSON.",keywords:"relatorio esportivo placar resultado equipe campeonato pdf excel json exportar"},
 auditReports:{label:"Relatório geral",description:"Consultar alterações administrativas e exportar em PDF, Excel ou JSON.",keywords:"auditoria alterações historico administrativo acesso permissao pdf excel json"},
 certificates:{label:"Certificados",description:"Emitir certificados e salvar a visualização em PDF ou os dados em JSON.",keywords:"certificado certificação participação institucional atleta equipe campeonato evento pdf json"},
 monitor:{label:"Operadores e partidas",description:"Consultar operadores e distribuição dos jogos.",keywords:"monitoramento operador atribuicao distribuicao responsavel"},
 users:{label:"Usuários e permissões",description:"Aprovar, bloquear e definir acessos dos operadores.",keywords:"usuario conta acesso permissao convite cadastro link aprovar bloquear autorizar"},
 settings:{label:"Configurações",description:"Alterar título, cor, capa, logo e identidade visual.",keywords:"logotipo logo favicon icone aba titulo nome cor imagem capa configuracao"},
 testData:{label:"Dados de teste",description:"Reservar testes ao administrador sem excluir dados ou contas.",keywords:"teste testes ocultar reservar restaurar preparar proteção"},
 credentials:{label:"Credenciais de eventos",description:"Emitir, imprimir e revogar crachás de identificação por evento.",keywords:"credencial credenciais cracha crachas identificação organização apoio operador validade"},
 cleanup:{label:"Limpeza de testes",description:"Conferir cópia e excluir partidas de teste com registro.",keywords:"limpeza teste excluir apagar exclusoes historico"},
 account:{label:"Minha conta",description:"Identificação, segurança, redefinição de senha e vínculo Google.",keywords:"email senha recuperar google vincular login conta sair"},
 imports:{label:"Importar",description:"Importar equipes e jogadores por planilha ou texto.",keywords:"importacao arquivo csv excel xlsx colar lista nomes"}
};
function navigationSearchResults(){
 if(!navigationQuery.trim())return "";
 const allowed=new Set([...workspaceDefinitions.flatMap(g=>allowedWorkspaceSections(g)),"account"]);
 const words=searchText(navigationQuery).split(/\s+/).filter(Boolean);
 const found=Object.entries(navigationDescriptions).filter(([id,item])=>allowed.has(id)&&words.every(word=>searchText([item.label,item.description,item.keywords].join(" ")).includes(word)));
 return `<p class="muted">${found.length} função(ões) encontrada(s)</p><div class="navigation-search-results">${found.map(([id,item])=>`<button type="button" data-section="${id}" data-navigation-result><strong>${esc(item.label)}</strong><small>${esc(workspaceDefinitions.find(g=>g.sections.includes(id))?.title||"Conta")} › ${esc(item.description)}</small></button>`).join("")||'<p>Nenhuma função encontrada. Tente uma palavra como jogador, relógio ou relatório.</p>'}</div>`;
}
document.addEventListener("input",e=>{if(e.target.id!=="functionSearch")return;navigationQuery=e.target.value;const out=$("#navigationSearchResults");if(out)out.innerHTML=navigationSearchResults();});
// Accordion: explorar uma área fecha somente os outros menus, sem trocar a tela.
document.addEventListener("toggle",e=>{const group=e.target.dataset?.navigationGroup;if(!group)return;if(e.target.open){expandedNavigation.clear();expandedNavigation.add(group);for(const other of document.querySelectorAll("[data-navigation-group]"))if(other!==e.target)other.open=false;}else expandedNavigation.delete(group);},true);
document.addEventListener("click",e=>{
 if(e.target.closest("[data-clear-navigation-search]")){navigationQuery="";const input=$("#functionSearch");if(input){input.value="";input.focus();}const out=$("#navigationSearchResults");if(out)out.innerHTML="";}
 if(e.target.closest("[data-navigation-result],.navigation-options [data-section]")){navigationQuery="";expandedNavigation.clear();for(const d of document.querySelectorAll("[data-navigation-group]"))d.open=false;const input=$("#functionSearch");if(input)input.value="";const out=$("#navigationSearchResults");if(out)out.innerHTML="";$("#view")?.scrollIntoView({block:"start"});}
});

// 32 — Indicador de sincronização: sem faixa técnica no uso normal.
// A confirmação vem das notificações existentes do Firestore, sem consultas extras.
let connectionState={kind:"waiting",label:"Conectando…",message:"Aguardando confirmação da conexão.",confirmedAt:null};
function connectionAccountPanel(){return `<section class="connection-account" aria-label="Conexão do sistema"><strong>Conexão do sistema</strong><p data-connection-label></p><small data-connection-detail></small></section>`;}
function setConnectionStatus(raw){
 const text=String(raw||"").toLocaleLowerCase("pt-BR");
 if(C.demo)connectionState={kind:"demo",label:"Demonstração local",message:"Dados fictícios neste navegador; nenhum resultado real é alterado.",confirmedAt:null};
 else if(text.includes("offline")||navigator.onLine===false)connectionState={...connectionState,kind:"offline",label:"Sem internet",message:"Atualizações interrompidas. Os resultados exibidos podem estar desatualizados."};
 else if(/cota|indisponível|indisponivel|permissão|permissao/.test(text))connectionState={...connectionState,kind:"warning",label:"Atualização indisponível",message:"Não foi possível confirmar as atualizações. Os resultados exibidos podem estar desatualizados."};
 else if(/cache|aguardando|conectando/.test(text))connectionState={...connectionState,kind:"waiting",needsConfirmation:connectionState.needsConfirmation||["offline","warning"].includes(connectionState.kind),label:"Conectando…",message:"Aguardando confirmação das atualizações."};
 else if(text.includes("conectado"))connectionState={kind:"connected",label:"Conexão ativa",message:"Atualizações automáticas habilitadas.",confirmedAt:new Date()};
 else connectionState={...connectionState,kind:"ready",label:"Pronto para entrar",message:"Entre com sua conta para acessar a central."};
 renderConnectionStatus();
}
function renderConnectionStatus(){
 const c=connectionState,bar=$("#mode");
 if(bar){bar.hidden=!["offline","warning","demo"].includes(c.kind)&&!c.needsConfirmation;bar.classList.toggle("connection-alert",["offline","warning"].includes(c.kind)||!!c.needsConfirmation);bar.textContent=c.kind==="demo"?"DEMONSTRAÇÃO ISOLADA • dados fictícios • nenhum resultado real é alterado":c.message;bar.setAttribute("role","status");}
 const footer=document.querySelector("footer");
 if(footer&&!footer.querySelector("#connectionIndicator")){const el=document.createElement("details");el.id="connectionIndicator";el.className="connection-indicator noprint";el.innerHTML='<summary><span data-connection-dot class="connection-dot" aria-hidden="true"></span><span>Conexão</span></summary><div><strong data-connection-label></strong><p data-connection-detail></p></div>';footer.appendChild(el);}
 const detail=c.message+(c.confirmedAt?" Última confirmação: "+c.confirmedAt.toLocaleTimeString("pt-BR")+".":"");
 for(const el of document.querySelectorAll("[data-connection-dot]")){el.dataset.state=c.kind;el.title=c.label;}
 for(const el of document.querySelectorAll("[data-connection-label]"))el.textContent=c.label;
 for(const el of document.querySelectorAll("[data-connection-detail]"))el.textContent=detail;
 const button=$("#accountMenuToggle");if(button)button.title="Minha conta • "+c.label;
}

boot();

// 30 — Navegação intencional: posiciona somente após abrir uma função.
// Não acompanha snapshots, cronômetro, placar, filtros nem gravações de lances.
function navigationDestination(control){
 const routes=[
  ['data-my-account','#view'],['data-account-settings','#view'],
  ['data-section','#view'],['data-workspace','#view'],
  ['data-open','#view'],['data-back','#view'],
  ['data-access-mode','#app'],['data-access-edit','#access-user'],
  ['data-access-cancel','#view'],
  ['data-edit-championship','#championship'],['data-new-championship','#championship'],
  ['data-championship-games','#list-results-matches'],
  ['data-new-team-form','#team'],['data-team-form-back','#view'],
  ['data-edit-team','#team'],['data-edit-player','#player'],
  ['data-team-profile','.team-profile-heading'],['data-profile-back','#view'],
  ['data-profile-tab','.team-profile-heading + .card'],
  ['data-profile-edit','#team'],['data-profile-new-player','.team-player-editor'],
  ['data-profile-player','.team-player-editor'],['data-player-editor-cancel','.team-profile-heading'],
  ['data-public-area','#publicHubContent'],['data-open-clock','#clockSettings']
 ];
 return routes.find(([attribute])=>control.hasAttribute(attribute))?.[1]||null;
}
function revealNavigationDestination(selector){
 const container=document.querySelector(selector);if(!container)return;
 // Os diálogos abertos gerenciam seu próprio foco.
 if(document.querySelector('dialog[open]'))return;
 const heading=container.matches('h1,h2,h3,h4')?container:container.querySelector('h1,h2,h3,h4');
 const target=heading||container;
 target.setAttribute('tabindex','-1');
 target.style.scrollMarginTop='24px';
 target.focus({preventScroll:true});
 target.scrollIntoView({block:'start',behavior:'instant'});
}
let navigationRevealFrame=0;
document.addEventListener('click',event=>{
 const control=event.target.closest('button,a');
 if(!control||control.disabled||control.getAttribute('aria-disabled')==='true')return;
 const selector=navigationDestination(control);if(!selector)return;
 const before=document.querySelector(selector),beforeContent=before?.firstElementChild;
 if(navigationRevealFrame)cancelAnimationFrame(navigationRevealFrame);
 navigationRevealFrame=requestAnimationFrame(()=>{
  navigationRevealFrame=0;
  if(event.defaultPrevented)return;
  const after=document.querySelector(selector);
  // Ação recusada sem mudança de conteúdo não desloca a página.
  const editsInPlace=control.hasAttribute('data-edit-player');
  if(!after||after===before&&after.firstElementChild===beforeContent&&!editsInPlace)return;
  revealNavigationDestination(selector);
 });
},true);

// 31 — Público: preferências e ajuda agrupadas; acessibilidade sempre à mão.
function setupPublicTools(){
 if(admin)return;
 const bar=document.querySelector('.accessibility-bar');if(!bar)return;
 const tools=document.createElement('details');tools.id='publicTools';tools.className='public-tools';
 const summary=document.createElement('summary');summary.textContent='Preferências e ajuda';
 const controls=document.createElement('div');controls.className='public-tools-options';
 tools.append(summary,controls);
 for(const item of bar.querySelectorAll(':scope > .preferences-entry,:scope > [data-open-tutorial],:scope > [data-training-entry]'))controls.append(item);
 const organizationLink=document.querySelector('header a[href*="painel.html"]');
 const actions=organizationLink?.parentElement;
 if(actions){actions.classList.add('public-header-actions');actions.insertBefore(tools,organizationLink);}
 else bar.prepend(tools);
 document.addEventListener('click',event=>{
  if(event.target.closest('#publicTools button,#publicTools a')||!event.target.closest('#publicTools'))tools.open=false;
 });
 tools.addEventListener('keydown',event=>{if(event.key==='Escape'){tools.open=false;summary.focus();}});
}
setupPublicTools();

// Navegação da página, fora do conteúdo substituído por render().
function setupBackToTop() {
  if (document.getElementById("arenaPageNavigation")) return;
  const navigation = document.createElement("nav");
  navigation.id = "arenaPageNavigation";
  navigation.className = "arena-page-navigation noprint";
  navigation.setAttribute("aria-label", "Navegação rápida da página");
  const makeButton = (direction, label, path) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "arena-page-arrow";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
    button.addEventListener("click", () => {
      const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({top: direction === "up" ? 0 : height, behavior: reduceMotion ? "instant" : "smooth"});
    });
    navigation.append(button);
    return button;
  };
  const up = makeButton("up", "Ir ao topo da página", "M12 19V5 M5 12l7-7 7 7");
  const down = makeButton("down", "Ir ao fim da página", "M12 5v14 M5 12l7 7 7-7");
  navigation.hidden = true;
  document.body.append(navigation);
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    const bottom = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
    navigation.hidden = bottom <= 8;
    up.disabled = top <= 8;
    down.disabled = top >= bottom - 8;
  };
  const schedule = () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  };
  window.addEventListener("scroll", schedule, {passive:true});
  window.addEventListener("resize", schedule, {passive:true});
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(schedule).observe(document.body);
  update();
}
setupBackToTop();

// Dados de teste ficam no banco, separados da operação e sem excluir contas.
function activeSportsState(raw) {
  const next={...raw};
  for(const entity of ["teams","players","championships","matches"])next[entity]=(raw[entity]||[]).filter(r=>r.testData!==true);
  return next;
}
const testEntities={championships:"Campeonato",matches:"Partida",teams:"Equipe",players:"Jogador"};
let testOnlyReserved=false,testSearch="",testSelection=new Set(),testPlan=null,testBackup=false,testClassBusy=false,testDetail="";
function testRecords(raw=testRawState||state) {
  return Object.entries(testEntities).flatMap(([entity,label])=>(raw[entity]||[]).map(data=>({entity,id:data.id,label,data})));
}
function testRecordName(row,raw=testRawState||state) {
  const d=row.data;
  const teamName=id=>(raw.teams||[]).find(t=>t.id===id)?.name||id;
  return row.entity==="matches"?`${teamName(d.home)} × ${teamName(d.away)} • ${d.competition||"Avulsa"} • ${format(d.date)}`:row.entity==="championships"?`${d.name} • ${d.season} • ${d.sport}`:row.entity==="players"?`${d.name} • ${teamName(d.team)} • camisa ${d.number||"—"}`:d.name;
}
function planTestClassification(rows,selected,hidden) {
  const map=new Map(rows.map(r=>[r.entity+"/"+r.id,r])),chosen=new Set(selected);
  let changed=true;
  const add=(entity,id)=>{const key=entity+"/"+id;if(map.has(key)&&!chosen.has(key)){chosen.add(key);changed=true;}};
  while(changed){changed=false;
    for(const key of [...chosen]){
      const r=map.get(key);if(!r)continue;const d=r.data;
      if(hidden){
        if(r.entity==="championships")for(const m of rows.filter(x=>x.entity==="matches"&&x.data.championshipId===r.id))add(m.entity,m.id);
        if(r.entity==="teams"){for(const child of rows.filter(x=>(x.entity==="players"&&x.data.team===r.id)||(x.entity==="matches"&&[x.data.home,x.data.away].includes(r.id))))add(child.entity,child.id);}
        if(r.entity==="players")for(const m of rows.filter(x=>x.entity==="matches"&&(x.data.roster||[]).some(p=>p.id===r.id)))add(m.entity,m.id);
      }else{
        if(r.entity==="matches"){add("championships",d.championshipId);add("teams",d.home);add("teams",d.away);for(const p of d.roster||[])add("players",p.id);}
        if(r.entity==="players")add("teams",d.team);
      }
    }
  }
  const order=hidden?["matches","players","teams","championships"]:["championships","teams","players","matches"];
  return [...chosen].map(k=>map.get(k)).filter(r=>r && (r.data.testData===true)!==hidden).sort((a,b)=>order.indexOf(a.entity)-order.indexOf(b.entity));
}
function testDetailPanel() {
  const row=testRecords().find(r=>r.entity+"/"+r.id===testDetail);if(!row)return "";
  const events=row.entity==="matches"?(row.data.events||[]):[];
  return `<section class="card"><h3>Detalhes privados • ${esc(testRecordName(row))}</h3><p>${row.data.testData?"Reservado ao administrador":"Disponível nas telas normais"} • ID ${esc(row.id)}</p>${row.entity==="matches"?`<p>Placar: ${esc((row.data.score||[]).join(" × "))} • Situação: ${esc(row.data.status)}</p><button type="button" data-test-history="${esc(row.id)}">Carregar histórico privado desta partida</button>${table(["Data","Acontecimento","Descrição privada","Responsável"],events.map(e=>tr([format(e.at),eventLabel(e,row.data),eventDescription(e),responsibleLabel(e)])))}`:""}<details><summary>Consultar todos os campos do registro</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(row.data,(_k,v)=>v?.toDate?v.toDate().toISOString():v,2))}</pre></details></section>`;
}
function testDataPanel() {
  const rows=testRecords(),legacy=rows.filter(r=>typeof r.data.testData!=="boolean");
  const query=testSearch.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const visible=rows.filter(r=>(r.data.testData===true)===testOnlyReserved && (r.label+" "+testRecordName(r)).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(query));
  return `<section class="card"><h2>Dados de teste</h2><p>Área exclusiva do administrador. Os dados reservados deixam as telas normais, o público e o acesso dos operadores. Contas, senhas e configurações são preservadas. Os dados continuam armazenados.</p><p><strong>Ao restaurar, as autorizações antigas desses registros voltam a valer.</strong> A operação pausa gravações esportivas temporariamente.</p>${C.demo?'<p>Classificação real indisponível no treinamento.</p>':`<div class="toolbar"><button type="button" data-test-prepare ${testClassBusy||!legacy.length?"disabled":""}>Preparar proteção dos registros antigos (${legacy.length})</button><button type="button" data-test-unlock ${testClassBusy?"disabled":""}>Liberar operação após interrupção</button></div>`}<p>Prepare os registros antigos uma vez após instalar. Isso não os marca como teste. Até a preparação, algumas consultas dos operadores podem ficar vazias.</p><div class="toolbar"><button type="button" data-test-scope="normal" class="${!testOnlyReserved?"primary":""}">Disponíveis (${rows.filter(r=>!r.data.testData).length})</button><button type="button" data-test-scope="reserved" class="${testOnlyReserved?"primary":""}">Reservados ao administrador (${rows.filter(r=>r.data.testData).length})</button></div><label>Pesquisar registros<input name="test-search" type="search" value="${esc(testSearch)}"></label><p>Selecione registros e confira a prévia dos vínculos antes de confirmar. Uma equipe compartilhada pode incluir partidas reais: revise todos os itens da prévia.</p><div class="toolbar"><button type="button" data-test-select-all ${testClassBusy?"disabled":""}>Selecionar os exibidos</button><button type="button" data-test-select-clear ${testClassBusy?"disabled":""}>Limpar seleção</button></div><div class="tablewrap"><table><thead><tr><th>Selecionar</th><th>Tipo</th><th>Registro</th></tr></thead><tbody>${visible.slice(0,500).map(r=>`<tr><td><input type="checkbox" data-test-select="${esc(r.entity+"/"+r.id)}" aria-label="Selecionar ${esc(testRecordName(r))}" ${testSelection.has(r.entity+"/"+r.id)?"checked":""} ${testClassBusy?"disabled":""}></td><td>${r.label}</td><td>${esc(testRecordName(r))}<br><button type="button" data-test-detail="${esc(r.entity+"/"+r.id)}">Ver detalhes</button></td></tr>`).join("")}</tbody></table></div><p>${visible.length} registro(s). Mostrando até 500; refine a pesquisa se necessário.</p><button type="button" data-test-preview ${testClassBusy||!testSelection.size||C.demo?"disabled":""}>Conferir ${testOnlyReserved?"restauração":"reserva de testes"} e vínculos</button>${testDetailPanel()}${testPlan?`<section class="public-notice"><h3>Prévia • ${testPlan.items.length} registro(s)</h3><p>Nenhum dado será apagado. Confira todos os registros incluídos automaticamente pelos vínculos.</p><ul>${testPlan.items.map(r=>`<li>${r.label}: ${esc(testRecordName(r))}</li>`).join("")}</ul><button type="button" data-test-backup>Baixar cópia privada desta seleção</button><form id="test-classify"><label>Motivo<textarea name="reason" required minlength="5" maxlength="300"></textarea></label><label>Digite ${testPlan.hidden?"RESERVAR":"RESTAURAR"}<input name="word" autocomplete="off" required></label><button class="primary" ${testClassBusy||!testBackup?"disabled":""}>Confirmar ${testPlan.hidden?"reserva":"restauração"}</button></form><p>A cópia contém dados privados e não possui importação automática. Guarde-a em local restrito.</p></section>`:""}</section>`;
}
async function runTestClassification(items,hidden,reason) {
  if(role!=="admin"||C.demo)throw Error("Use a conta administrativa real.");
  if(testClassBusy)throw Error("Aguarde a classificação atual.");
  const unsafe=items.find(r=>r.entity==="matches"&&(r.data.clock?.running||["Ao vivo","Pausada","Suspensa"].includes(r.data.status)));
  if(unsafe)throw Error("Finalize primeiro: "+testRecordName(unsafe));
  testClassBusy=true;render();
  try{await cloud.classifyTestRecords(items.map(({entity,id})=>({entity,id})),hidden,reason,(done,total)=>toast(`Classificando ${done} de ${total}…`));testSelection.clear();testPlan=null;testBackup=false;toast("Classificação concluída. Contas e senhas foram preservadas.");}
  catch(error){throw Error(error.message+" Os registros já processados foram preservados. Confira as duas listas antes de retomar.");}
  finally{testClassBusy=false;render();}
}
document.addEventListener("change",e=>{
 if(role!=="admin")return;
 if(e.target.name==="test-search"){testSearch=e.target.value;render();}
 if(e.target.matches("[data-test-select]")){const key=e.target.dataset.testSelect;e.target.checked?testSelection.add(key):testSelection.delete(key);testPlan=null;testBackup=false;render();}
});
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-test-scope],[data-test-preview],[data-test-backup],[data-test-prepare],[data-test-unlock],[data-test-detail],[data-test-history],[data-test-select-all],[data-test-select-clear]");if(!b||role!=="admin")return;
 try{
  if(b.hasAttribute("data-test-select-all")){for(const el of document.querySelectorAll("[data-test-select]"))testSelection.add(el.dataset.testSelect);testPlan=null;testBackup=false;render();}
  if(b.hasAttribute("data-test-select-clear")){testSelection.clear();testPlan=null;testBackup=false;render();}
  if(b.dataset.testDetail){testDetail=b.dataset.testDetail;render();}
  if(b.dataset.testHistory){await cloud.loadHistory([b.dataset.testHistory]);render();}
  if(b.dataset.testScope){testOnlyReserved=b.dataset.testScope==="reserved";testSelection.clear();testPlan=null;testBackup=false;render();}
  if(b.hasAttribute("data-test-preview")){const items=planTestClassification(testRecords(),testSelection,!testOnlyReserved);if(!items.length)throw Error("Nenhum registro precisa mudar.");testPlan={items,hidden:!testOnlyReserved};testBackup=false;render();}
  if(b.hasAttribute("data-test-backup")&&testPlan){download("arena-selecao-testes-privada.json",JSON.stringify({format:"arena-testes-v1",at:new Date().toISOString(),records:testPlan.items},(_k,v)=>v?.toDate?v.toDate().toISOString():v,2));testBackup=true;render();}
  if(b.hasAttribute("data-test-prepare")){const legacy=testRecords().filter(r=>typeof r.data.testData!=="boolean").slice(0,500);await runTestClassification(legacy,false,"Preparação da proteção de dados de teste");}
  if(b.hasAttribute("data-test-unlock")){if(!confirm("Use somente se nenhuma classificação estiver em execução em outra aba. Liberar as gravações esportivas?"))return;await cloud.testMaintenance(false);toast("Operação liberada.");}
 }catch(error){toast(error.message,true);}
});
document.addEventListener("submit",async e=>{
 if(e.target.id!=="test-classify")return;e.preventDefault();
 try{if(role!=="admin"||!testPlan||!testBackup)throw Error("Confira a seleção e baixe a cópia.");const data=new FormData(e.target);if(String(data.get("word")).trim()!==(testPlan.hidden?"RESERVAR":"RESTAURAR"))throw Error("Confira a palavra de confirmação.");await runTestClassification(testPlan.items,testPlan.hidden,String(data.get("reason")));}catch(error){toast(error.message,true);}
});

// Preferências pessoais: não alteram a aparência global nem concedem permissões.
function personalCatalog() {
  if(!admin)return [["active","Jogos atuais"],["live","Ao vivo"],["schedule","Agenda"],["results","Resultados"],["teams","Equipes"],["standings","Classificação"],["fun","Diversão"]].map(([id,label])=>({id,label,public:true}));
  const items=getShortcutCatalog();
  for(const [id,label] of [["account","Minha conta"],["documentation","Guias e suporte"]])if(!items.some(i=>i.id===id))items.push({id,label});
  return items;
}
function personalStorageKey() { return "arena-personal-tools-v1:"+(admin?"central:":"publico:")+(trainingMode?"treino-"+role:user?.uid||"publico"); }
function readPersonalTools() {
  try { const data=JSON.parse(localStorage.getItem(personalStorageKey())||"null")||{};
    return {pins:Array.isArray(data.pins)?data.pins.filter(x=>typeof x==="string"):[],favorites:Array.isArray(data.favorites)?data.favorites.filter(x=>typeof x==="string"):[],colors:data.colors&&typeof data.colors==="object"?data.colors:{}};
  } catch {return {pins:[],favorites:[],colors:{}};}
}
function savePersonalTools(value) {try{localStorage.setItem(personalStorageKey(),JSON.stringify(value));}catch{throw Error("O navegador não permitiu salvar suas preferências.");}}
function personalTopShortcuts() {
  const data=readPersonalTools(),catalog=personalCatalog(),button=(id,favorite=false)=>{
    const item=catalog.find(i=>i.id===id);return item?`<button type="button" ${item.public?"data-public-area":"data-section"}="${esc(id)}">${favorite?"★ ":""}${esc(item.label)}</button>`:"";
  };
  return `<section class="personal-shortcuts noprint" aria-label="Meus atalhos"><div class="toolbar"><strong>Meus atalhos</strong>${data.pins.map(id=>button(id)).join("")}<button type="button" data-personal-settings>Escolher atalhos e favoritos</button>${admin?'<a class="button" href="./index.html" target="_blank" rel="noopener">Painel público ↗</a>':""}</div>${data.favorites.length?`<div class="toolbar" aria-label="Favoritos">${data.favorites.map(id=>button(id,true)).join("")}</div>`:""}<small>Preferências desta conta neste navegador. Clique com o botão direito, segure uma aba ou use Escolher atalhos e favoritos.</small></section>`;
}
function personalTarget(el) {
  const b=el?.closest?.("button[data-section],button[data-public-area]");
  if(!b)return null;const id=admin?b.dataset.section:b.dataset.publicArea;
  return personalCatalog().some(item=>item.id===id)?{button:b,id}:null;
}
function applyPersonalColors() {
  const colors=readPersonalTools().colors;
  for(const b of app.querySelectorAll("button[data-section],button[data-public-area]")){
    const id=admin?b.dataset.section:b.dataset.publicArea,color=colors[id];
    if(/^#[0-9a-f]{6}$/i.test(color||"")){
      const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
      b.style.backgroundColor=color;b.style.color=(rgb[0]*299+rgb[1]*587+rgb[2]*114)/1000>150?"#101820":"#ffffff";
      b.dataset.personalColor="true";
    }else if(b.dataset.personalColor){b.style.removeProperty("background-color");b.style.removeProperty("color");delete b.dataset.personalColor;}
  }
}
function showPersonalTools(id=null) {
  let dialog=$("#arenaPersonalTools");
  if(!dialog){dialog=document.createElement("dialog");dialog.id="arenaPersonalTools";dialog.className="personal-tools-dialog noprint";dialog.setAttribute("aria-labelledby","personalToolsTitle");document.body.append(dialog);}
  const data=readPersonalTools(),catalog=personalCatalog(),item=catalog.find(i=>i.id===id);
  const colors=[["#145678","Azul"],["#216b43","Verde"],["#75419b","Roxo"],["#923b41","Vermelho"],["#f0bc42","Amarelo"],["#cf6b28","Laranja"]];
  dialog.innerHTML=`<h2 id="personalToolsTitle">${item?esc(item.label):"Atalhos e favoritos"}</h2><p>Preferências locais desta conta. As permissões e a aparência global permanecem independentes.</p>${item?`<div class="toolbar"><button type="button" data-personal-toggle="pins" data-personal-id="${esc(id)}">${data.pins.includes(id)?"Retirar dos atalhos":"Adicionar aos atalhos"}</button><button type="button" data-personal-toggle="favorites" data-personal-id="${esc(id)}">${data.favorites.includes(id)?"Retirar dos favoritos":"Adicionar aos favoritos"}</button></div><h3>Cor desta aba</h3><div class="toolbar">${colors.map(([color,label])=>`<button type="button" data-personal-color="${color}" data-personal-id="${esc(id)}" style="border-bottom:5px solid ${color}">${label}</button>`).join("")}<button type="button" data-personal-color="default" data-personal-id="${esc(id)}">Cor padrão</button></div>`:`<div class="tablewrap"><table><thead><tr><th>Função</th><th>Atalho no topo</th><th>Favorito</th><th>Ordem dos atalhos</th><th>Opções</th></tr></thead><tbody>${[...catalog].sort((a,b)=>{const rank=x=>data.pins.includes(x)?data.pins.indexOf(x):999;return rank(a.id)-rank(b.id);}).map(i=>`<tr><td>${esc(i.label)}</td><td><button type="button" data-personal-toggle="pins" data-personal-id="${esc(i.id)}" aria-pressed="${data.pins.includes(i.id)}">${data.pins.includes(i.id)?"Retirar":"Adicionar"}</button></td><td><button type="button" data-personal-toggle="favorites" data-personal-id="${esc(i.id)}" aria-pressed="${data.favorites.includes(i.id)}">${data.favorites.includes(i.id)?"★ Sim":"☆ Não"}</button></td><td>${data.pins.includes(i.id)?`<button type="button" data-personal-move="-1" data-personal-id="${esc(i.id)}" aria-label="Mover ${esc(i.label)} para cima">↑</button><button type="button" data-personal-move="1" data-personal-id="${esc(i.id)}" aria-label="Mover ${esc(i.label)} para baixo">↓</button>`:""}</td><td><button type="button" data-personal-options="${esc(i.id)}">Cor e opções</button></td></tr>`).join("")}</tbody></table></div>`}<div class="toolbar">${item?'<button type="button" data-personal-settings>Todos os atalhos</button>':""}<button type="button" data-personal-close>Fechar</button></div>`;
  dialog.dataset.item=id||"";if(!dialog.open)dialog.showModal();
}
document.addEventListener("contextmenu",e=>{const target=personalTarget(e.target);if(!target)return;e.preventDefault();showPersonalTools(target.id);});
let personalPressTimer=null,personalPress=null,personalSuppressUntil=0;
document.addEventListener("pointerdown",e=>{
 if(!["touch","pen"].includes(e.pointerType)||e.isPrimary===false)return;const target=personalTarget(e.target);if(!target)return;
 clearTimeout(personalPressTimer);personalPress={x:e.clientX,y:e.clientY,id:target.id};
 personalPressTimer=setTimeout(()=>{personalSuppressUntil=Date.now()+1200;showPersonalTools(target.id);personalPress=null;},650);
},{passive:true});
const cancelPersonalPress=()=>{clearTimeout(personalPressTimer);personalPress=null;};
document.addEventListener("pointermove",e=>{if(personalPress&&Math.hypot(e.clientX-personalPress.x,e.clientY-personalPress.y)>10)cancelPersonalPress();},{passive:true});
for(const event of ["pointerup","pointercancel","scroll"])document.addEventListener(event,cancelPersonalPress,{passive:true,capture:true});
document.addEventListener("click",e=>{if(Date.now()<personalSuppressUntil && !e.target.closest("#arenaPersonalTools")){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener("click",e=>{
 const b=e.target.closest("[data-personal-settings],[data-personal-options],[data-personal-toggle],[data-personal-color],[data-personal-move],[data-personal-close]");if(!b)return;
 try{
  if(b.hasAttribute("data-personal-close")){$("#arenaPersonalTools")?.close();return;}
  if(b.hasAttribute("data-personal-settings")){showPersonalTools();return;}
  if(b.dataset.personalOptions){showPersonalTools(b.dataset.personalOptions);return;}
  const id=b.dataset.personalId;if(!personalCatalog().some(i=>i.id===id))throw Error("Função não disponível para sua conta.");
  const data=readPersonalTools(),dialog=$("#arenaPersonalTools"),current=dialog?.dataset.item||null;
  if(b.dataset.personalToggle){const key=b.dataset.personalToggle;if(!["pins","favorites"].includes(key))return;data[key]=data[key].includes(id)?data[key].filter(x=>x!==id):[...data[key],id];}
  if(b.dataset.personalColor){if(b.dataset.personalColor==="default")delete data.colors[id];else data.colors[id]=b.dataset.personalColor;}
  if(b.dataset.personalMove){const i=data.pins.indexOf(id),j=Math.max(0,Math.min(data.pins.length-1,i+Number(b.dataset.personalMove)));if(i>=0)[data.pins[i],data.pins[j]]=[data.pins[j],data.pins[i]];}
  savePersonalTools(data);render();applyPersonalColors();showPersonalTools(current);
 }catch(error){toast(error.message,true);}
});
new MutationObserver(()=>applyPersonalColors()).observe(app,{childList:true,subtree:true});
applyPersonalColors();

// Crachás de evento: identificação documental, sem autoridade de login.
let credentialRows=[],credentialLoaded=false,credentialBusy=false,credentialQuery="",credentialStatus="ativa";
function credentialIsExpired(record) {
  const now=new Date(),today=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
  return !!record.validUntil && record.validUntil<today;
}
function credentialsPanel() {
  const query=credentialQuery.toLocaleLowerCase("pt-BR");
  const all=credentialRows.filter(r=>state.championships.some(c=>c.id===r.eventId));
  const rows=all.filter(r=>(!credentialStatus||r.status===credentialStatus)&&[r.name,r.function,r.organization,r.id].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  return `<section class="card"><h2>Credenciais de eventos</h2><p>Crachás de identificação para operadores, organização, arbitragem e apoio. Não criam contas e não concedem permissões no sistema. A lista e a emissão são exclusivas do administrador.</p><form id="event-credential"><div class="formgrid"><label>Evento / campeonato<select name="eventId" required><option value="">Selecione</option>${state.championships.map(c=>`<option value="${esc(c.id)}">${esc(championshipTitle(c)+" • "+c.sport+(c.category?" • "+c.category:""))}</option>`).join("")}</select></label><label>Conta existente opcional<select name="credentialUser"><option value="">Pessoa sem conta vinculada</option>${(state.users||[]).filter(u=>!u.deleted).map(u=>`<option value="${esc(u.id)}">${esc(u.name||u.email||u.id)}</option>`).join("")}</select></label><label>Nome completo<input name="name" maxlength="150" required></label><label>Função<input name="function" list="credentialFunctions" maxlength="80" required></label><datalist id="credentialFunctions"><option>Operador</option><option>Organização</option><option>Arbitragem</option><option>Apoio</option><option>Equipe técnica</option><option>Imprensa</option></datalist><label>Organização / equipe<input name="organization" maxlength="150"></label><label>Válida até<input type="date" name="validUntil" required></label></div><button class="primary" ${C.demo||credentialBusy||!state.championships.length?"disabled":""}>Emitir e salvar credencial</button></form><p>O código é um identificador para conferência nesta lista, sem validação pública online. A revogação não altera um crachá já impresso: a organização deve consultar a situação atual.</p></section><section class="card"><h3>Credenciais emitidas</h3><div class="toolbar"><button type="button" data-credential-load ${C.demo||credentialBusy?"disabled":""}>${credentialLoaded?"Atualizar credenciais":"Consultar credenciais"}</button></div><div class="formgrid"><label>Pesquisar nome, função ou código<input name="credential-query" value="${esc(credentialQuery)}"></label><label>Situação<select name="credential-status"><option value="ativa" ${credentialStatus==="ativa"?"selected":""}>Ativas</option><option value="revogada" ${credentialStatus==="revogada"?"selected":""}>Revogadas</option><option value="" ${!credentialStatus?"selected":""}>Todas</option></select></label></div>${!credentialLoaded?'<p>Consulte a lista para carregar os registros do banco.</p>':`<div class="tablewrap"><table><thead><tr><th>Pessoa / código</th><th>Evento</th><th>Função / organização</th><th>Validade / situação</th><th>Ações</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}<small class="cell-sub">${esc(r.id)}</small></td><td>${esc(championshipTitle(state.championships.find(c=>c.id===r.eventId)))}</td><td>${esc(r.function)}<small class="cell-sub">${esc(r.organization)}</small></td><td>${esc(r.validUntil||"Não informada")}<br>${esc(r.status)}${credentialIsExpired(r)?" • VENCIDA":""}</td><td><button type="button" data-credential-print="${esc(r.id)}">Visualizar / imprimir</button>${r.status==="ativa"?`<button type="button" data-credential-revoke="${esc(r.id)}">Revogar</button>`:""}</td></tr>`).join("")}</tbody></table></div><p>${rows.length} credencial(is). Eventos reservados como teste não entram nesta lista.</p>`}</section>`;
}
function printEventCredential(record) {
  const event=state.championships.find(c=>c.id===record.eventId);if(!event)throw Error("Evento indisponível nesta área.");
  const win=window.open("","_blank");if(!win)throw Error("Permita abrir a visualização de impressão neste navegador.");
  const logo=state.settings.logo||"",safe=/^https:\/\//i.test(logo)||/^data:image\/(png|jpeg|webp);base64,/i.test(logo);
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Credencial • ${esc(record.name)}</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#142832;background:#fff}.badge{width:90mm;min-height:130mm;border:2px solid #183e52;border-radius:5mm;padding:7mm;margin:10mm auto;text-align:center;overflow-wrap:anywhere}.logo{height:18mm;max-width:65mm;object-fit:contain}.function{padding:4mm;background:#163f55;color:#fff;font-size:22px;font-weight:bold}.name{font-size:24px;font-weight:bold;margin:9mm 0}.code{font-size:10px;margin-top:7mm}.status{font-weight:bold;color:${record.status==="revogada"?"#9b1c1c":"#174f30"}}.tools{text-align:center}@media print{.tools{display:none}}</style></head><body><div class="tools"><button onclick="window.print()">Imprimir / salvar em PDF</button></div><article class="badge">${safe?`<img class="logo" src="${esc(logo)}" alt="Logo da organização">`:""}<p>${esc(state.settings.title)}</p><h2>${esc(championshipTitle(event))}</h2><p>${esc(event.sport+(event.category?" • "+event.category:""))}</p><div class="function">${esc(record.function)}</div><div class="name">${esc(record.name)}</div><p>${esc(record.organization||"Organização do evento")}</p><p>Válida até ${esc(record.validUntil||"Não informada")}</p><p class="status">${record.status!=="ativa"?"CREDENCIAL REVOGADA":credentialIsExpired(record)?"CREDENCIAL VENCIDA":"CREDENCIAL ATIVA"}</p><p class="code">Código ${esc(record.id)}<br>Conferência pela organização na lista de credenciais.<br>Identificação de evento sem concessão de acesso ao sistema.</p><p class="code">WagnerBIZZA • Arena</p></article></body></html>`;
  win.opener=null;win.document.open();win.document.write(html);win.document.close();
}
document.addEventListener("change",e=>{
 if(role!=="admin")return;
 if(e.target.name==="credentialUser"){const person=(state.users||[]).find(u=>u.id===e.target.value);if(person)e.target.form.elements.name.value=person.name||"";}
 if(e.target.name==="credential-query"){credentialQuery=e.target.value;render();}
 if(e.target.name==="credential-status"){credentialStatus=e.target.value;render();}
});
document.addEventListener("submit",async e=>{
 if(e.target.id!=="event-credential")return;e.preventDefault();
 try{if(role!=="admin"||C.demo)throw Error("Emissão exclusiva do administrador conectado.");if(credentialBusy)return;const data=Object.fromEntries(new FormData(e.target));credentialBusy=true;render();await cloud.issueCredential({...data,userId:data.credentialUser});credentialRows=await cloud.eventCredentials();credentialLoaded=true;toast("Credencial emitida. Use Visualizar / imprimir na lista.");}catch(error){toast(error.message,true);}finally{credentialBusy=false;render();}
});
document.addEventListener("click",async e=>{
 const b=e.target.closest("[data-credential-load],[data-credential-print],[data-credential-revoke]");if(!b||role!=="admin")return;
 try{
  if(b.hasAttribute("data-credential-load")){if(C.demo)throw Error("Use a conta administrativa real.");credentialRows=await cloud.eventCredentials();credentialLoaded=true;render();}
  if(b.dataset.credentialPrint){const record=credentialRows.find(r=>r.id===b.dataset.credentialPrint);if(record)printEventCredential(record);}
  if(b.dataset.credentialRevoke){if(!confirm("Revogar esta credencial? Isso não bloqueia a conta da pessoa no sistema."))return;await cloud.revokeCredential(b.dataset.credentialRevoke);credentialRows=await cloud.eventCredentials();render();toast("Credencial revogada.");}
 }catch(error){toast(error.message,true);}
});
