(() => {
  const source = "https://raw.githubusercontent.com/wagnerbizza/arena-esportiva/arena-dados-noticias/noticias.json";
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
  let request;
  let fetchedAt = 0;

  function loadNews() {
    if (request && Date.now() - fetchedAt < 15 * 60 * 1000) return request;
    fetchedAt = Date.now();
    request = fetch(source, { signal: AbortSignal.timeout(8000) })
      .then((response) => {
        if (!response.ok) throw Error("Manchetes indisponíveis");
        return response.json();
      })
      .catch(() => null);
    return request;
  }

  function validArticles(data) {
    return (Array.isArray(data?.articles) ? data.articles : []).filter(article =>
      typeof article?.title === "string" && article.title.trim() &&
      typeof article.url === "string" &&
      article.url.startsWith("https://agenciabrasil.ebc.com.br/esportes/noticia/")
    ).slice(0,6);
  }
  window.loadArenaSportsNews=async()=>validArticles(await loadNews());

  customElements.define("arena-news", class extends HTMLElement {
    async connectedCallback() {
      const data = await loadNews();
      if (!this.isConnected) return;
      const list = document.createElement("ul");
      for (const article of validArticles(data)) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = article.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = article.title;
        item.append(link);
        const date = Date.parse(article.publishedAt);
        if (Number.isFinite(date)) item.append(" · " + formatter.format(date));
        list.append(item);
      }
      if (!list.children.length) {
        this.textContent = "Manchetes indisponíveis no momento. Consulte a Agência Brasil pelo link abaixo.";
        return;
      }
      const updated = Date.parse(data.updatedAt);
      const note = document.createElement("p");
      note.className = "muted";
      if (Number.isFinite(updated)) note.textContent = "Última consulta ao RSS em " + formatter.format(updated) + ".";
      this.replaceChildren(list, note);
    }
  });
})();
