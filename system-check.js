/* Diagnóstico seguro: não recebe funções de escrita, login ou exclusão.
   As simulações usam cópias em memória e não validam as regras do servidor. */
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const manual=detail=>({status:"manual",detail});
export function diagnosticPlan({D,M,readServer,training=false,fetchAsset,settings={}}) {
  let sandbox=null,match=null,goal=null;
  const apply=a=>{const result=M.applyMatch(match,a);match=result.match;return result;};
  const items=[];
  const add=(id,group,title,run)=>items.push({id,group,title,run});
  add("engines","Simulações locais","Carregar os motores de regras",()=>{
    ensure(typeof D?.reduce==="function"&&typeof M?.applyMatch==="function","Motores Domain/SparkModel indisponíveis. Recarregue a página.");
    sandbox=D.fresh();return "Motores carregados; dados de teste somente em memória.";
  });
  add("cup","Simulações locais","Cadastrar e renomear campeonato",()=>{
    ensure(sandbox,"Motor local não inicializado.");
    const data={name:"Diagnóstico temporário",season:"Teste",sport:"Futebol",category:"Livre",status:"Planejado"};
    sandbox=D.reduce(sandbox,{type:"championship",data});const id=sandbox.championships[0].id;
    sandbox=D.reduce(sandbox,{type:"championship",data:{...data,id,name:"Diagnóstico renomeado"}});
    ensure(sandbox.championships.length===1&&sandbox.championships[0].id===id&&sandbox.championships[0].name==="Diagnóstico renomeado","Renomeação local inconsistente.");
    return "Nome atualizado com o mesmo identificador, sem criar cadastro duplicado.";
  });
  add("game","Simulações locais","Criar equipes e partida vinculada",()=>{
    ensure(sandbox?.championships.length,"Simulação do campeonato não concluída.");
    for(const name of ["Diagnóstico A","Diagnóstico B"])sandbox=D.reduce(sandbox,{type:"team",data:{name,short:name.endsWith("A")?"A":"B"}});
    sandbox=D.reduce(sandbox,{type:"match",data:{home:sandbox.teams[0].id,away:sandbox.teams[1].id,championshipId:sandbox.championships[0].id,sport:"Futebol",date:"2026-01-01T12:00:00.000Z"}});
    match={...sandbox.matches[0],score:[0,0],clock:M.emptyClock(),rosterTeams:{},publicEvents:[]};
    ensure(match.championshipId===sandbox.championships[0].id,"Partida sem vínculo ao campeonato.");
    return "Duas equipes e uma partida fictícia criadas em memória.";
  });
  add("goal","Simulações locais","Iniciar partida e registrar gol",()=>{
    ensure(match,"Partida fictícia indisponível.");apply({type:"status",status:"Ao vivo"});goal=apply({type:"event",kind:"ponto",side:0,value:1,player:""}).detail;
    ensure(match.score[0]===1&&match.score[1]===0,"Placar local incorreto.");return "Gol registrado: placar 1 × 0.";
  });
  add("card","Simulações locais","Registrar cartão",()=>{
    ensure(match?.status==="Ao vivo","Partida fictícia não iniciada.");const result=apply({type:"event",kind:"cartão amarelo",side:1,player:"",text:"Teste automático"});
    ensure(result.detail.type==="cartão amarelo"&&match.score[0]===1,"Cartão não registrado corretamente.");return "Cartão registrado sem alterar o placar.";
  });
  add("undo","Simulações locais","Anular gol com justificativa",()=>{
    ensure(goal,"Gol fictício indisponível.");const result=M.applyMatch(match,{type:"correct",eventId:"gol-diagnostico",reason:"Gol anulado no teste"},{entity:"matches",target:match.id,detail:goal});match=result.match;
    ensure(match.score[0]===0&&result.detail.reason==="Gol anulado no teste","Anulação ou justificativa inconsistente.");return "Placar voltou a 0 × 0 e o motivo foi preservado.";
  });
  add("clock","Simulações locais","Iniciar, contar e pausar cronômetro",()=>{
    ensure(match?.status==="Ao vivo","Partida fictícia não iniciada.");
    // Relógio independente para uma contagem determinística, sem depender da hora real.
    match={...match,clock:M.emptyClock()};
    match=M.applyMatch(match,{type:"clock",command:"iniciar"},null,"2026-01-01T12:00:00.000Z").match;
    match=M.applyMatch(match,{type:"clock",command:"parar"},null,"2026-01-01T12:00:05.000Z").match;
    ensure(!match.clock.running&&M.elapsed(match,Date.parse("2026-01-01T12:00:05.000Z"))===5000,"Contagem ou pausa incorreta.");return "Cinco segundos simulados, sem aguardar ou alterar relógios reais.";
  });
  add("added","Simulações locais","Autorizar acréscimos e publicar aviso",()=>{
    apply({type:"addedTime",minutes:2});apply({type:"notice",notice:"Aviso fictício"});
    ensure(match.addedTime.minutes===2&&match.publicNotice==="Aviso fictício","Acréscimos ou aviso inconsistentes.");return "Acréscimos e aviso registrados na simulação.";
  });
  add("close","Simulações locais","Encerrar e bloquear novos gols",()=>{
    apply({type:"status",status:"Encerrada"});let blocked=false;
    try{M.applyMatch(match,{type:"event",kind:"ponto",side:0,value:1});}catch{blocked=true;}
    ensure(blocked&&match.status==="Encerrada","Partida encerrada aceitou novo lance.");return "Encerramento bloqueou novos gols no motor local.";
  });
  add("privacy","Simulações locais","Separar campos privados do placar público",()=>{
    ensure(match,"Partida fictícia indisponível.");const pub=M.publicMatch({...match,notes:"Privado",referees:"Privado",_updatedBy:"diagnostico",_revision:1,_updatedAt:null});
    ensure(!["notes","roster","rosterTeams","referees","_updatedBy"].some(key=>Object.hasOwn(pub,key)),"Projeção pública incluiu campos privados.");
    return "Projeção local omitiu observações, elenco privado e autor. Não comprova as regras publicadas.";
  });
  for(const [kind,label] of [["settings","Configurações"],["publicSettings","Aparência pública"],["championships","Campeonatos"],["teams","Equipes"],["players","Jogadores"],["matches","Partidas"],["audit","Histórico de auditoria"],["users","Operadores"],["publicMatches","Placares públicos"]])
    add("server-"+kind,"Servidor (somente leitura)","Consultar "+label.toLowerCase(),async()=>{
      if(training||!readServer)return manual("Não consultado: demonstração sem acesso ao Firebase real.");
      const result=await readServer(kind);
      ensure(result.valid!==false,"Amostra recebida com estrutura inesperada. Revise os cadastros.");
      return result.empty?manual("Consulta autorizada, mas sem registros; conteúdo não validado."):"Consulta ao servidor autorizada; amostra de até um registro. Não testa gravação nem a coleção inteira.";
    });
  for(const [file,marker] of [["painel.html","<html"],["index.html","<html"],["style.css","--"],["domain.js","Domain"],["spark-model.js","SparkModel"],["spark-store.js","connectSpark"],["report-pdf.js","buildReportPDF"],["vendor/arena-qrcode.js","qrSvg"],["vendor/jspdf.umd.min.js","jsPDF"],["vendor/jspdf.plugin.autotable.min.js","autoTable"]])
    add("asset-"+file,"Arquivos publicados","Carregar "+file,async()=>{
      ensure(fetchAsset,"Leitura dos arquivos não disponível.");const text=await fetchAsset(file);
      ensure(text.includes(marker),"Conteúdo inesperado; o endereço pode estar retornando uma página de erro.");return "Arquivo acessível e marcador encontrado. A geração visual do documento precisa de conferência.";
    });
  add("branding","Configurações carregadas","Conferir título e cor",()=>{
    ensure(typeof settings.title==="string"&&settings.title.trim(),"Título do sistema ausente.");
    ensure(/^#[0-9a-f]{6}$/i.test(settings.color||""),"Cor de destaque inválida.");return "Título e cor válidos nos dados carregados.";
  });
  add("permissions","Conferência pendente","Permissões com outra identidade",()=>manual("Ainda precisa de teste com operador e visitante em identidades separadas ou emulador. A sessão administrativa não comprova bloqueios."));
  add("writes","Conferência pendente","Gravação, concorrência e sincronização real",()=>manual("As gravações foram simuladas somente em memória. Este diagnóstico não cria, altera nem exclui registros reais e não valida transações do servidor."));
  add("visual","Conferência pendente","Layout, PDFs, logos e leitura de QR codes",()=>manual("Confira computador e celular, abra os PDFs e leia um QR code. Arquivo carregado não comprova aparência, impressão ou câmera."));
  return items;
}
export async function runSystemChecks(options) {
  const startedAt=new Date().toISOString(),all=diagnosticPlan(options);
  const plan=Array.isArray(options.onlyIds)?all.filter(item=>options.onlyIds.includes(item.id)):all;
  ensure(plan.length>0,"Verificação solicitada não encontrada.");
  const report={version:1,startedAt,finishedAt:null,mode:options.training?"Demonstração: simulações locais":"Simulações locais e consultas ao servidor",scope:"Sem gravações reais. Aprovação de um teste não aprova o sistema inteiro.",rows:plan.map(({id,group,title})=>({id,group,title,status:"pending",detail:"Aguardando",durationMs:0}))};
  const emit=()=>options.onUpdate?.(JSON.parse(JSON.stringify(report)));
  emit();
  for(let i=0;i<plan.length;i++){
    if(options.signal?.aborted){report.cancelled=true;break;}
    const row=report.rows[i],start=Date.now();row.status="running";row.detail="Verificando…";emit();
    let timer;
    try {
      const answer=await Promise.race([Promise.resolve().then(()=>plan[i].run()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Tempo de consulta excedido. Confira a conexão e tente novamente.")),options.timeoutMs||10000);})]);
      if(options.signal?.aborted){report.cancelled=true;break;}
      row.status=answer?.status||"passed";row.detail=typeof answer==="string"?answer:answer.detail;
    }catch(error){if(options.signal?.aborted){report.cancelled=true;row.status="manual";row.detail="Não concluído: verificação interrompida.";}else{row.status="failed";row.detail=error?.code==="permission-denied"?"Firebase recusou a consulta. Confira a conta administrativa e as regras publicadas.":String(error.message||error).slice(0,500);}}
    finally{clearTimeout(timer);row.durationMs=Date.now()-start;}
    emit();await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(options.signal?.aborted)report.cancelled=true;
  if(report.cancelled)for(const row of report.rows)if(["pending","running"].includes(row.status)){row.status="manual";row.detail="Não concluído: verificação interrompida.";}
  report.finishedAt=new Date().toISOString();emit();return report;
}
