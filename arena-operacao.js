/* Mesa de operação: organiza os controles existentes e guarda apenas preferências locais. */
(function(){
 'use strict';if(window.ArenaOperation)return;
 const defaults=['points','time','substitutions','coach','events','pauses','roster','notices','notes','championship','history'];
 const labels={points:'Pontos e cartões',time:'Tempo e acréscimos',substitutions:'Substituições de atletas e goleiros',coach:'Troca de técnico',events:'Cartões, faltas e outros lances',pauses:'Situação e etapas',roster:'Elenco da partida',notices:'Avisos ao público',history:'Histórico e anulações',notes:'Observações da súmula',championship:'Vínculo ao campeonato'};
 const sessionPreferences=new Map();
 const panelColors={azul:['Azul','#45a4ff'],verde:['Verde','#49c99a'],laranja:['Laranja','#f4a858'],roxo:['Roxo','#b58cff'],rosa:['Rosa','#ee80ac']};
 const panelTitle=(prefs,id)=>prefs.names?.[id]||labels[id];
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function read(key){let saved=sessionPreferences.get(key);if(!saved)try{saved=JSON.parse(localStorage.getItem(key));}catch{}return {order:[...new Set([...(Array.isArray(saved?.order)?saved.order.filter(id=>defaults.includes(id)):[]),...defaults])],favorites:Array.isArray(saved?.favorites)?[...new Set(saved.favorites.filter(id=>defaults.includes(id)))]:['points','time','events','history'],names:Object.fromEntries(defaults.filter(id=>typeof saved?.names?.[id]==="string").map(id=>[id,saved.names[id].trim().slice(0,64)])),colors:Object.fromEntries(defaults.filter(id=>Object.hasOwn(panelColors,saved?.colors?.[id])).map(id=>[id,saved.colors[id]])),collapsed:Array.isArray(saved?.collapsed)?saved.collapsed.filter(id=>defaults.includes(id)):[],scorePinned:saved?.scorePinned!==false,compact:saved?.compact===true,columns:saved?.columns===true};}
 function save(root,prefs){sessionPreferences.set(root.dataset.opKey,prefs);try{localStorage.setItem(root.dataset.opKey,JSON.stringify(prefs));}catch{const label=root.querySelector('[data-op-save-status]');if(label)label.textContent='Preferência aplicada nesta tela; o navegador não permitiu salvar.';return;}const label=root.querySelector('[data-op-save-status]');if(label)label.textContent='Preferências salvas para esta conta neste navegador.';}
 function panel(id,node){if(!node)return null;node.removeAttribute('hidden');node.classList?.remove('card');const section=document.createElement('section');section.id='arena-op-'+id;section.className='card arena-op-panel';section.dataset.opPanel=id;section.tabIndex=-1;section.innerHTML='<div class="arena-op-heading"><h2>'+labels[id]+'</h2><button type="button" data-op-favorite="'+id+'" aria-pressed="false" title="Favoritar '+labels[id]+'">Favoritar</button></div>';const toggle=document.createElement('button');toggle.type='button';toggle.dataset.opFold=id;
  toggle.setAttribute('aria-controls',section.id+'-content');const customize=document.createElement('button');customize.type='button';customize.dataset.opCustomize=id;customize.textContent='⋯';
  section.querySelector('.arena-op-heading').append(toggle,customize);
  const content=document.createElement('div');content.id=section.id+'-content';content.dataset.opContent='';
  content.append(node);section.append(content);return section;}
 function toolbar(root,prefs){const nav=root.querySelector('[data-op-shortcuts]');nav.replaceChildren();const panels=[...root.querySelectorAll('[data-op-panel]')];for(const section of panels){const id=section.dataset.opPanel,fold=section.querySelector('[data-op-fold]'),closed=prefs.collapsed.includes(id);
   const title=panelTitle(prefs,id),color=panelColors[prefs.colors[id]];
   section.querySelector('h2').textContent=title;
   section.querySelector('[data-op-customize]').setAttribute('aria-label','Personalizar '+title);
   if(color)section.style.setProperty('--arena-op-box-color',color[1]);
   else section.style.removeProperty('--arena-op-box-color');
   fold.textContent=closed?'Expandir':'Recolher';fold.setAttribute('aria-expanded',String(!closed));
   fold.setAttribute('aria-label',fold.textContent+' '+title);section.querySelector('[data-op-content]').hidden=closed;
   const favorite=prefs.favorites.includes(id),button=section.querySelector('[data-op-favorite]');button.setAttribute('aria-pressed',String(favorite));button.textContent=favorite?'Favorito':'Favoritar';button.title=(favorite?'Remover dos favoritos: ':'Favoritar: ')+labels[id];if(favorite){const jump=document.createElement('button');jump.type='button';jump.dataset.opJump=id;jump.textContent=title;nav.append(jump);}}
  if(!nav.children.length)nav.textContent='Use Favoritar nas seções para criar seus atalhos de operação.';
  const list=root.querySelector('[data-op-order]');list.innerHTML=panels.map((section,i)=>{const id=section.dataset.opPanel;return '<div class="arena-op-order-row"><span>'+escape(panelTitle(prefs,id))+'</span><button type="button" data-op-move="'+id+'" data-op-direction="first" '+(i===0?'disabled':'')+'>Colocar primeiro</button><button type="button" data-op-move="'+id+'" data-op-direction="last" '+(i===panels.length-1?'disabled':'')+'>Colocar por último</button><button type="button" data-op-move="'+id+'" data-op-direction="up" '+(i===0?'disabled':'')+' aria-label="Subir '+labels[id]+'">Subir</button><button type="button" data-op-move="'+id+'" data-op-direction="down" '+(i===panels.length-1?'disabled':'')+' aria-label="Descer '+labels[id]+'">Descer</button></div>';}).join('');
 }
 function apply(root,prefs){root.classList.toggle('arena-op-compact',prefs.compact);root.classList.toggle('arena-op-columns',prefs.columns);const grid=root.querySelector('[data-op-grid]');for(const id of prefs.order){const p=grid.querySelector('[data-op-panel="'+id+'"]');if(p && p!==grid.lastElementChild)grid.append(p);}toolbar(root,prefs);}
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
  const strip=document.createElement('div');
  strip.className='arena-op-strip';
  strip.classList.toggle('is-pinned',prefs.scorePinned);
  strip.setAttribute('aria-label','Placar e relógio da operação');
  const teams=[...score.querySelectorAll('.score .name')].map(node=>node.textContent);
  const scores=[...score.querySelectorAll('.arena-score-value')].map(node=>node.textContent);
  const result=scores.length===2?scores.join(' × '):score.querySelector('.score>strong')?.textContent||'';
  strip.innerHTML='<div><strong>'+escape(teams.join(' × '))+'</strong><b>'+escape(result)+'</b></div>';
  const clock=score.querySelector('.game-clock');if(clock)strip.append(clock.cloneNode(true));
  const pin=document.createElement('button');
  pin.type='button';pin.dataset.opPinScore='';pin.className='arena-op-score-pin';
  pin.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6v6l4 4v2H5v-2l4-4V3Zm3 12v6"/><path data-op-pin-slash d="M3 3l18 18"/></svg>';
  describeScorePin(pin,prefs.scorePinned);strip.append(pin);
  if(back){back.classList.add('primary','arena-op-back');strip.prepend(back);}
  root.append(strip);
  const timeline=score.querySelector('.match-timeline');if(timeline)timeline.remove();const scoreWrap=document.createElement('section');scoreWrap.className='arena-op-score';scoreWrap.append(score);const guide=old.querySelector('.match-guide');root.append(scoreWrap);
  const settings=document.createElement('details');settings.className='card arena-op-settings';settings.innerHTML='<summary>Minha mesa de operação: atalhos e organização</summary><label><input type="checkbox" data-op-compact> Controles compactos</label><label><input type="checkbox" data-op-columns> Duas colunas em telas largas</label><div data-op-order></div><button type="button" data-op-reset>Restaurar organização padrão</button><p data-op-save-status role="status">Personalização local da mesa.</p>';root.append(settings);
  const nav=document.createElement('nav');nav.className='toolbar arena-op-shortcuts';nav.dataset.opShortcuts='';nav.setAttribute('aria-label','Meus atalhos da operação');root.append(nav);const grid=document.createElement('div');grid.className='arena-op-grid';grid.dataset.opGrid='';root.append(grid);
  const foldActions=document.createElement('div');foldActions.className='toolbar arena-op-fold-actions';
  foldActions.innerHTML='<button type="button" data-op-fold-all="open">Expandir todas</button><button type="button" data-op-fold-all="close">Recolher todas</button>';
  strip.before(settings,nav,foldActions);
  if(guide)strip.before(guide);
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
  root.querySelector('[data-op-compact]').checked=prefs.compact;root.querySelector('[data-op-columns]').checked=prefs.columns;apply(root,prefs);return root.outerHTML;
 }
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
  const order=visibleOrder(root);
  for(const [index,panelId] of order.entries()){
   form.elements.position.add(new Option((index+1)+' — '+panelTitle(prefs,panelId),String(index)));
  }
  form.elements.position.value=String(order.indexOf(id));
  const opener=section.querySelector('[data-op-customize]');
  dialog.addEventListener('close',()=>{dialog.remove();if(opener.isConnected)opener.focus({preventScroll:true});});
  dialog.querySelector('[data-op-customize-close]').onclick=()=>dialog.close();
  form.addEventListener('submit',event=>{
   event.preventDefault();
   const active=[...document.querySelectorAll('.arena-operation-workspace')].find(workspace=>workspace.dataset.opKey===key);
   const current=active?visibleOrder(active):order;
   if(!current.includes(id)){dialog.close();return;}
   const next=read(key),position=Math.min(Number(form.elements.position.value),current.length-1);
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
  const button=event.target.closest('[data-op-customize]');
  if(button)customizePanel(contextualPanel(button));
 },true);
 document.addEventListener('click',event=>{const button=event.target.closest('[data-op-favorite],[data-op-move],[data-op-reset],[data-op-jump],[data-op-event-kind],[data-op-pin-score],[data-op-fold],[data-op-fold-all]');if(!button)return;const root=button.closest('.arena-operation-workspace');if(!root)return;const prefs=read(root.dataset.opKey);
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
   const visible=[...root.querySelectorAll('[data-op-panel]')].map(panel=>panel.dataset.opPanel);
   const index=visible.indexOf(id);
   if(index<0)return;
   const direction=button.dataset.opDirection;
   const target=direction==='first'?0:direction==='last'?visible.length-1:index+(direction==='up'?-1:1);
   if(target<0||target>=visible.length||target===index)return;
   visible.splice(index,1);
   visible.splice(target,0,id);
   prefs.order=[...visible,...prefs.order.filter(key=>!visible.includes(key))];
  }
  if(button.hasAttribute('data-op-reset')){prefs.order=[...defaults];prefs.names={};prefs.colors={};prefs.collapsed=[];prefs.favorites=['points','time','events','history'];prefs.compact=false;prefs.columns=false;root.querySelector('[data-op-compact]').checked=false;root.querySelector('[data-op-columns]').checked=false;}
  apply(root,prefs);save(root,prefs);
 });
 document.addEventListener('change',event=>{if(!event.target.matches('[data-op-compact],[data-op-columns]'))return;const root=event.target.closest('.arena-operation-workspace');if(!root)return;const prefs=read(root.dataset.opKey);prefs.compact=root.querySelector('[data-op-compact]').checked;prefs.columns=root.querySelector('[data-op-columns]').checked;apply(root,prefs);save(root,prefs);});
 window.addEventListener('storage',event=>{if(event.key?.startsWith('arena-operation-layout-v1:'))sessionPreferences.delete(event.key);});
 window.ArenaOperation=Object.freeze({build});
})();
