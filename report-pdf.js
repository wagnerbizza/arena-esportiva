/* SÚMULA PDF — geração no navegador. Bibliotecas gratuitas incluídas em vendor/.
   Não usa servidor pago. Medidas em milímetros, A4, com quebra automática de tabelas. */
const clean = (v) =>
  String(v ?? "")
    .replace(/→/g, " para ")
    .replace(/[—–]/g, " - ")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[\u200B-\u200D]/g, "");
let loading;
let readyURL=null;
function script(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => {
      el.remove();
      reject(
        Error(
          "Não foi possível carregar os arquivos PDF. Confira a pasta vendor no site.",
        ),
      );
    };
    document.head.append(el);
  });
}
async function libraries() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API.autoTable) return;
  if (!loading)
    loading = (async () => {
      await script("./vendor/jspdf.umd.min.js");
      await script("./vendor/jspdf.plugin.autotable.min.js");
    })().catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
async function logoPNG(src) {
  if (!src) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 5000);
    image.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext("2d"),
          r = Math.min(160 / image.width, 160 / image.height),
          w = image.width * r,
          h = image.height * r;
        ctx.drawImage(image, (160 - w) / 2, (160 - h) / 2, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = src;
  });
}
export function buildReportPDF(games, { jsPDF, autoTable }) {
  if (!games.length) throw Error("Selecione uma partida para exportar.");
  const doc = new jsPDF({ unit: "mm", format: "a4" }),
    left = 12,
    width = 186,
    ink = [24, 35, 43],
    accent = [74, 102, 40];
  const table = (head, body, startY, widths) => {
    doc.setCharSpace(0);
    autoTable(doc, {
      head: [head],
      body,
      startY,
      margin: { left, right: 12, top: 20, bottom: 17 },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 2,
        overflow: "linebreak",
        valign: "top",
        lineColor: [196, 202, 206],
        lineWidth: 0.15,
        textColor: ink,
      },
      headStyles: {
        fillColor: [34, 52, 61],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [246, 248, 249] },
      columnStyles: Object.fromEntries(
        widths.map((w, i) => [i, { cellWidth: w }]),
      ),
      rowPageBreak: "avoid",
      showHead: "everyPage",
    });
    return doc.lastAutoTable.finalY;
  };
  function ensure(y, space) {
    if (y + space > 277) {
      doc.addPage();
      return 22;
    }
    return y;
  }
  function paragraph(value, y) {
    const lines = doc.splitTextToSize(clean(value), width);
    for (const line of lines) {
      y = ensure(y, 5);
      doc.text(line, left, y);
      y += 4.5;
    }
    return y;
  }
  games.forEach((g, index) => {
    if (index) doc.addPage();
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("SÚMULA DA PARTIDA", left, 15);
    doc.setFontSize(10);
    doc.text("WagnerBIZZA", 198, 15, { align: "right" });
    doc.setDrawColor(...accent);
    doc.setLineWidth(0.6);
    doc.line(left, 19, 198, 19);
    doc.setFontSize(15);
    let y = 25;
    const title = doc.splitTextToSize(clean(g.title + " - " + g.sport), width);
    doc.text(title, left, y);
    y += title.length * 6 + 3;
    const logo = (data, x, initial) => {
      if (data) {
        try {
          doc.addImage(data, "PNG", x, y, 12, 12);
          return;
        } catch {}
      }
      doc.setFontSize(8);
      doc.setTextColor(80);
      doc.text(
        clean(initial)
          .split(/\s+/)
          .map((x) => x[0] || "")
          .join("")
          .slice(0, 3),
        x + 6,
        y + 7,
        { align: "center" },
      );
    };
    logo(g.logos?.[0], left, g.home);
    logo(g.logos?.[1], 186, g.away);
    doc.setTextColor(...ink);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(doc.splitTextToSize(clean(g.home), 57), 28, y + 5);
    doc.text(doc.splitTextToSize(clean(g.away), 57), 182, y + 5, {
      align: "right",
    });
    doc.setFontSize(22);
    doc.text(clean(g.score), 105, y + 8, { align: "center" });
    y += Math.max(
      19,
      Math.max(
        doc.splitTextToSize(clean(g.home), 57).length,
        doc.splitTextToSize(clean(g.away), 57).length,
      ) *
        4.2 +
        5,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y = paragraph("Data: " + g.date + "   |   Local: " + g.place, y);
    y = paragraph("Arbitragem / mesa: " + g.referees, y);
    y = paragraph(
      "Situação: " +
        g.status +
        "   |   Etapa: " +
        g.stage +
        "   |   Relógio: " +
        g.clock,
      y,
    );
    if (g.notice) y = paragraph("Aviso ao publico: " + g.notice, y);
    if (g.sets) y = paragraph("Parciais: " + g.sets, y);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.text("Equipes e jogadores", left, y);
    y += 3;
    y =
      table(
        ["Equipe", "Atleta", "Nº", "Posição", "Escalação"],
        g.roster.map((r) => r.map(clean)),
        y,
        [37, 53, 10, 49, 37],
      ) + 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    y = paragraph("Técnicos: " + g.coaches, y);
    y += 3;
    y = ensure(y, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Histórico da partida", left, y);
    y += 3;
    y =
      table(
        [
          "Horário / jogo",
          "Etapa",
          "Acontecimento",
          "Equipe / atleta",
          "Descrição / motivo",
          "Resp.*",
        ],
        g.events.map((r) => r.map(clean)),
        y,
        [22, 13, 27, 36, 69, 19],
      ) + 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    y = paragraph(
      "* Identificador abreviado. A auditoria completa preserva o UID integral de cada responsavel.",
      y,
    );
    y += 3;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    y = ensure(y, 14);
    doc.text("Observações da súmula", left, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    y = paragraph(g.notes || "Sem observações.", y);
    y = ensure(y + 8, 31);
    doc.setFontSize(8);
    doc.text("Arbitro(a): __________________________", left, y);
    doc.text("Mesa: __________________________", 111, y);
    y += 12;
    doc.text("Equipe da casa: ______________________", left, y);
    doc.text("Equipe visitante: ______________________", 111, y);
    y += 8;
    doc.setFontSize(7);
    doc.text("Sumula do sistema. Campos para assinatura em papel.", left, y);
  });
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    if (doc.GState) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.045 }));
      doc.setTextColor(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(48);
      doc.text("WagnerBIZZA", 45, 165, { angle: 28 });
      doc.restoreGraphicsState();
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    doc.setFontSize(7);
    doc.text("WagnerBIZZA • Central esportiva", 12, 288);
    doc.text("Página " + i + " de " + doc.getNumberOfPages(), 198, 288, {
      align: "right",
    });
  }
  return doc;
}
export async function downloadReportPDF(games) {
  await libraries();
  const prepared = await Promise.all(
    games.map(async (g) => ({
      ...g,
      logos: await Promise.all(g.badges.map(logoPNG)),
    })),
  );
  const doc = buildReportPDF(prepared, {
    jsPDF: window.jspdf.jsPDF,
    autoTable: (doc, opts) => doc.autoTable(opts),
  });
  if(readyURL)URL.revokeObjectURL(readyURL);
  readyURL=URL.createObjectURL(doc.output('blob'));
  document.getElementById('pdf-ready')?.remove();
  const box=document.createElement('div');box.id='pdf-ready';box.className='card noprint';
  const message=document.createElement('p');message.textContent='PDF pronto. Se o download não iniciar automaticamente, clique abaixo.';
  const link=document.createElement('a');link.className='button';link.href=readyURL;link.download='sumula-esportiva-WagnerBIZZA.pdf';link.textContent='Baixar arquivo PDF pronto';box.append(message,link);
  const target=document.querySelector('#reportOutput');if(target)target.before(box);else document.body.append(box);
  link.click();
}
