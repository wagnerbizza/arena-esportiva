/* Mesa de operação: organiza os controles existentes e guarda apenas preferências locais. */
(function(){
 'use strict';if(window.ArenaOperation)return;
 const defaults=['points','time','substitutions','coach','events','pauses','roster','notices','notes','championship','history'];
 const labels={points:'Pontos e cartões',time:'Tempo e acréscimos',substitutions:'Substituições de atletas e goleiros',coach:'Troca de técnico',events:'Cartões, faltas e outros lances',pauses:'Situação e etapas',roster:'Elenco da partida',notices:'Avisos ao público',history:'Histórico e anulações',notes:'Observações da súmula',championship:'Vínculo ao campeonato'};
 const icon=(path)=>'<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
 const star=icon('<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z"/>');
 const chevron=icon('<path d="m6 9 6 6 6-6"/>');
 const grip=icon('<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3.5"/>');
 const monitorCommands = {
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
 const defaultMonitor = ['end','resume','pause','notices'];
 const sessionPreferences=new Map();
 const panelColors={azul:['Azul','#45a4ff'],verde:['Verde','#49c99a'],laranja:['Laranja','#f4a858'],roxo:['Roxo','#b58cff'],rosa:['Rosa','#ee80ac']};
 const panelTitle=(prefs,id)=>prefs.names?.[id]||labels[id];
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function read(key){let saved=sessionPreferences.get(key);if(!saved)try{saved=JSON.parse(localStorage.getItem(key));}catch{}return {order:[...new Set([...(Array.isArray(saved?.order)?saved.order.filter(id=>defaults.includes(id)):[]),...defaults])],favorites:Array.isArray(saved?.favorites)?[...new Set(saved.favorites.filter(id=>defaults.includes(id)))]:['points','time','events','history'],names:Object.fromEntries(defaults.filter(id=>typeof saved?.names?.[id]==="string").map(id=>[id,saved.names[id].trim().slice(0,64)])),colors:Object.fromEntries(defaults.filter(id=>Object.hasOwn(panelColors,saved?.colors?.[id])).map(id=>[id,saved.colors[id]])),locked:Array.isArray(saved?.locked)?saved.locked.filter(id=>defaults.includes(id)):[],collapsed:Array.isArray(saved?.collapsed)?saved.collapsed.filter(id=>defaults.includes(id)):[],monitor:Array.isArray(saved?.monitor)?[...new Set(saved.monitor.filter(id=>Object.hasOwn(monitorCommands,id)))]:[...defaultMonitor],scorePinned:saved?.scorePinned!==false,compact:saved?.compact===true,columns:saved?.columns===true};}
 let syncedLayout=null;
 function currentWorkspace(key){
  return [...document.querySelectorAll('.arena-operation-workspace')].find(root=>root.dataset.opKey===key);
 }
 function syncStatus(key,text){
  const label=currentWorkspace(key)?.querySelector('[data-op-save-status]');
  if(label)label.textContent=text;
 }
 function connectLayout(key,remote){
  if(!remote||!remote.uid)return;
  if(syncedLayout?.key===key&&syncedLayout.remote.uid===remote.uid)return;
  syncedLayout?.stop?.();
  const connection={key,remote,writes:0};
  syncedLayout=connection;
  connection.stop=remote.watch(payload=>{
   if(syncedLayout!==connection||connection.writes)return;
   if(payload===null){
    let local;try{local=localStorage.getItem(key);}catch{}
    if(local)remote.seed(JSON.stringify(read(key))).catch(()=>{});
    return;
   }
   let stored;try{stored=JSON.parse(payload);}catch{return;}
   if(!stored||typeof stored!=='object'||Array.isArray(stored))return;
   sessionPreferences.set(key,stored);
   const prefs=read(key);
   try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}
   const root=currentWorkspace(key);
   if(root&&!drag){
    root.querySelector('[data-op-compact]').checked=prefs.compact;
    root.querySelector('[data-op-columns]').checked=prefs.columns;
    const strip=root.querySelector('.arena-op-strip');
    strip.classList.toggle('is-pinned',prefs.scorePinned);
    describeScorePin(strip.querySelector('[data-op-pin-score]'),prefs.scorePinned);
    apply(root,prefs);
   }
   syncStatus(key,'Preferências sincronizadas com a conta.');
  },()=>syncStatus(key,'Sincronização indisponível. Preferências mantidas neste navegador.'));
 }
 function save(root,prefs){
  const key=root.dataset.opKey;
  sessionPreferences.set(key,prefs);
  try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}
  const connection=syncedLayout;
  if(connection?.key!==key){syncStatus(key,'Preferências salvas neste navegador.');return;}
  connection.writes++;
  connection.remote.write(JSON.stringify(prefs)).then(()=>{
   if(syncedLayout===connection)syncStatus(key,'Preferências sincronizadas com a conta.');
  },()=>{
   if(syncedLayout===connection)syncStatus(key,'Sincronização indisponível. Preferências mantidas neste navegador.');
  }).finally(()=>connection.writes--);
 }

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
  const choices=root.querySelector('[data-op-monitor-choices]');
  menu.replaceChildren();
  for(const id of prefs.monitor){
   const [label,selector,panelId]=monitorCommands[id];
   const source=selector?root.querySelector(selector):root.querySelector('[data-op-panel="'+panelId+'"]');
   if(!source)continue;
   const button=document.createElement('button');
   button.type='button';
   if(panelId)button.dataset.opJump=panelId;else button.dataset.opMonitorRun=id;
   button.textContent=id==='resume'?(source.textContent.trim().startsWith('Retomar')?'Continuar':source.textContent.trim()):label;
   button.disabled=source.disabled===true;
   menu.append(button);
  }
  choices.innerHTML=Object.entries(monitorCommands).map(([id,[label]])=>
   '<label><input type="checkbox" data-op-monitor-choice="'+id+'" '+(prefs.monitor.includes(id)?'checked':'')+'> '+escape(label)+'</label>').join('');
 }
 function toolbar(root,prefs){monitorToolbar(root,prefs);const nav=root.querySelector('[data-op-shortcuts]');nav.replaceChildren();const panels=[...root.querySelectorAll('[data-op-panel]')];for(const section of panels){const id=section.dataset.opPanel,fold=section.querySelector('[data-op-fold]'),closed=prefs.collapsed.includes(id);
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
  const list=root.querySelector('[data-op-order]');list.innerHTML=panels.map(section=>{const id=section.dataset.opPanel,siblings=[...section.parentElement.children],i=siblings.indexOf(section);return '<div class="arena-op-order-row"><span>'+escape(panelTitle(prefs,id))+'</span><button type="button" data-op-favorite="'+id+'" aria-pressed="'+prefs.favorites.includes(id)+'">'+(prefs.favorites.includes(id)?'Favorito':'Favoritar')+'</button><button type="button" data-op-move="'+id+'" data-op-direction="first" '+(i===0?'disabled':'')+'>Colocar primeiro</button><button type="button" data-op-move="'+id+'" data-op-direction="last" '+(i===siblings.length-1?'disabled':'')+'>Colocar por último</button><button type="button" data-op-move="'+id+'" data-op-direction="up" '+(i===0?'disabled':'')+' aria-label="Subir '+labels[id]+'">Subir</button><button type="button" data-op-move="'+id+'" data-op-direction="down" '+(i===siblings.length-1?'disabled':'')+' aria-label="Descer '+labels[id]+'">Descer</button></div>';}).join('');
 }
 function apply(root,prefs){
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
  const teams=[...score.querySelectorAll('.score .name')].map(node=>node.textContent);
  const scores=[...score.querySelectorAll('.arena-score-value')].map(node=>node.textContent);
  const result=scores.length===2?scores.join(' × '):score.querySelector('.score>strong')?.textContent||'';
  strip.innerHTML='<div><strong>'+escape(teams.join(' × '))+'</strong><b>'+escape(result)+'</b></div>';
  const clock=score.querySelector('.game-clock');if(clock)strip.append(clock.cloneNode(true));
  const pin=document.createElement('button');
  pin.type='button';pin.dataset.opPinScore='';pin.className='arena-op-score-pin';
  pin.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6v6l4 4v2H5v-2l4-4V3Zm3 12v6"/><path data-op-pin-slash d="M3 3l18 18"/></svg>';
  describeScorePin(pin,prefs.scorePinned);strip.append(pin);
  const anchor=document.createElement('div');anchor.dataset.opScoreAnchor='';anchor.setAttribute('aria-hidden','true');
  if(back&&!config.standby){back.classList.add('primary','arena-op-back');strip.prepend(back);}
  const monitor=document.createElement('nav');
  monitor.className='arena-op-monitor';monitor.dataset.opMonitor='';monitor.setAttribute('aria-label','Atalhos do placar');
  const editMonitor=document.createElement('button');
  editMonitor.type='button';editMonitor.dataset.opMonitorEdit='';editMonitor.textContent='Atalhos';
  const monitorRow=document.createElement('div');monitorRow.className='arena-op-monitor-row';monitorRow.append(monitor,editMonitor);
  if(config.followClock){
   const follow=document.createElement('button');
   follow.type='button';
   follow.dataset.clockFollow=match.id;
   follow.textContent=config.clockFollowed?'Desafixar monitor':'Fixar monitor';
   follow.setAttribute('aria-pressed',String(config.clockFollowed));
   monitorRow.append(follow);
  }
  const activity=document.createElement('p');
  activity.className='arena-op-monitor-event';
  activity.textContent=match.status+(config.monitorEvent?' · Último lance: '+config.monitorEvent:'');
  strip.append(activity,monitorRow);
  root.append(strip);
  const timeline=score.querySelector('.match-timeline');if(timeline)timeline.remove();const scoreWrap=document.createElement('section');scoreWrap.className='arena-op-score';scoreWrap.append(score);const guide=old.querySelector('.match-guide');root.append(scoreWrap);
  const settings=document.createElement('details');settings.className='card arena-op-settings';settings.innerHTML='<summary>Minha mesa de operação: atalhos e organização</summary><label><input type="checkbox" data-op-compact> Controles compactos</label><label><input type="checkbox" data-op-columns> Duas colunas em telas largas</label><fieldset class="arena-op-monitor-options"><legend>Botões no placar</legend><p>Marque os atalhos que deseja mostrar. Os botões aparecem quando servem para o jogo e a situação atual.</p><div data-op-monitor-choices></div></fieldset><div data-op-order></div><button type="button" data-op-reset>Restaurar organização padrão</button><p data-op-save-status role="status">Personalização local da mesa.</p>';root.append(settings);
  const nav=document.createElement('nav');nav.className='toolbar arena-op-shortcuts';nav.dataset.opShortcuts='';nav.setAttribute('aria-label','Meus atalhos da operação');root.append(nav);const grid=document.createElement('div');grid.className='arena-op-grid';grid.dataset.opGrid='';root.append(grid);
  for(const [group,label] of [['pinned','Caixas fixadas no topo'],['regular','Caixas desafixadas']]){
   const lane=document.createElement('div');lane.dataset.opGroup=group;
   lane.setAttribute('role','group');lane.setAttribute('aria-label',label);grid.append(lane);
  }
  const foldActions=document.createElement('div');foldActions.className='card arena-op-fold-actions';
  foldActions.innerHTML='<h2>Ajustes das caixas</h2><p>Clique com o botão direito ou mantenha o dedo pressionado sobre a caixa para personalizar. Use a alça para arrastar.</p><div class="toolbar"><button type="button" data-op-fold-all="open">Expandir todas</button><button type="button" data-op-fold-all="close">Recolher todas</button></div>';
  strip.before(settings,nav);grid.before(foldActions);
  if(guide)strip.before(guide);strip.before(anchor);
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
  const championship=old.querySelector('#championship-link')?.closest('.card');
  for(const [id,node]of Object.entries({points:quick,time,substitutions:substitution,coach,events:eventsWrap,pauses,roster,notices,history,notes,championship})){const section=panel(id,node);if(section)grid.append(section);}
  if(config.standby){
   for(const area of root.querySelectorAll('[data-op-content], .match-guide, .arena-op-score')){
    for(const control of area.querySelectorAll('button, input, select, textarea, fieldset')){
     if(!control.hasAttribute('data-op-jump'))control.disabled=true;
    }
   }
  }
  root.querySelector('[data-op-compact]').checked=prefs.compact;root.querySelector('[data-op-columns]').checked=prefs.columns;apply(root,prefs);return root.outerHTML;
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
  dialog.innerHTML='<form><h2 id="arenaOpCustomizeTitle">Personalizar caixa</h2>'+
    '<label>Nome<input name="panelName" maxlength="64" placeholder="Nome padrão"></label>'+
    '<label>Cor<select name="color"><option value="">Padrão</option></select></label>'+
    '<label>Posição<select name="position"></select></label>'+
    '<div class="toolbar"><button class="primary" type="submit">Salvar</button>'+
    '<button type="button" data-op-customize-close>Cancelar</button></div></form>';
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
 document.addEventListener('click',event=>{const button=event.target.closest('[data-op-favorite],[data-op-move],[data-op-reset],[data-op-jump],[data-op-event-kind],[data-op-pin-score],[data-op-fold],[data-op-fold-all],[data-op-lock]');if(!button)return;const root=button.closest('.arena-operation-workspace');if(!root)return;const prefs=read(root.dataset.opKey);
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
  if(button.hasAttribute('data-op-reset')){prefs.order=[...defaults];prefs.monitor=[...defaultMonitor];prefs.names={};prefs.colors={};prefs.collapsed=[];prefs.locked=[];prefs.favorites=['points','time','events','history'];prefs.compact=false;prefs.columns=false;root.querySelector('[data-op-compact]').checked=false;root.querySelector('[data-op-columns]').checked=false;}
  apply(root,prefs);save(root,prefs);
 });
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-op-monitor-edit],[data-op-monitor-run]');
  if(!button||button.disabled)return;
  const root=button.closest('.arena-operation-workspace');
  if(!root)return;
  if(button.hasAttribute('data-op-monitor-edit')){
   const settings=root.querySelector('.arena-op-settings');
   settings.open=true;
   settings.scrollIntoView({block:'center'});
   settings.querySelector('[data-op-monitor-choice]')?.focus({preventScroll:true});
   return;
  }
  const command=monitorCommands[button.dataset.opMonitorRun];
  const source=command?.[1]&&root.querySelector(command[1]);
  if(!root.hasAttribute('data-op-standby')&&source&&!source.disabled)source.click();
 });
 document.addEventListener('change',event=>{
  const input=event.target.closest('[data-op-monitor-choice]');if(!input)return;
  const root=input.closest('.arena-operation-workspace');if(!root)return;
  const prefs=read(root.dataset.opKey),id=input.dataset.opMonitorChoice;
  if(!Object.hasOwn(monitorCommands,id))return;
  prefs.monitor=input.checked?[...new Set([...prefs.monitor,id])]:prefs.monitor.filter(key=>key!==id);
  monitorToolbar(root,prefs);
  root.querySelector('[data-op-monitor-choice="'+id+'"]')?.focus({preventScroll:true});
  save(root,prefs);
 });
 document.addEventListener('change',event=>{if(!event.target.matches('[data-op-compact],[data-op-columns]'))return;const root=event.target.closest('.arena-operation-workspace');if(!root)return;const prefs=read(root.dataset.opKey);prefs.compact=root.querySelector('[data-op-compact]').checked;prefs.columns=root.querySelector('[data-op-columns]').checked;apply(root,prefs);save(root,prefs);});
 window.addEventListener('storage',event=>{if(event.key?.startsWith('arena-operation-layout-v1:'))sessionPreferences.delete(event.key);});
 function preview(account) {
  const prefs=read('arena-operation-layout-v1:'+encodeURIComponent(account||'sem-conta'));
  const shortcuts=prefs.monitor.map(id=>escape(monitorCommands[id][0])).join(' · ');
  return '<details><summary>Ajustes atuais da mesa</summary><p><strong>Atalhos no monitor:</strong> '+(shortcuts||'Nenhum')+'</p><p><strong>Controles:</strong> '+(prefs.compact?'compactos':'tamanho padrão')+' · '+(prefs.columns?'duas colunas em tela larga':'uma coluna')+'</p><p><strong>Ordem das caixas:</strong> '+prefs.order.map(id=>escape(panelTitle(prefs,id))).join(' · ')+'</p><p>Para mudar esses ajustes, abra uma partida e use Minha mesa de operação.</p></details>';
 }
 window.ArenaOperation=Object.freeze({build,preview});
})();
