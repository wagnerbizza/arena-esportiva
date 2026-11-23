/* Mesa de operação: organiza os controles existentes e guarda apenas preferências locais. */
(function(){
 'use strict';if(window.ArenaOperation)return;
 const defaults=['points','time','substitutions','coach','events','pauses','roster','notices','notes','championship','history'];
 const labels={points:'Pontos e cartões',time:'Tempo e acréscimos',substitutions:'Substituições de atletas e goleiros',coach:'Troca de técnico',events:'Cartões, faltas e outros lances',pauses:'Situação e etapas',roster:'Elenco da partida',notices:'Avisos ao público',history:'Histórico e anulações',notes:'Observações da súmula',championship:'Vínculo ao campeonato'};
 const sessionPreferences=new Map();
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function read(key){let saved=sessionPreferences.get(key);if(!saved)try{saved=JSON.parse(localStorage.getItem(key));}catch{}return {order:[...new Set([...(Array.isArray(saved?.order)?saved.order.filter(id=>defaults.includes(id)):[]),...defaults])],favorites:Array.isArray(saved?.favorites)?[...new Set(saved.favorites.filter(id=>defaults.includes(id)))]:['points','time','events','history'],collapsed:Array.isArray(saved?.collapsed)?saved.collapsed.filter(id=>defaults.includes(id)):[],scorePinned:saved?.scorePinned!==false,compact:saved?.compact===true,columns:saved?.columns===true};}
 function save(root,prefs){sessionPreferences.set(root.dataset.opKey,prefs);try{localStorage.setItem(root.dataset.opKey,JSON.stringify(prefs));}catch{const label=root.querySelector('[data-op-save-status]');if(label)label.textContent='Preferência aplicada nesta tela; o navegador não permitiu salvar.';return;}const label=root.querySelector('[data-op-save-status]');if(label)label.textContent='Preferências salvas para esta conta neste navegador.';}
 function panel(id,node){if(!node)return null;node.removeAttribute('hidden');node.classList?.remove('card');const section=document.createElement('section');section.id='arena-op-'+id;section.className='card arena-op-panel';section.dataset.opPanel=id;section.tabIndex=-1;section.innerHTML='<div class="arena-op-heading"><h2>'+labels[id]+'</h2><button type="button" data-op-favorite="'+id+'" aria-pressed="false" title="Favoritar '+labels[id]+'">Favoritar</button></div>';const toggle=document.createElement('button');toggle.type='button';toggle.dataset.opFold=id;
  toggle.setAttribute('aria-controls',section.id+'-content');section.querySelector('.arena-op-heading').append(toggle);
  const content=document.createElement('div');content.id=section.id+'-content';content.dataset.opContent='';
  content.append(node);section.append(content);return section;}
 function toolbar(root,prefs){const nav=root.querySelector('[data-op-shortcuts]');nav.replaceChildren();const panels=[...root.querySelectorAll('[data-op-panel]')];for(const section of panels){const id=section.dataset.opPanel,fold=section.querySelector('[data-op-fold]'),closed=prefs.collapsed.includes(id);
   fold.textContent=closed?'Expandir':'Recolher';fold.setAttribute('aria-expanded',String(!closed));
   fold.setAttribute('aria-label',fold.textContent+' '+labels[id]);section.querySelector('[data-op-content]').hidden=closed;
   const favorite=prefs.favorites.includes(id),button=section.querySelector('[data-op-favorite]');button.setAttribute('aria-pressed',String(favorite));button.textContent=favorite?'Favorito':'Favoritar';button.title=(favorite?'Remover dos favoritos: ':'Favoritar: ')+labels[id];if(favorite){const jump=document.createElement('button');jump.type='button';jump.dataset.opJump=id;jump.textContent=labels[id];nav.append(jump);}}
  if(!nav.children.length)nav.textContent='Use Favoritar nas seções para criar seus atalhos de operação.';
  const list=root.querySelector('[data-op-order]');list.innerHTML=panels.map((section,i)=>{const id=section.dataset.opPanel;return '<div class="arena-op-order-row"><span>'+labels[id]+'</span><button type="button" data-op-move="'+id+'" data-op-direction="first" '+(i===0?'disabled':'')+'>Colocar primeiro</button><button type="button" data-op-move="'+id+'" data-op-direction="last" '+(i===panels.length-1?'disabled':'')+'>Colocar por último</button><button type="button" data-op-move="'+id+'" data-op-direction="up" '+(i===0?'disabled':'')+' aria-label="Subir '+labels[id]+'">Subir</button><button type="button" data-op-move="'+id+'" data-op-direction="down" '+(i===panels.length-1?'disabled':'')+' aria-label="Descer '+labels[id]+'">Descer</button></div>';}).join('');
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
  const back=old.querySelector('[data-back]');if(back)root.append(back);
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
  describeScorePin(pin,prefs.scorePinned);strip.append(pin);root.append(strip);
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
  if(button.hasAttribute('data-op-reset')){prefs.order=[...defaults];prefs.collapsed=[];prefs.favorites=['points','time','events','history'];prefs.compact=false;prefs.columns=false;root.querySelector('[data-op-compact]').checked=false;root.querySelector('[data-op-columns]').checked=false;}
  apply(root,prefs);save(root,prefs);
 });
 document.addEventListener('change',event=>{if(!event.target.matches('[data-op-compact],[data-op-columns]'))return;const root=event.target.closest('.arena-operation-workspace');if(!root)return;const prefs=read(root.dataset.opKey);prefs.compact=root.querySelector('[data-op-compact]').checked;prefs.columns=root.querySelector('[data-op-columns]').checked;apply(root,prefs);save(root,prefs);});
 window.addEventListener('storage',event=>{if(event.key?.startsWith('arena-operation-layout-v1:'))sessionPreferences.delete(event.key);});
 window.ArenaOperation=Object.freeze({build});
})();
