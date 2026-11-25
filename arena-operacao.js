/* Mesa de operação: organiza os controles existentes e guarda apenas preferências locais. */
(function(){
 'use strict';if(window.ArenaOperation)return;
 const defaults=['points','time','substitutions','coach','events','pauses','roster','notices','notes','championship','history'];
 const labels={points:'Pontos e cartões',time:'Tempo e acréscimos',substitutions:'Substituições de atletas e goleiros',coach:'Troca de técnico',events:'Cartões, faltas e outros lances',pauses:'Situação e etapas',roster:'Elenco da partida',notices:'Avisos ao público',history:'Histórico e anulações',notes:'Observações da súmula',championship:'Campeonato e modalidade'};
 const icon=(path)=>'<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
 const star=icon('<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z"/>');
 const chevron=icon('<path d="m6 9 6 6 6-6"/>');
 const grip=icon('<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3.5"/>');
 const monitorCommands = {
  startClock: ['Iniciar cronômetro', '[data-clock-command="iniciar"]'],
  stopClock: ['Parar cronômetro', '[data-clock-command="parar"]'],
  end: ['Encerrar', '[data-status="Encerrada"]'],
  resume: ['Iniciar / continuar', '[data-guided-start]'],
  pause: ['Pausar jogo', '[data-status="Pausada"]'],
  suspend: ['Suspender', '[data-status="Suspensa"]'],
  notices: ['Avisos', null, 'notices'],
  clock: ['Configurar relógio', '[data-open-clock]'],
  added: ['Iniciar acréscimos', '[data-clock-command="iniciar-acrescimos"]'],
  set: ['Encerrar set', '[data-set]'],
  home: ['+1 para a primeira equipe', '[data-quick="1"][data-side="0"]'],
  away: ['+1 para a segunda equipe', '[data-quick="1"][data-side="1"]'],
  home2: ['+2 para a primeira equipe', '[data-quick="2"][data-side="0"]'],
  away2: ['+2 para a segunda equipe', '[data-quick="2"][data-side="1"]'],
  home3: ['+3 para a primeira equipe', '[data-quick="3"][data-side="0"]'],
  away3: ['+3 para a segunda equipe', '[data-quick="3"][data-side="1"]'],
  homeFoul: ['Falta da primeira equipe', '[data-fast-event="falta"][data-side="0"]'],
  awayFoul: ['Falta da segunda equipe', '[data-fast-event="falta"][data-side="1"]'],
  homeYellow: ['Amarelo para primeira equipe', '[data-fast-event="cartão amarelo"][data-side="0"]'],
  awayYellow: ['Amarelo para segunda equipe', '[data-fast-event="cartão amarelo"][data-side="1"]'],
  homeRed: ['Vermelho para primeira equipe', '[data-fast-event="cartão vermelho"][data-side="0"]'],
  awayRed: ['Vermelho para segunda equipe', '[data-fast-event="cartão vermelho"][data-side="1"]'],
  referee: ['Avisar sobre arbitragem', '[data-fast-notice="arbitragem"]'],
  care: ['Avisar sobre atendimento', '[data-fast-notice="atendimento"]'],
  clearNotice: ['Retirar aviso', '[data-fast-notice="retirar"]'],
  ...Object.fromEntries(defaults.filter(id=>id!=='notices').map(id=>['panel-'+id,[labels[id],null,id]])),
 };
 const defaultMonitor = ['notices'];
 const dedicatedCommands = ['end','resume','pause'];
 const sessionPreferences=new Map();
 const panelColors={azul:['Azul','#45a4ff'],verde:['Verde','#49c99a'],laranja:['Laranja','#f4a858'],roxo:['Roxo','#b58cff'],rosa:['Rosa','#ee80ac']};
 const panelTitle=(prefs,id)=>prefs.names?.[id]||labels[id];
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function read(key){let saved=sessionPreferences.get(key);if(!saved)try{saved=JSON.parse(localStorage.getItem(key));}catch{}return {order:[...new Set([...(Array.isArray(saved?.order)?saved.order.filter(id=>defaults.includes(id)):[]),...defaults])],favorites:Array.isArray(saved?.favorites)?[...new Set(saved.favorites.filter(id=>defaults.includes(id)))]:['points','time','events','history'],names:Object.fromEntries(defaults.filter(id=>typeof saved?.names?.[id]==="string").map(id=>[id,saved.names[id].trim().slice(0,64)])),colors:Object.fromEntries(defaults.filter(id=>Object.hasOwn(panelColors,saved?.colors?.[id])).map(id=>[id,saved.colors[id]])),locked:Array.isArray(saved?.locked)?saved.locked.filter(id=>defaults.includes(id)):[],collapsed:Array.isArray(saved?.collapsed)?saved.collapsed.filter(id=>defaults.includes(id)):[],monitor:Array.isArray(saved?.monitor)?[...new Set(saved.monitor.filter(id=>Object.hasOwn(monitorCommands,id)))]:[...defaultMonitor],displayWidth:[35,40,45,50,55,60,65].includes(saved?.displayWidth)?saved.displayWidth:45,stackMonitor:saved?.stackMonitor===true,side:Array.isArray(saved?.side)?saved.side.filter(id=>Object.hasOwn(monitorCommands,id)):[],scorePinned:saved?.scorePinned!==false,compact:saved?.compact===true,columns:saved?.columns===true};}
 let syncedLayout=null;
 const syncMessages=new Map();
 const pendingLayouts=new Map();
 function currentWorkspace(key){
  return [...document.querySelectorAll('.arena-operation-workspace')].find(root=>root.dataset.opKey===key);
 }
 function workspaceFor(element){
  return element.closest('.arena-operation-workspace');
 }
 function tools(root){
  return root.querySelector('.arena-op-settings');
 }
 function restoreSyncStatus(container){
  const root=container.querySelector('.arena-operation-workspace');
  if(!root)return;
  const key=root.dataset.opKey, message=syncMessages.get(key);
  if(message)syncStatus(key,message);
 }
 document.addEventListener('toggle',event=>{
  if(!event.target.matches?.('.arena-op-settings'))return;
  workspaceFor(event.target)?.querySelector('[data-op-monitor-edit]')
   ?.setAttribute('aria-expanded',String(event.target.open));
 },true);
 function syncStatus(key,text){
  syncMessages.set(key,text);
  const label=currentWorkspace(key) && tools(currentWorkspace(key))?.querySelector('[data-op-save-status]');
  if(label)label.textContent=text;
 }
 function pendingLayout(key){
  if(pendingLayouts.has(key))return pendingLayouts.get(key);
  try{return localStorage.getItem(key+':pending');}catch{return null;}
 }
 async function flushLayout(connection){
  if(!connection||syncedLayout!==connection||connection.writing)return;
  const {key,remote}=connection,pending=pendingLayout(key);
  if(!pending)return;
  connection.writing=true;
  let saved=false;
  syncStatus(key,'Sincronizando ajustes da cabine…');
  try{
   await remote.write(pending);
   if(pendingLayout(key)===pending){
    pendingLayouts.delete(key);
    try{localStorage.removeItem(key+':pending');}catch{}
   }
   saved=true;
   if(syncedLayout===connection)syncStatus(key,'Preferências sincronizadas com a conta.');
  }catch{
   if(syncedLayout===connection)syncStatus(key,'Ajustes pendentes de sincronização. Tente novamente quando estiver conectado.');
  }finally{
   connection.writing=false;
   if(saved && pendingLayout(key))flushLayout(connection);
  }
 }
 function connectLayout(key,remote){
  if(!remote||!remote.uid)return;
  if(syncedLayout?.key===key&&syncedLayout.remote.uid===remote.uid)return;
  syncedLayout?.stop?.();
  const connection={key,remote,writing:false};
  syncedLayout=connection;
  syncStatus(key,'Conferindo os ajustes da conta…');
  connection.stop=remote.watch(payload=>{
   if(syncedLayout!==connection||connection.writing)return;
   if(pendingLayout(key)){flushLayout(connection);return;}
   let stored;try{stored=JSON.parse(payload);}catch{}
   if(!Array.isArray(stored?.order)){
    syncStatus(key,'Ainda não há ajustes da cabine salvos na conta.');
    return;
   }
   sessionPreferences.set(key,stored);
   const prefs=read(key);
   try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}
   const root=currentWorkspace(key);
   if(root&&!drag){
    tools(root).querySelector('[data-op-compact]').checked=prefs.compact;
    tools(root).querySelector('[data-op-columns]').checked=prefs.columns;
    const strip=root.querySelector('.arena-op-strip');
    strip.classList.toggle('is-pinned',prefs.scorePinned);
    describeScorePin(strip.querySelector('[data-op-pin-score]'),prefs.scorePinned);
    apply(root,prefs);
   }
   syncStatus(key,'Preferências sincronizadas com a conta.');
  },()=>syncStatus(key,'Não foi possível consultar os ajustes da conta. Confira a conexão e o acesso.'));
  flushLayout(connection);
 }
 function save(root,prefs){
  const key=root.dataset.opKey,payload=JSON.stringify(prefs);
  sessionPreferences.set(key,prefs);
  try{localStorage.setItem(key,payload);}catch{}
  if(key.startsWith('arena-operation-layout-v1:treinamento-')){
   syncStatus(key,'Ajustes do treinamento salvos neste navegador.');
   return;
  }
  pendingLayouts.set(key,payload);
  try{localStorage.setItem(key+':pending',payload);}catch{}
  if(syncedLayout?.key===key)flushLayout(syncedLayout);
  else syncStatus(key,'Ajustes salvos neste aparelho. Entre com sua conta para sincronizar.');
 }
 window.addEventListener('online',()=>flushLayout(syncedLayout));

 function panel(id,node){if(!node)return null;node.removeAttribute('hidden');node.classList?.remove('card');const section=document.createElement('section');section.id='arena-op-'+id;section.className='card arena-op-panel';section.dataset.opPanel=id;section.tabIndex=-1;section.innerHTML='<div class="arena-op-heading"><h2>'+labels[id]+'</h2><button type="button" data-op-favorite="'+id+'" aria-pressed="false" title="Favoritar '+labels[id]+'">Favoritar</button></div>';const toggle=document.createElement('button');toggle.type='button';toggle.dataset.opFold=id;
  toggle.setAttribute('aria-controls',section.id+'-content');
  const heading=section.querySelector('.arena-op-heading');
  const handle=document.createElement('button');handle.type='button';handle.dataset.opDrag='';
  handle.innerHTML=grip;heading.prepend(handle);const lock=document.createElement('button');lock.type='button';lock.dataset.opLock=id;
  heading.append(toggle,lock);
  const content=document.createElement('div');content.id=section.id+'-content';content.dataset.opContent='';
  content.append(node);section.append(content);return section;}
 function monitorToolbar(root,prefs) {
  const menu=root.querySelector('[data-op-monitor]');
  const choices=tools(root).querySelector('[data-op-monitor-choices]');
  const side=root.querySelector('[data-op-monitor-side]');
  menu.replaceChildren();side.replaceChildren();
  const primary=root.querySelector('[data-op-primary]');
  primary.replaceChildren();
  if(root.hasAttribute('data-op-standby')){
   const start=document.createElement('button');
   start.type='button';start.className='primary';start.dataset.opNoMatch='';
   start.textContent='Iniciar partida';primary.append(start);
  }else{
   for(const id of ['resume','pause']){
    const [label,selector]=monitorCommands[id];
    const source=root.querySelector(selector);
    if(!source||source.disabled)continue;
    const button=document.createElement('button');
    button.type='button';button.className='primary';
    button.dataset.opMonitorRun=id;
    button.textContent=id==='resume'?(source.textContent.trim().startsWith('Retomar')?'Continuar':source.textContent.trim()):label;
    primary.append(button);
   }
  }
  const settings=tools(root);
  const sidePreview=settings.querySelector('[data-op-dock-preview="side"]');
  const belowPreview=settings.querySelector('[data-op-dock-preview="below"]');
  sidePreview.replaceChildren();belowPreview.replaceChildren();
  for(const id of prefs.monitor){
   if(dedicatedCommands.includes(id))continue;
   const [label,selector,panelId]=monitorCommands[id];
   const source=selector?root.querySelector(selector):root.querySelector('[data-op-panel="'+panelId+'"]');
   const beside=prefs.side.includes(id);
   const button=document.createElement('button');
   button.type='button';
   button.textContent=label;
   button.dataset.opDockCommand=id;
   button.draggable=true;
   const preview=button.cloneNode(true);
   preview.dataset.opPlace='';
   (beside?sidePreview:belowPreview).append(preview);
   if(root.hasAttribute('data-op-standby')){
    if(panelId)button.dataset.opQuickPanel=panelId;
    else if(id==='clock')button.dataset.opQuickPanel='time';
    else button.dataset.opNoMatch='';
   }else if(!source || source.disabled){
    button.dataset.opUnavailable='';
    button.title=root.hasAttribute('data-op-standby')?'Escolha uma partida para usar este comando':'Comando indisponível na situação atual';
   }else if(['notices','events'].includes(panelId))button.dataset.opQuickPanel=panelId;
   else if(panelId)button.dataset.opJump=panelId;
   else button.dataset.opMonitorRun=id;
   (beside?side:menu).append(button);
  }
  for(const [id,[,selector,panelId]] of Object.entries(monitorCommands)){
   if(dedicatedCommands.includes(id))continue;
   const source=selector?root.querySelector(selector):root.querySelector('[data-op-panel="'+panelId+'"] [data-op-drag]');
   if(!source)continue;
   source.dataset.opDockCommand=id;
   if(!panelId)source.draggable=!source.disabled;
  }
  choices.innerHTML=Object.entries(monitorCommands).filter(([id])=>!dedicatedCommands.includes(id)).map(([id,[label]])=>{
   const checked=prefs.monitor.includes(id);
   const placement=checked?(prefs.side.includes(id)?'Ao lado':'Abaixo'):'Posicionar';
   return '<div class="arena-op-choice"><label><input type="checkbox" data-op-monitor-choice="'+id+'" '+(checked?'checked':'')+'> '+escape(label)+'</label>'+
    '<button type="button" draggable="true" data-op-dock-command="'+id+'" data-op-place aria-label="Posicionar '+escape(label)+'">'+grip+'<span>'+placement+'</span></button></div>';
  }).join('');
 }
 function toolbar(root,prefs){monitorToolbar(root,prefs);const nav=tools(root).querySelector('[data-op-shortcuts]');nav.replaceChildren();const panels=[...root.querySelectorAll('[data-op-panel]')];for(const section of panels){const id=section.dataset.opPanel,fold=section.querySelector('[data-op-fold]'),closed=prefs.collapsed.includes(id);
   const title=panelTitle(prefs,id),color=panelColors[prefs.colors[id]];
   section.querySelector('h2').textContent=title;
   if(color)section.style.setProperty('--arena-op-box-color',color[1]);
   else section.style.removeProperty('--arena-op-box-color');
   const handle=section.querySelector('[data-op-drag]');
   handle.title='Arrastar '+title+' • Alt + ↑ ou ↓ para mover pelo teclado';
   handle.setAttribute('aria-label','Reordenar '+title);
   handle.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
   const locked=prefs.locked.includes(id),lock=section.querySelector('[data-op-lock]');

   lock.innerHTML=icon('<path d="M9 3h6v6l4 4v2H5v-2l4-4V3Zm3 12v6"/>'+
     (locked?'':'<path d="M3 3l18 18"/>'));
   lock.setAttribute('aria-pressed',String(locked));
   lock.title=(locked?'Desafixar ':'Fixar no topo: ')+title;
   lock.setAttribute('aria-label',lock.title);
   fold.innerHTML=chevron;fold.setAttribute('aria-expanded',String(!closed));
   fold.setAttribute('aria-label',(closed?'Expandir':'Recolher')+' '+title);section.querySelector('[data-op-content]').hidden=closed;
   const favorite=prefs.favorites.includes(id),button=section.querySelector('[data-op-favorite]');button.setAttribute('aria-pressed',String(favorite));button.innerHTML=star;button.title=(favorite?'Remover dos favoritos: ':'Favoritar: ')+title;button.setAttribute('aria-label',button.title);if(favorite){const jump=document.createElement('button');jump.type='button';jump.dataset.opJump=id;jump.textContent=title;nav.append(jump);}}
  if(!nav.children.length)nav.textContent='Marque uma estrela para adicionar um atalho.';
  const list=tools(root).querySelector('[data-op-order]');list.innerHTML=panels.map(section=>{const id=section.dataset.opPanel,siblings=[...section.parentElement.children],i=siblings.indexOf(section);return '<div class="arena-op-order-row"><span>'+escape(panelTitle(prefs,id))+'</span><button type="button" data-op-favorite="'+id+'" aria-pressed="'+prefs.favorites.includes(id)+'">'+(prefs.favorites.includes(id)?'Favorito':'Favoritar')+'</button><button type="button" data-op-move="'+id+'" data-op-direction="first" '+(i===0?'disabled':'')+'>Colocar primeiro</button><button type="button" data-op-move="'+id+'" data-op-direction="last" '+(i===siblings.length-1?'disabled':'')+'>Colocar por último</button><button type="button" data-op-move="'+id+'" data-op-direction="up" '+(i===0?'disabled':'')+' aria-label="Subir '+labels[id]+'">Subir</button><button type="button" data-op-move="'+id+'" data-op-direction="down" '+(i===siblings.length-1?'disabled':'')+' aria-label="Descer '+labels[id]+'">Descer</button></div>';}).join('');
 }
 function apply(root,prefs){
  root.style.setProperty('--arena-display-width',prefs.displayWidth+'%');
  root.classList.toggle('arena-op-stack-monitor',prefs.stackMonitor);
  tools(root).querySelector('[data-op-display-width]').value=String(prefs.displayWidth);
  tools(root).querySelector('[data-op-stack-monitor]').checked=prefs.stackMonitor;
  root.classList.toggle('arena-op-compact',prefs.compact);
  root.classList.toggle('arena-op-columns',prefs.columns);
  const grid=root.querySelector('[data-op-grid]');
  for(const [group,pinned] of [['pinned',true],['regular',false]]){
   const destination=grid.querySelector('[data-op-group="'+group+'"]');
   let next=destination.firstElementChild;
   for(const id of prefs.order){
    if(prefs.locked.includes(id)!==pinned)continue;
    const panel=grid.querySelector('[data-op-panel="'+id+'"]');
    if(!panel)continue;
    if(panel!==next)destination.insertBefore(panel,next);
    next=panel.nextElementSibling;
   }
   destination.hidden=!destination.childElementCount;
  }
  toolbar(root,prefs);
 }

 // Reserva a altura real do Menu, inclusive com texto ampliado ou tela girada.
 let observedMenu=null;
 const menuObserver=typeof window.ResizeObserver==='function'?new window.ResizeObserver(updateStickyOffset):null;
 function updateStickyOffset(){
  const menu=document.getElementById('arenaMenuToggle'),mobile=window.matchMedia('(max-width: 767px)').matches;
  if(menuObserver&&menu!==observedMenu){menuObserver.disconnect();if(menu)menuObserver.observe(menu);observedMenu=menu;}
  const rect=menu?.getBoundingClientRect(),offset=mobile?(rect&&rect.height>0?Math.ceil(rect.bottom+10):80):6;
  document.documentElement.style.setProperty('--arena-op-sticky-offset',offset+'px');
 }
 window.addEventListener('resize',updateStickyOffset);
 function describeScorePin(button,pinned){
  const label=pinned?'Desafixar placar':'Fixar placar';
  button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(pinned));
 }
 function build(match,markup,config){
  updateStickyOffset();
  const template=document.createElement('template');template.innerHTML=markup;const old=template.content,score=old.querySelector('.console-score>.match-card');if(!score)return markup;
  const root=document.createElement('div');root.className='arena-operation-workspace';root.dataset.opKey='arena-operation-layout-v1:'+encodeURIComponent(config.account||'sem-conta');
  const back=old.querySelector('[data-back]');
  const prefs=read(root.dataset.opKey);
  if(config.standby){root.dataset.opStandby='';back?.remove();}
  if(config.layoutRemote)connectLayout(root.dataset.opKey,config.layoutRemote);
  const strip=document.createElement('div');
  strip.className='arena-op-strip';
  strip.classList.toggle('is-pinned',prefs.scorePinned);
  strip.setAttribute('aria-label','Monitor da partida');
  const teams=[...score.querySelectorAll('.arena-team-identity')];
  const scores=[...score.querySelectorAll('.arena-score-value')].map(node=>node.textContent);
  const scoreboard=document.createElement('div');
  scoreboard.className='arena-monitor-teams';
  const result=document.createElement('b');
  result.textContent=scores.join(' × ');
  scoreboard.append(teams[0].cloneNode(true),result,teams[1].cloneNode(true));
  const display=document.createElement('div');
  display.className='arena-op-display';
  display.append(scoreboard);
  const clock=score.querySelector('.game-clock');if(clock)display.append(clock.cloneNode(true));
  strip.append(display);
  const pin=document.createElement('button');
  pin.type='button';pin.dataset.opPinScore='';pin.className='arena-op-score-pin';
  pin.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6v6l4 4v2H5v-2l4-4V3Zm3 12v6"/><path data-op-pin-slash d="M3 3l18 18"/></svg>';
  describeScorePin(pin,prefs.scorePinned);
  const anchor=document.createElement('div');anchor.dataset.opScoreAnchor='';anchor.setAttribute('aria-hidden','true');
  const monitor=document.createElement('nav');
  monitor.className='arena-op-monitor';monitor.dataset.opMonitor='';monitor.setAttribute('aria-label','Atalhos do placar');
  const editMonitor=document.createElement('button');
  editMonitor.type='button';editMonitor.dataset.opMonitorEdit='';editMonitor.className='arena-op-settings-trigger';
  editMonitor.setAttribute('aria-label','Personalizar a cabine');
  editMonitor.setAttribute('aria-controls','arenaOpSettings');
  editMonitor.setAttribute('aria-expanded','false');
  editMonitor.title='Personalizar a cabine';
  editMonitor.innerHTML=icon('<circle cx="12" cy="12" r="3"/><path d="M10 3h4l.6 2.8 1.7 1 2.7-.9 2 3.5-2.1 1.9v1.9l2.1 1.9-2 3.5-2.7-.9-1.7 1L14 21h-4l-.6-2.8-1.7-1-2.7.9-2-3.5 2.1-1.9v-1.9L3 8.9l2-3.5 2.7.9 1.7-1Z"/>');
  const monitorRow=document.createElement('div');monitorRow.className='arena-op-monitor-row';monitorRow.append(monitor);
  monitor.dataset.opDock='below';
  const side=document.createElement('nav');
  side.className='arena-op-monitor-side';side.dataset.opMonitorSide='';side.dataset.opDock='side';
  side.setAttribute('aria-label','Atalhos ao lado do visor');
  const controls=document.createElement('div');
  controls.className='arena-op-display-controls';
  controls.append(editMonitor,pin);
  if(match.status==='Ao vivo' || config.standby){
   const events=document.createElement('button');
   events.type='button';events.dataset.opQuickPanel='events';
   events.textContent='Cartões e faltas';
   controls.prepend(events);
   if(config.standby && !prefs.monitor.includes('notices')){
    const notices=document.createElement('button');
    notices.type='button';notices.dataset.opQuickPanel='notices';notices.textContent='Avisos';
    controls.prepend(notices);
   }
  }
  if(config.standby){
   const choose=document.createElement('button');
   choose.type='button';choose.className='primary';choose.dataset.opChoose='';
   choose.textContent='Escolher jogo';controls.prepend(choose);
  }
  const rail=document.createElement('div');
  rail.className='arena-op-display-rail';
  rail.append(controls,side);
  strip.append(rail);
  if(back&&!config.standby)monitorRow.prepend(back);
  if(config.followClock && !config.standby){
   const follow=document.createElement('button');
   follow.type='button';
   follow.dataset.clockFollow=match.id;
   follow.className='arena-op-score-pin';
   follow.title=config.clockFollowed?'Parar de acompanhar em outras telas':'Acompanhar em outras telas';
   follow.setAttribute('aria-label',follow.title);
   follow.innerHTML=icon('<path d="M9 3h6v6l4 4v2H5v-2l4-4V3Zm3 12v6"/>'+
    (config.clockFollowed?'':'<path d="M3 3l18 18"/>'));
   follow.setAttribute('aria-pressed',String(config.clockFollowed));
   controls.append(follow);
  }
  const activity=document.createElement('p');
  activity.className='arena-op-monitor-event';
  activity.textContent=match.status+(config.monitorEvent?' · Último lance: '+config.monitorEvent:'');
  const primary=document.createElement('div');
  primary.className='arena-op-primary';primary.dataset.opPrimary='';
  monitorRow.prepend(primary);
  strip.append(activity,monitorRow);
  root.append(strip);
  if(config.chooser)root.insertAdjacentHTML("beforeend",config.chooser);
  const timeline=score.querySelector('.match-timeline');if(timeline)timeline.remove();const scoreWrap=document.createElement('section');scoreWrap.className='arena-op-score';const info=document.createElement('details');info.className='arena-op-match-details';info.innerHTML='<summary>Detalhes da partida</summary>';info.append(score);scoreWrap.append(info);const guide=old.querySelector('.match-guide');root.append(scoreWrap);
  const settings=document.createElement('details');settings.className='card arena-op-settings';settings.id='arenaOpSettings';settings.innerHTML='<summary>Personalizar a cabine</summary><label><input type="checkbox" data-op-compact> Controles compactos</label><label><input type="checkbox" data-op-columns> Duas colunas em telas largas</label><fieldset class="arena-op-layout-options"><legend>Espaço do visor</legend><label>Largura do placar em telas largas<select data-op-display-width><option value="35">35%</option><option value="40">40%</option><option value="45">45%</option><option value="50">50%</option><option value="55">55%</option><option value="60">60%</option><option value="65">65%</option></select></label><label><input type="checkbox" data-op-stack-monitor> Dar a largura inteira aos comandos abaixo do placar</label></fieldset><fieldset class="arena-op-monitor-options"><legend>Botões no placar</legend><p>Marque a caixa para exibir o atalho. Arraste pela alça até um dos destinos abaixo, ou toque no botão Posicionar, Ao lado ou Abaixo.</p><div class="arena-op-dock-targets"><div data-op-dock="side"><strong>Ao lado do visor</strong><div data-op-dock-preview="side"></div></div><div data-op-dock="below"><strong>Abaixo do visor</strong><div data-op-dock-preview="below"></div></div><button type="button" data-op-view-monitor>Ver o visor</button></div><div data-op-monitor-choices></div></fieldset><div data-op-order></div><button type="button" data-op-reset>Restaurar organização padrão</button><button type="button" data-op-sync>Sincronizar ajustes deste aparelho</button><p data-op-save-status role="status">Personalização local da mesa.</p>';root.append(settings);
  const nav=document.createElement('nav');nav.className='toolbar arena-op-shortcuts';nav.dataset.opShortcuts='';nav.setAttribute('aria-label','Meus atalhos da operação');settings.append(nav);const grid=document.createElement('div');grid.className='arena-op-grid';grid.dataset.opGrid='';root.append(grid);
  for(const [group,label] of [['pinned','Caixas fixadas no topo'],['regular','Caixas desafixadas']]){
   const lane=document.createElement('div');lane.dataset.opGroup=group;
   lane.setAttribute('role','group');lane.setAttribute('aria-label',label);grid.append(lane);
  }
  const foldActions=document.createElement('div');foldActions.className='arena-op-fold-actions';
  foldActions.innerHTML='<h2>Ajustes das caixas</h2><p>Clique com o botão direito ou mantenha o dedo pressionado sobre a caixa para personalizar. Use a alça para arrastar.</p><div class="toolbar"><button type="button" data-op-fold-all="open">Expandir todas</button><button type="button" data-op-fold-all="close">Recolher todas</button></div>';
  strip.after(settings);settings.append(foldActions);
  if(guide && !config.standby)info.querySelector("summary").after(guide);
  strip.before(anchor);
  if(config.standby){
   scoreWrap.hidden=true;
   const preview=document.createElement('details');
   preview.className='card arena-op-standby-preview';
   preview.innerHTML='<summary>Ver controles em espera</summary>';
   grid.before(preview);preview.append(grid);
  }
  const quick=old.querySelector('.quick-panel'),noticeShortcuts=quick?[...quick.querySelectorAll('.quick-control-group')].find(node=>node.querySelector('h3')?.textContent==='Avisos rápidos'):null;if(noticeShortcuts)noticeShortcuts.remove();if(quick){quick.querySelectorAll('.quick-control-group').forEach(node=>node.remove());quick.querySelector(':scope>h2')?.remove();quick.querySelector(':scope>.tag')?.remove();}
  const time=old.querySelector('#mesa-tempo');if(time){time.removeAttribute('hidden');time.querySelector(':scope>h3')?.remove();}
  const notices=old.querySelector('#mesa-avisos');if(notices){notices.removeAttribute('hidden');notices.querySelector(':scope>h3')?.remove();if(noticeShortcuts)notices.append(noticeShortcuts);}
  const events=old.querySelector('#event'),eventsWrap=document.createElement('div');
  const substitution=old.querySelector('#match-substitution');
  const coach=old.querySelector('#match-coach-change');
  if(events){
   const kinds=['cartão amarelo','cartão vermelho','falta','tempo'];
   if(!substitution && [...events.elements.kind.options].some(option=>option.value==='substituição')) kinds.unshift('substituição');
   eventsWrap.innerHTML='<div class="toolbar">'+
     (substitution?'<button type="button" data-op-jump="substitutions">Substituição de jogador ou goleiro</button>':'')+
     (coach?'<button type="button" data-op-jump="coach">Troca de técnico</button>':'')+
     '<button type="button" data-op-jump="roster">Conferir elenco da partida</button></div><div class="toolbar">'+
     kinds.map(kind=>'<button type="button" data-op-event-kind="'+kind+'">'+kind+'</button>').join('')+'</div>';
   eventsWrap.append(events);
   const incoming=events.elements.playerIn;
   if(incoming){
    const team=[match.home,match.away][Number(events.elements.side.value)];
    incoming.replaceChildren(new Option('Selecione quem entra',''));
    for(const player of match.roster.filter(item=>item.team===team)){
     incoming.add(new Option((player.number?player.number+' • ':'')+player.name,player.id));
    }
   }
  }else eventsWrap.textContent='Partida encerrada. Novos lances exigem reabertura pelo administrador.';
  const pauses=old.querySelector('#interruption')?.closest('.card');
  const roster=document.createElement('div');roster.innerHTML=config.rosterHTML||'';
  const history=[...old.querySelectorAll('.card')].find(card=>card.querySelector(':scope>h3')?.textContent==='Histórico da partida')||document.createElement('div');history.querySelector(':scope>h3')?.remove();if(timeline)history.prepend(timeline);
  const noteForm=old.querySelector('#notes'),notes=noteForm?.closest('.card')||[...old.querySelectorAll('.console-actions>.card')].find(card=>card.querySelector('h3')?.textContent==='Observações operacionais da súmula');
  const championship=old.querySelector('#championship-link, #arena-correct-match-sport')?.closest('.card');
  for(const [id,node]of Object.entries({points:quick,time,substitutions:substitution,coach,events:eventsWrap,pauses,roster,notices,history,notes,championship})){const section=panel(id,node);if(section)grid.append(section);}
  if(match.status==='Ao vivo' && !config.standby){
   for(const [side,id] of ['home','away'].entries()){
    const source=root.querySelector(monitorCommands[id][1]);
    if(!source || source.disabled)continue;
    const button=document.createElement('button');
    button.type='button';button.className='arena-op-team-point';
    button.dataset.opMonitorRun=id;
    button.textContent=['Futebol','Futsal','Handebol'].includes(match.sport)?'+1 gol':'+1 ponto';
    button.setAttribute('aria-label',button.textContent+' para '+teams[side].querySelector('.name').textContent);
    scoreboard.children[side*2].append(button);
   }
  }
  if(config.standby){
   for(const control of grid.querySelectorAll('[data-op-content] :is(button,input,select,textarea,fieldset)'))
    control.disabled=false;
  }
  tools(root).querySelector('[data-op-compact]').checked=prefs.compact;tools(root).querySelector('[data-op-columns]').checked=prefs.columns;apply(root,prefs);return root.outerHTML;
 }
 function storePanelOrder(root){
  const prefs=read(root.dataset.opKey);
  const order=[...root.querySelectorAll("[data-op-panel]")].map(panel=>panel.dataset.opPanel);
  prefs.order=[...order,...prefs.order.filter(id=>!order.includes(id))];
  toolbar(root,prefs);save(root,prefs);
 }
 let drag=null;
 function updateDrop(){
  if(!drag)return;
  const target=document.elementFromPoint(drag.x,drag.y)?.closest('[data-op-panel]');
  if(!target||target===drag.panel||target.parentElement!==drag.grid||target===drag.lastTarget)return;
  const panels=[...drag.grid.children],from=panels.indexOf(drag.panel),to=panels.indexOf(target);
  const rect=target.getBoundingClientRect();
  const inSameRow=panels.some(panel=>panel!==target&&Math.abs(panel.getBoundingClientRect().top-rect.top)<2);
  const after=inSameRow?drag.x>rect.left+rect.width/2:drag.y>rect.top+rect.height/2;
  if(after!==(from<to))return;
  const motion=!matchMedia('(prefers-reduced-motion: reduce)').matches &&
   !document.documentElement.classList.contains('reduce-motion');
  const before=motion?panels.map(panel=>panel.getBoundingClientRect()):[];
  if(after)target.after(drag.panel);else target.before(drag.panel);
  drag.lastTarget=target;
  if(motion)panels.forEach((panel,index)=>{
   if(panel===drag.panel)return;
   const now=panel.getBoundingClientRect(),dx=before[index].left-now.left,dy=before[index].top-now.top;
   if(dx||dy)panel.animate?.([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],
     {duration:220,easing:'cubic-bezier(.2,.7,.3,1)'});
  });
 }
 function dragFrame(){
  if(!drag?.started)return;
  if(!drag.panel.isConnected){finishDrag(false);return;}
  drag.ghost.style.transform=`translate3d(${drag.x-drag.grabX}px,${drag.y-drag.grabY}px,0)`;
  const distance=drag.y<80?drag.y-80:drag.y>innerHeight-80?drag.y-innerHeight+80:0;
  if(distance)window.scrollBy({top:Math.max(-18,Math.min(18,distance/4)),behavior:'instant'});
  updateDrop();
  drag.frame=requestAnimationFrame(dragFrame);
 }
 function finishDrag(commit){
  if(!drag)return;
  const {panel,grid,root,initialOrder,frame,pointer,ghost}=drag;
  drag=null;
  if(frame)cancelAnimationFrame(frame);
  if(grid.hasPointerCapture?.(pointer))grid.releasePointerCapture(pointer);
  panel.removeAttribute('data-op-dragging');ghost?.remove();
  if(!grid.isConnected)return;
  if(commit)storePanelOrder(root);
  else for(const item of initialOrder)if(item.parentElement===grid)grid.append(item);
 }

 document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('[data-op-drag]');
  if(!handle||event.button!==0||!event.isPrimary||drag)return;
  const panel=handle.closest('[data-op-panel]'),root=panel.closest('.arena-operation-workspace');
  drag={panel,root,grid:panel.parentElement,initialOrder:[...panel.parentElement.children],handle,pointer:event.pointerId,x:event.clientX,y:event.clientY,
   startX:event.clientX,startY:event.clientY,started:false};
  panel.parentElement.setPointerCapture?.(event.pointerId);
 });
 document.addEventListener('pointermove',event=>{
  if(!drag||drag.pointer!==event.pointerId)return;
  drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.started && Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>5){
   const rect=drag.panel.getBoundingClientRect();
   drag.grabX=drag.startX-rect.left;drag.grabY=drag.startY-rect.top;
   const ghost=document.createElement('div');ghost.className='card arena-op-drag-preview';
   ghost.textContent=drag.panel.querySelector('h2').textContent;
   ghost.style.width=rect.width+'px';ghost.setAttribute('aria-hidden','true');
   document.body.append(ghost);drag.ghost=ghost;
   drag.started=true;drag.panel.dataset.opDragging='';dragFrame();
  }
 });
 document.addEventListener('pointerup',event=>{
  if(drag?.pointer!==event.pointerId)return;
  drag.x=event.clientX;drag.y=event.clientY;
  if(drag.started)updateDrop();
  finishDrag(drag.started);
 });
 for(const type of ['pointercancel','lostpointercapture'])document.addEventListener(type,event=>{
  if(drag?.pointer===event.pointerId)finishDrag(false);
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&drag){finishDrag(false);return;}
  const handle=event.target.closest('[data-op-drag]');
  if(handle && (event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){
   event.preventDefault();customizePanel(contextualPanel(handle));return;
  }
  if(!handle||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();
  const panel=handle.closest('[data-op-panel]'),grid=panel.parentElement;
  const neighbor=event.key==='ArrowUp'?panel.previousElementSibling:panel.nextElementSibling;
  if(!neighbor)return;
  if(event.key==='ArrowUp')neighbor.before(panel);else neighbor.after(panel);
  storePanelOrder(panel.closest('.arena-operation-workspace'));
  handle.focus({preventScroll:true});
 });
 function customizePanel(section){
  if(!section)return;
  const root=section.closest('.arena-operation-workspace'),key=root.dataset.opKey,id=section.dataset.opPanel;
  if(document.getElementById('arenaOpCustomize')?.open)return;
  const prefs=read(key),dialog=document.createElement('dialog');
  dialog.id='arenaOpCustomize';dialog.className='card arena-op-customize';
  dialog.setAttribute('aria-labelledby','arenaOpCustomizeTitle');
  dialog.innerHTML='<form><div class="arena-dialog-heading"><h2 id="arenaOpCustomizeTitle">Personalizar caixa</h2><button type="button" class="arena-close-x" data-op-customize-close aria-label="Fechar personalização" title="Fechar personalização">×</button></div>'+
    '<label>Nome<input name="panelName" maxlength="64" placeholder="Nome padrão"></label>'+
    '<label>Cor<select name="color"><option value="">Padrão</option></select></label>'+
    '<label>Posição<select name="position"></select></label>'+
    '<div class="toolbar"><button class="primary" type="submit">Salvar</button>'+
    '</div></form>';
  const form=dialog.querySelector('form');
  form.elements.panelName.value=prefs.names[id]||'';
  for(const [color,[title]] of Object.entries(panelColors))form.elements.color.add(new Option(title,color));
  form.elements.color.value=prefs.colors[id]||'';
  const visibleOrder=workspace=>[...workspace.querySelectorAll('[data-op-panel]')].map(panel=>panel.dataset.opPanel);
  const pinned=prefs.locked.includes(id);
  const order=visibleOrder(root).filter(item=>prefs.locked.includes(item)===pinned);
  for(const [index,panelId] of order.entries()){
   form.elements.position.add(new Option((index+1)+' — '+panelTitle(prefs,panelId),String(index)));
  }
  form.elements.position.value=String(order.indexOf(id));

  const opener=section.querySelector('[data-op-fold]');
  dialog.addEventListener('close',()=>{dialog.remove();if(opener.isConnected)opener.focus({preventScroll:true});});
  dialog.querySelector('[data-op-customize-close]').onclick=()=>dialog.close();
  form.addEventListener('submit',event=>{
   event.preventDefault();
   const active=[...document.querySelectorAll('.arena-operation-workspace')].find(workspace=>workspace.dataset.opKey===key);
   if(!active){dialog.close();return;}
   const next=read(key);
   if(next.locked.includes(id)!==pinned){dialog.close();return;}
   const current=visibleOrder(active).filter(item=>next.locked.includes(item)===pinned);
   if(!current.includes(id)){dialog.close();return;}
   const position=Math.min(Number(form.elements.position.value),current.length-1);
   if(!Number.isInteger(position)||position<0)return;
   current.splice(current.indexOf(id),1);
   current.splice(position,0,id);
   next.order=[...current,...next.order.filter(item=>!current.includes(item))];
   next.names[id]=form.elements.panelName.value.trim().slice(0,64);
   const color=form.elements.color.value;
   if(Object.hasOwn(panelColors,color))next.colors[id]=color;
   else delete next.colors[id];
   if(active){apply(active,next);save(active,next);}
   dialog.close();
  });
  document.body.append(dialog);dialog.showModal();
 }
 const contextualPanel=target=>target.closest('[data-op-panel]');
 const ignoreContext=target=>target.closest('input,select,textarea,button,a,[contenteditable]');
 let press=null,suppressUntil=0;
 function clearPress(){if(press)clearTimeout(press.timer);press=null;}
 document.addEventListener('contextmenu',event=>{
  const section=contextualPanel(event.target);
  if(!section||ignoreContext(event.target))return;
  event.preventDefault();clearPress();customizePanel(section);
 });
 document.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.pointerType!=='touch'||ignoreContext(event.target))return;
  const section=contextualPanel(event.target);if(!section)return;
  clearPress();
  press={id:event.pointerId,x:event.clientX,y:event.clientY,timer:setTimeout(()=>{
   clearPress();if(!section.isConnected)return;
   suppressUntil=Date.now()+700;customizePanel(section);
  },550)};
 },{passive:true});
 document.addEventListener('pointermove',event=>{
  if(press?.id===event.pointerId&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)clearPress();
 },{passive:true});
 for(const type of ['pointerup','pointercancel'])document.addEventListener(type,event=>{
  if(press?.id===event.pointerId)clearPress();
 });
 document.addEventListener('scroll',clearPress,{capture:true,passive:true});
 document.addEventListener('click',event=>{
  if(Date.now()<suppressUntil && contextualPanel(event.target)){
   event.preventDefault();event.stopImmediatePropagation();return;
  }

 },true);
 document.addEventListener('click',event=>{const button=event.target.closest('[data-op-favorite],[data-op-move],[data-op-reset],[data-op-jump],[data-op-event-kind],[data-op-pin-score],[data-op-fold],[data-op-fold-all],[data-op-lock]');if(!button)return;const root=workspaceFor(button);if(!root)return;const prefs=read(root.dataset.opKey);
  if(button.dataset.opLock){
   const id=button.dataset.opLock;
   prefs.locked=prefs.locked.includes(id)?prefs.locked.filter(key=>key!==id):[...prefs.locked,id];
   apply(root,prefs);save(root,prefs);return;
  }
  if(button.hasAttribute('data-op-pin-score')){
   prefs.scorePinned=!prefs.scorePinned;
   button.closest('.arena-op-strip').classList.toggle('is-pinned',prefs.scorePinned);
   describeScorePin(button,prefs.scorePinned);save(root,prefs);return;
  }
  if(button.dataset.opFold || button.dataset.opFoldAll){
   if(button.dataset.opFoldAll) prefs.collapsed=button.dataset.opFoldAll==='close'?[...defaults]:[];
   else {
    const id=button.dataset.opFold;
    prefs.collapsed=prefs.collapsed.includes(id)?prefs.collapsed.filter(key=>key!==id):[...prefs.collapsed,id];
   }
   toolbar(root,prefs);save(root,prefs);return;
  }
  if(button.dataset.opJump){
   const id=button.dataset.opJump,p=root.querySelector('[data-op-panel="'+id+'"]');
   if(prefs.collapsed.includes(id)){
    prefs.collapsed=prefs.collapsed.filter(key=>key!==id);toolbar(root,prefs);save(root,prefs);
   }
   p?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   p?.focus({preventScroll:true});return;
  }
  if(button.dataset.opEventKind){const form=root.querySelector('#event');if(form){form.elements.kind.value=button.dataset.opEventKind;form.elements.kind.dispatchEvent(new Event('change',{bubbles:true}));form.elements.player.focus();}return;}
  if(button.dataset.opFavorite){const id=button.dataset.opFavorite;prefs.favorites=prefs.favorites.includes(id)?prefs.favorites.filter(v=>v!==id):[...prefs.favorites,id];}
  if(button.dataset.opMove){
   const id=button.dataset.opMove;
   const visible=[...root.querySelectorAll('[data-op-panel]')].map(panel=>panel.dataset.opPanel).filter(key=>prefs.locked.includes(key)===prefs.locked.includes(id));
   const index=visible.indexOf(id);
   if(index<0)return;
   const direction=button.dataset.opDirection;
   const target=direction==='first'?0:direction==='last'?visible.length-1:index+(direction==='up'?-1:1);
   if(target<0||target>=visible.length||target===index)return;
   visible.splice(index,1);
   visible.splice(target,0,id);
   prefs.order=[...visible,...prefs.order.filter(key=>!visible.includes(key))];
  }
  if(button.hasAttribute('data-op-reset')){prefs.order=[...defaults];prefs.monitor=[...defaultMonitor];prefs.side=[];prefs.displayWidth=45;prefs.stackMonitor=false;prefs.names={};prefs.colors={};prefs.collapsed=[];prefs.locked=[];prefs.favorites=['points','time','events','history'];prefs.compact=false;prefs.columns=false;tools(root).querySelector('[data-op-compact]').checked=false;tools(root).querySelector('[data-op-columns]').checked=false;}
  apply(root,prefs);save(root,prefs);
 });
 function chooseMatch(root){
  const picker=root.querySelector('.arena-cabin-picker');
  if(!picker)return;
  picker.open=true;
  picker.querySelector('summary').focus({preventScroll:true});
  picker.scrollIntoView({block:'start'});
 }
 function openQuickPanel(root,id,opener){
  const panel=root.querySelector('[data-op-panel="'+id+'"]');
  const content=id==='pauses'?panel?.querySelector('#interruption'):panel?.querySelector('[data-op-content]')?.firstElementChild;
  if(!content){
   showNoMatch(root,opener);
   return;
  }
  if(root.querySelector('.arena-op-quick-dialog[open]'))return;
  const dialog=document.createElement('dialog');
  dialog.className='card arena-op-quick-dialog';
  dialog.setAttribute('aria-labelledby','arenaOpQuickTitle');
  dialog.innerHTML='<div class="arena-dialog-heading"><h2 id="arenaOpQuickTitle">'+escape(labels[id])+'</h2><button type="button" class="arena-close-x" aria-label="Fechar" title="Fechar">×</button></div><p data-op-quick-feedback role="status" hidden></p>';
  const marker=document.createComment('Destino do controle da cabine');
  content.before(marker);
  if(root.hasAttribute('data-op-standby')){
   const message=document.createElement('p');
   message.className='muted';
   message.textContent='Prévia dos controles. Os registros ficam disponíveis quando você abre uma partida.';
   dialog.append(message);
   content.dataset.opPreviewContent='';
  }
  dialog.append(content);root.append(dialog);
  dialog.querySelector('.arena-close-x').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
   delete content.dataset.opPreviewContent;
   marker.replaceWith(content);dialog.remove();
   if(opener.isConnected)opener.focus({preventScroll:true});
  },{once:true});
  dialog.showModal();
 }
 function showNoMatch(root,opener){
  if(root.querySelector('.arena-op-no-match[open]'))return;
  const dialog=document.createElement('dialog');
  dialog.className='card arena-op-quick-dialog arena-op-no-match';
  dialog.setAttribute('aria-labelledby','arenaOpNoMatchTitle');
  dialog.innerHTML='<div class="arena-dialog-heading"><h2 id="arenaOpNoMatchTitle">Nenhuma partida aberta</h2><button type="button" class="arena-close-x" aria-label="Fechar">×</button></div><p>Aguarde uma partida autorizada ou agende um jogo, se tiver permissão.</p>';
  root.append(dialog);
  dialog.querySelector('button').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
   dialog.remove();
   if(opener.isConnected)opener.focus({preventScroll:true});
  },{once:true});
  dialog.showModal();
 }
 // A prévia permite preencher e conhecer os controles; nenhuma ação da partida passa por aqui.
 for(const type of ['click','submit'])document.addEventListener(type,event=>{
  const control=event.target.closest(type==='click'?'button':'form');
  const root=control?.closest('[data-op-standby]');
  if(!root)return;
  if(type==='click'){
   if(!control.hasAttribute('data-op-no-match') &&
      (!control.closest('[data-op-content],[data-op-preview-content]') ||
       control.matches('[data-op-jump],[data-op-event-kind],[data-added-minutes]')))return;
  }else if(!control.closest('[data-op-content],[data-op-preview-content]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  showNoMatch(root,control);
 },true);
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-op-sync],[data-op-monitor-edit],[data-op-monitor-run],[data-op-place],[data-op-view-monitor],[data-op-choose],[data-op-quick-panel],[data-op-unavailable],[data-op-dock-command][data-op-jump="notices"],[data-op-dock-command][data-op-jump="events"]');
  if(!button||button.disabled)return;
  const root=workspaceFor(button);
  if(!root)return;
  if(button.hasAttribute('data-op-sync')){
   if(syncedLayout?.key!==root.dataset.opKey){
    syncStatus(root.dataset.opKey,'A sincronização exige uma conta conectada.');
   }else if(pendingLayout(root.dataset.opKey) || confirm('Usar os ajustes deste aparelho como padrão da sua conta?')){
    save(root,read(root.dataset.opKey));
   }
   return;
  }
  if(button.hasAttribute('data-op-choose')){
   chooseMatch(root);
   return;
  }
  if(button.hasAttribute('data-op-unavailable')){
   const status=root.querySelector('.arena-op-monitor-event');
   if(status)status.textContent=button.title;
   return;
  }
  const quickPanel=button.dataset.opQuickPanel || button.dataset.opJump;
  if(button.hasAttribute('data-op-quick-panel') || quickPanel==='notices' || quickPanel==='events'){
   openQuickPanel(root,quickPanel,button);
   return;
  }
  if(button.hasAttribute('data-op-place')){
   dockMenu(root,button);
   return;
  }
  if(button.hasAttribute('data-op-view-monitor')){
   tools(root).open=false;
   const monitor=root.querySelector('.arena-op-strip');
   monitor.tabIndex=-1;
   monitor.focus({preventScroll:true});
   root.querySelector('[data-op-score-anchor]').scrollIntoView({block:'start'});
   return;
  }
  if(button.hasAttribute('data-op-monitor-edit')){
   const settings=tools(root);
   settings.open=!settings.open;
   button.setAttribute('aria-expanded',String(settings.open));
   if(settings.open){
    const strip=root.querySelector('.arena-op-strip');
    const style=getComputedStyle(strip);
    const top=style.position==='sticky'?(parseFloat(style.top)||0)+strip.offsetHeight:0;
    settings.style.scrollMarginTop=top+12+'px';
    settings.scrollIntoView({block:'start'});
    settings.querySelector('summary')?.focus({preventScroll:true});
   }
   return;
  }
  if(['pause','suspend'].includes(button.dataset.opMonitorRun)){
   openQuickPanel(root,'pauses',button);
   return;
  }
  const command=monitorCommands[button.dataset.opMonitorRun];
  const source=command?.[1]&&root.querySelector(command[1]);
  if(!root.hasAttribute('data-op-standby')&&source&&!source.disabled)source.click();
 });
 document.addEventListener('change',event=>{
  const input=event.target.closest('[data-op-monitor-choice]');if(!input)return;
  const root=workspaceFor(input);if(!root)return;
  const prefs=read(root.dataset.opKey),id=input.dataset.opMonitorChoice;
  if(!Object.hasOwn(monitorCommands,id))return;
  prefs.monitor=input.checked?[...new Set([...prefs.monitor,id])]:prefs.monitor.filter(key=>key!==id);
  monitorToolbar(root,prefs);
  tools(root).querySelector('[data-op-monitor-choice="'+id+'"]')?.focus({preventScroll:true});
  save(root,prefs);
 });
 document.addEventListener('change',event=>{if(!event.target.matches('[data-op-compact],[data-op-columns],[data-op-display-width],[data-op-stack-monitor]'))return;const root=workspaceFor(event.target);if(!root)return;const prefs=read(root.dataset.opKey);prefs.compact=tools(root).querySelector('[data-op-compact]').checked;prefs.columns=tools(root).querySelector('[data-op-columns]').checked;prefs.displayWidth=Number(tools(root).querySelector('[data-op-display-width]').value);prefs.stackMonitor=tools(root).querySelector('[data-op-stack-monitor]').checked;apply(root,prefs);save(root,prefs);});
 window.addEventListener('storage',event=>{if(event.key?.startsWith('arena-operation-layout-v1:'))sessionPreferences.delete(event.key);});
 function preview(account) {
  const prefs=read('arena-operation-layout-v1:'+encodeURIComponent(account||'sem-conta'));
  const shortcuts=prefs.monitor.map(id=>escape(monitorCommands[id][0])).join(' · ');
  return '<details><summary>Ajustes atuais da mesa</summary><p><strong>Atalhos no monitor:</strong> '+(shortcuts||'Nenhum')+'</p><p><strong>Controles:</strong> '+(prefs.compact?'compactos':'tamanho padrão')+' · '+(prefs.columns?'duas colunas em tela larga':'uma coluna')+'</p><p><strong>Ordem das caixas:</strong> '+prefs.order.map(id=>escape(panelTitle(prefs,id))).join(' · ')+'</p><p>Para mudar esses ajustes, abra uma partida e use Minha mesa de operação.</p></details>';
 }
 function dockCommand(root,id,place,before){
  const prefs=read(root.dataset.opKey);
  prefs.monitor=prefs.monitor.filter(key=>key!==id);
  prefs.side=prefs.side.filter(key=>key!==id);
  if(place!=='remove') {
   const at=prefs.monitor.indexOf(before);
   prefs.monitor.splice(at<0?prefs.monitor.length:at,0,id);
  }
  if(place==='side')prefs.side.push(id);
  monitorToolbar(root,prefs);save(root,prefs);
 }
 function dockMenu(root,source){
  const id=source.dataset.opDockCommand;
  const dialog=document.createElement('dialog');
  dialog.className='card arena-dock-dialog';
  const prefs=read(root.dataset.opKey), place=prefs.side.includes(id)?'side':'below';
  const peers=prefs.monitor.filter(key=>!dedicatedCommands.includes(key)&&(prefs.side.includes(key)?'side':'below')===place);
  const index=peers.indexOf(id);
  const reorder=index<0?'':'<button value="earlier" '+(index===0?'disabled':'')+'>Mover para antes</button><button value="later" '+(index===peers.length-1?'disabled':'')+'>Mover para depois</button>';
  dialog.setAttribute('aria-labelledby','arenaOpDockTitle');
  dialog.innerHTML='<form method="dialog"><div class="arena-dialog-heading"><h2 id="arenaOpDockTitle">'+escape(monitorCommands[id][0])+'</h2><button value="cancel" class="arena-close-x" aria-label="Fechar" title="Fechar">×</button></div><div class="toolbar"><button value="side">Ao lado</button><button value="below">Abaixo</button>'+reorder+'<button value="remove">Retirar do visor</button></div></form>';
  document.body.append(dialog);
  dialog.addEventListener('close',()=>{
   const action=dialog.returnValue;
   if(root.isConnected){
    if(['side','below','remove'].includes(action))dockCommand(root,id,action);
    else if(action==='earlier' && index>0)dockCommand(root,id,place,peers[index-1]);
    else if(action==='later' && index>=0 && index<peers.length-1)dockCommand(root,id,place,peers[index+2]);
   }
   dialog.remove();
  },{once:true});
  dialog.showModal();
 }
 let dockDrag, dockPress, dockTimer, dockSuppressedUntil=0;
 document.addEventListener('dragstart',event=>{
  const source=event.target.closest('[data-op-dock-command][draggable="true"]');
  const root=source&&workspaceFor(source);
  if(!root)return;
  dockDrag={root,id:source.dataset.opDockCommand};
  root.classList.add('arena-docking');
  event.dataTransfer.effectAllowed='copy';
  event.dataTransfer.setData('text/plain',source.textContent.trim());
 });
 document.addEventListener('dragover',event=>{
  const destination=event.target.closest('[data-op-dock]');
  if(!dockDrag||!destination||workspaceFor(destination)!==dockDrag.root)return;
  event.preventDefault();event.dataTransfer.dropEffect='copy';
 });
 document.addEventListener('drop',event=>{
  const destination=event.target.closest('[data-op-dock]');
  if(!dockDrag||!destination||workspaceFor(destination)!==dockDrag.root)return;
  event.preventDefault();
  const {root,id}=dockDrag;root.classList.remove('arena-docking');dockDrag=null;
  const target=event.target.closest('[data-op-dock-command]');
  if(target?.dataset.opDockCommand!==id)dockCommand(root,id,destination.dataset.opDock,target?.dataset.opDockCommand);
 });
 document.addEventListener('dragend',()=>{dockDrag?.root.classList.remove('arena-docking');dockDrag=null;});
 function openDockOptions(event){
  const source=event.target.closest('[data-op-dock-command]');
  const root=source&&workspaceFor(source);
  if(!root||source.hasAttribute('data-op-drag'))return;
  event.preventDefault();dockMenu(root,source);
 }
 document.addEventListener('contextmenu',openDockOptions);
 document.addEventListener('keydown',event=>{
  if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')openDockOptions(event);
 });
 document.addEventListener('pointerdown',event=>{
  const source=event.target.closest('[data-op-dock-command]');
  const root=source&&workspaceFor(source);
  if(!root||!event.isPrimary||event.pointerType==='mouse'||source.hasAttribute('data-op-drag'))return;
  cancelDockPress();
  dockPress={x:event.clientX,y:event.clientY};
  dockTimer=setTimeout(()=>{dockSuppressedUntil=Date.now()+850;dockMenu(root,source);},600);
 },{passive:true});
 const cancelDockPress=()=>{clearTimeout(dockTimer);dockPress=null;};
 document.addEventListener('pointermove',event=>{
  if(dockPress&&Math.hypot(event.clientX-dockPress.x,event.clientY-dockPress.y)>10)cancelDockPress();
 },{passive:true});
 for(const type of ['pointerup','pointercancel','scroll'])document.addEventListener(type,cancelDockPress,{passive:true,capture:true});
 document.addEventListener('click',event=>{
  if(Date.now()<dockSuppressedUntil&&event.target.closest('[data-op-dock-command]')){
   event.preventDefault();event.stopImmediatePropagation();
  }
 },true);
 window.ArenaOperation=Object.freeze({build,preview,restoreSyncStatus});
})();
