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
export async function downloadCenteredQrPDF(svg, filename, title = "Painel público do Arena") {
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const canvas = document.createElement("canvas");
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
  } finally {
    URL.revokeObjectURL(source);
  }
  await libraries();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const side = 130;
  const page = doc.internal.pageSize;
  const centerX = page.getWidth() / 2;
  const top = (page.getHeight() - side) / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  const heading = doc.splitTextToSize(title, page.getWidth() - 40);
  doc.text(heading, centerX, top - 9 - (heading.length - 1) * 8.2, { align: "center" });
  doc.addImage(canvas, "PNG", centerX - side / 2, top, side, side);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text([
    "Abra a câmera do celular e aponte para o QR Code.",
    "Toque no link que aparecer para acompanhar os jogos."
  ], centerX, top + side + 11, { align: "center" });
  doc.save(filename);
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
  const pageBranding = new Map();
  function placeBrandRow(groups, y, size) {
    const logos = groups.flatMap(group => (group.logos || []).map((image, index) => ({
      image, label: index===0 && !["system","school"].includes(group.key) ? clean(group.label) : ""
    })));
    if (!logos.length) return y;
    const gap = logos.length>8 ? 2 : 5;
    const side = Math.min(size, (width-gap*(logos.length-1))/logos.length);
    const labelHeight = logos.some(item=>item.label) ? 5 : 0;
    y = ensure(y, side+labelHeight+4);
    doc.setFontSize(Math.min(8,side*1.15));
    const start = left+(width-logos.length*side-(logos.length-1)*gap)/2;
    logos.forEach(({image,label},i)=>{
      const x=start+i*(side+gap);
      if(label)doc.text(label,x,y+3,{maxWidth:side});
      try { doc.addImage(image,"PNG",x,y+labelHeight,side,side,undefined,"FAST"); } catch {}
    });
    return y+side+labelHeight+4;
  }
  function brandGroups(groups,y,size,header=false) {
    if (!groups.some(group=>group.logos?.length)) return y;
    const adjacent = header && groups.some(group=>group.position==="beside")
      ? groups.filter(group=>group.key==="system"||group.position==="beside") : [];
    if(adjacent.length)y=placeBrandRow(adjacent,y,size);
    const remaining=groups.filter(group=>!adjacent.includes(group));
    if(remaining.length)y=placeBrandRow(remaining,y,size);
    return y;
  }
  function footerBrandGroups(groups, y, size) {
    const gap = 5;
    const imageSize = size;
    const rowHeight = imageSize + 10;
    const perRow = Math.max(1, Math.floor((width + gap) / (size + gap)));
    let rowY = y + 5;
    let row = [];
    let rowWidth = 0;
    doc.setFontSize(8);
    function drawRow() {
      if (!row.length) return;
      rowY = ensure(rowY, rowHeight);
      let x = left + (width - rowWidth) / 2;
      for (const { label, batch, boxWidth, logosWidth } of row) {
        if (label) doc.text(label, x + boxWidth / 2, rowY, { align: "center" });
        const logosX = x + (boxWidth - logosWidth) / 2;
        batch.forEach((logo, index) => {
          const imageX = logosX + index * (size + gap) + (size - imageSize) / 2;
          try { doc.addImage(logo, "PNG", imageX, rowY + 4, imageSize, imageSize, undefined, "FAST"); } catch {}
        });
        x += boxWidth + gap;
      }
      rowY += rowHeight;
      row = [];
      rowWidth = 0;
    }
    for (const group of groups) {
      const logos = group.logos || [];
      const label = ["system", "school"].includes(group.key) ? "" : clean(group.label);
      for (let offset = 0; offset < logos.length; offset += perRow) {
        const batch = logos.slice(offset, offset + perRow);
        const logosWidth = batch.length * (size + gap) - gap;
        const boxWidth = Math.max(logosWidth, doc.getTextWidth(label));
        if (row.length && rowWidth + gap + boxWidth > width) drawRow();
        rowWidth += (row.length ? gap : 0) + boxWidth;
        row.push({ label, batch, boxWidth, logosWidth });
      }
    }
    drawRow();
  }
  games.forEach((g, index) => {
    if (index) doc.addPage();
    const firstPage=doc.getNumberOfPages();
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    // Logo institucional configurado no sistema, independente dos escudos das equipes.
    if (g.organizationLogo && !g.documentBranding) {
      try {
        doc.addImage(g.organizationLogo, "PNG", left, 5, 11, 11, undefined, "FAST");
      } catch {
        // Se a imagem não puder ser incorporada, a súmula continua sendo gerada.
      }
    }
    doc.setFontSize(10);
    doc.text("SÚMULA DA PARTIDA", g.organizationLogo && !g.documentBranding ? 26 : left, 15);
    doc.setFontSize(10);
    doc.text("WagnerBIZZA", 198, 15, { align: "right" });
    doc.setDrawColor(...accent);
    doc.setLineWidth(0.6);
    doc.line(left, 19, 198, 19);
    doc.setFontSize(15);
    let y = g.documentBranding ? brandGroups(g.documentBranding.groups.filter(group=>["header","beside"].includes(group.position)),25,g.documentBranding.config.size,true)+4 : 25;
    doc.setFontSize(15);
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
          "Responsável",
        ],
        g.events.map((r) => r.map(clean)),
        y,
        [23, 12, 28, 33, 48, 42],
      ) + 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    y = paragraph(
      "Responsaveis identificados pelo nome disponivel e UID. Registros antigos podem nao conter o nome.",
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
    if(g.documentBranding){
      footerBrandGroups(g.documentBranding.groups.filter(group=>group.position==='footer'),y+4,g.documentBranding.config.size);
      for(let page=firstPage;page<=doc.getNumberOfPages();page++)pageBranding.set(page,g.documentBranding);
    }
  });
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    if (doc.GState) {
      doc.saveGraphicsState();
      const branding=pageBranding.get(i);
      doc.setGState(new doc.GState({ opacity: branding ? branding.config.opacity/100 : 0.045 }));
      doc.setTextColor(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(48);
      if(branding){
        if(branding.config.watermarkText){
          doc.setFontSize(branding.config.size*1.28);doc.text(doc.splitTextToSize(clean(branding.config.watermarkText),155),30,155,{angle:branding.config.angle});
        }
        const images=branding.groups.filter(group=>group.position==='background').flatMap(group=>group.logos);
        const side=branding.config.size,step=side+6,columns=Math.min(4,images.length||1);
        images.forEach((logo,index)=>{
          const row=Math.floor(index/columns),count=Math.min(columns,images.length-row*columns);
          const x=105-(count*step-6)/2+(index%columns)*step;
          try{doc.addImage(logo,'PNG',x,60+row*step,side,side,undefined,'FAST',branding.config.angle);}catch{}
        });
      }else doc.text("WagnerBIZZA", 45, 165, { angle: 28 });
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
export async function createReportPDF(games) {
  await libraries();
  const prepared = await Promise.all(
    games.map(async (g) => ({
      ...g,
      organizationLogo: await logoPNG(g.organizationLogo),
      documentBranding: g.documentBranding ? {...g.documentBranding,groups:await Promise.all(g.documentBranding.groups.map(async group=>({...group,logos:(await Promise.all(group.logos.map(logoPNG))).filter(Boolean)})))} : null,
      logos: await Promise.all(g.badges.map(logoPNG)),
    })),
  );
  return buildReportPDF(prepared, {
    jsPDF: window.jspdf.jsPDF,
    autoTable: (doc, opts) => doc.autoTable(opts),
  });
}
export async function downloadReportPDF(games) {
  const doc=await createReportPDF(games);
  if(readyURL)URL.revokeObjectURL(readyURL);
  readyURL=URL.createObjectURL(doc.output('blob'));
  document.getElementById('pdf-ready')?.remove();
  const box=document.createElement('div');box.id='pdf-ready';box.className='card noprint';
  const message=document.createElement('p');message.textContent='PDF pronto. Se o download não iniciar automaticamente, clique abaixo.';
  const link=document.createElement('a');link.className='button';link.href=readyURL;link.download='sumula-esportiva-WagnerBIZZA.pdf';link.textContent='Baixar arquivo PDF pronto';box.append(message,link);
  const target=document.querySelector('#reportOutput');if(target)target.before(box);else document.body.append(box);
  link.click();
}
