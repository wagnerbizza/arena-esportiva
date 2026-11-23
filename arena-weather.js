/* Previsão Open-Meteo. Cache local; independente do Firebase e dos placares. */
(function(){
 'use strict';
 if(document.getElementById('arenaWeather'))return;
 const TTL=30*60*1000,defaultPlace={name:'São Paulo, SP',latitude:-23.55,longitude:-46.63};
 const storage={read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},write(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
 const validPlace=p=>p&&typeof p.name==='string'&&p.name.length<=180&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
 let place=storage.read('arena-weather-place-v1');if(!validPlace(place))place=defaultPlace;
 let sequence=0,loading=false,lastAttempt=0,searchSequence=0;
 const main=document.querySelector('main');if(!main)return;
 const panel=document.createElement('details');panel.id='arenaWeather';panel.className='arena-weather noprint';panel.setAttribute('aria-label','Previsão do tempo');
 panel.innerHTML='<summary><strong data-weather-title>Previsão do tempo</strong><span data-weather-summary>Consultando previsão…</span></summary><div class="arena-weather-body"><p data-weather-status role="status" aria-live="polite"></p><div class="arena-weather-days" data-weather-days></div><div class="toolbar"><button type="button" data-weather-refresh>Atualizar previsão</button></div><form data-weather-search><label>Cidade<input name="city" type="search" minlength="3" maxlength="100" placeholder="Ex.: São Paulo" required autocomplete="off"></label><button type="submit">Buscar cidade</button></form><div class="arena-weather-results" data-weather-results></div><small>A cidade escolhida vale neste navegador. A previsão pode mudar. Fonte: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.</small></div>';
 const weatherCard = document.createElement('div');
 weatherCard.className = 'arena-weather-card noprint';
 const pin = document.createElement('button');
 pin.type = 'button';
 pin.className = 'arena-weather-pin';
 pin.setAttribute('aria-controls', panel.id);

 const styles = document.createElement('style');
 styles.textContent = `
@keyframes forecast-cloud-drift {
  from { transform: translateX(-2px); }
  to { transform: translateX(3px); }
}
@keyframes forecast-detail-in {
  from { opacity: .55; }
  to { opacity: 1; }
}
#arenaWeather[data-weather-clouds] [data-weather-summary]::before {
  content: "☁";
  display: inline-block;
  margin-inline-end: .45em;
  color: var(--accent);
  animation: forecast-cloud-drift 2.8s ease-in-out infinite alternate;
}
#arenaWeather[open] .arena-weather-body {
  animation: forecast-detail-in .2s ease-out;
}
.arena-weather-pin { transition: color .18s ease, background-color .18s ease; }
.arena-weather-pin[aria-pressed="true"] { background-color: color-mix(in srgb, var(--accent) 12%, transparent) !important; }
@media (prefers-reduced-motion: reduce) {
  #arenaWeather[data-weather-clouds] [data-weather-summary]::before,
  #arenaWeather[open] .arena-weather-body { animation: none; }
  .arena-weather-pin { transition: none; }
}

  .arena-weather-card {
    position:relative; margin-bottom:16px; border:1px solid var(--line,#344757);
    border-radius:12px; background:var(--panel,#151c23); min-width:0;
  }
  .arena-weather-card > #arenaWeather { margin:0; border:0; background:transparent; }
  .arena-weather-card > #arenaWeather > summary {
    min-height:56px; padding-inline-end:60px; flex-wrap:wrap; overflow-wrap:anywhere;
  }
  main:has(.arena-live-pinnable.is-pinned, .arena-op-strip.is-pinned) > .arena-weather-card.is-pinned {
    border-end-start-radius:0; border-end-end-radius:0;
  }
  .arena-live-pinnable.is-pinned { background:var(--panel,#14202b); }
  .arena-weather-card > .arena-weather-pin {
    position:absolute; inset-block-start:5px; inset-inline-end:5px; z-index:1;
  }
  .arena-weather-card:has(> #arenaWeather:not([open])) > .arena-weather-pin {
    inset-block-start:50%; transform:translateY(-50%);
  }
  .arena-weather-card > #arenaWeather[open] .arena-weather-body { max-height:38dvh; overflow:auto; }
  .arena-weather-card.is-pinned { position:sticky; top:0; z-index:12; }
  html:has(.arena-weather-card.is-pinned), body:has(.arena-weather-card.is-pinned),
  html:has(.arena-live-pinnable.is-pinned), body:has(.arena-live-pinnable.is-pinned) { overflow-x:clip !important; }
  .arena-live-pinnable { position:relative; flex-wrap:wrap; }
  .arena-live-pinnable.is-pinned {
    position:sticky; top:var(--arena-weather-sticky-height,0px); z-index:11;
    max-height:40dvh; overflow:auto;
  }
  main:has(> .arena-weather-card.is-pinned) .arena-live-pinnable.is-pinned {
    top:var(--arena-weather-sticky-height,0px);
    border-start-start-radius:0; border-start-end-radius:0; border-block-start:0;
    box-shadow:0 -2px var(--panel,#14202b);
  }
  :is(.arena-weather-card,.arena-live-pinnable) .arena-weather-pin {
    display:grid; place-items:center; width:44px; min-height:44px; padding:0; margin-inline-start:auto;
    border:0; border-radius:8px;
    background:transparent !important; color:var(--text,#eef3f6) !important;
    font-size:.85rem; text-align:end; line-height:1;
  }
  :is(.arena-weather-card,.arena-live-pinnable) .arena-weather-pin[aria-pressed] {
    background:transparent !important; box-shadow:none;
  }
  :is(.arena-weather-card,.arena-live-pinnable) .arena-weather-pin:hover { color:var(--accent,#16c9f3) !important; }
  @media screen and (max-width:600px) {
    .arena-weather-card > #arenaWeather > summary {
      display:flex; flex-direction:column; align-items:flex-start;
      gap:4px; padding-inline-end:60px;
    }
  }
  @media print { .arena-weather-card { display:none !important; } }
 `;
 document.head.append(styles);
 weatherCard.append(panel, pin);
 main.prepend(weatherCard);

 const pinKey = 'arena-weather-pinned-v1';
 const liveKey = 'arena-live-pinned-v1';
 const isPublic = document.body.dataset.admin === 'false';
 const params = new URLSearchParams(location.search);
 for (const [param, key] of [['fixarTempo', pinKey], ['fixarAoVivo', liveKey]]) {
  const value = params.get(param);
  if (value === '1' || value === '0') storage.write(key, value === '1');
 }
 let livePanel;
 let livePin;
 const refreshSpacing = () => {
  const height = weatherCard.classList.contains('is-pinned') ? weatherCard.offsetHeight : 0;
  main.style.setProperty('--arena-weather-sticky-height', height + 'px');
 };
 if (typeof ResizeObserver === 'function') new ResizeObserver(refreshSpacing).observe(weatherCard);
 function updatePin(button, pinned, label) {
  button.setAttribute('aria-pressed', String(pinned));
  button.title = (pinned ? 'Desafixar ' : 'Fixar ') + label;
  button.setAttribute('aria-label', button.title);
  button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6v6l4 4v2H5v-2l4-4V3Zm3 12v6"/>' + (pinned ? '' : '<path d="M3 3l18 18"/>') + '</svg>';
 }
 function applyPins() {
  const pinned = storage.read(pinKey) === true;
  weatherCard.classList.toggle('is-pinned', pinned);
  updatePin(pin, pinned, 'previsão do tempo');
  if (livePanel) {
   const livePinned = storage.read(liveKey) === true;
   livePanel.classList.toggle('is-pinned', livePinned);
   updatePin(livePin, livePinned, 'jogos ao vivo');
  }
  refreshSpacing();
 }
 pin.addEventListener('click', () => {
  storage.write(pinKey, pin.getAttribute('aria-pressed') !== 'true');
  applyPins();
 });
 if (isPublic) {
  function installLivePin() {
   const current = main.querySelector('.live-status-panel');
   if (current === livePanel) return;
   livePanel = current;
   if (current) {
    livePanel.classList.add('arena-live-pinnable');
    livePin = pin.cloneNode(true);
    livePin.removeAttribute('aria-controls');
    livePin.addEventListener('click', () => {
     storage.write(liveKey, livePin.getAttribute('aria-pressed') !== 'true');
     applyPins();
    });
    livePanel.append(livePin);
   }
   applyPins();
  }
  new MutationObserver(installLivePin).observe(main.querySelector('#app') || main, {childList:true, subtree:true});
  installLivePin();

  const share = document.createElement('button');
  share.type = 'button';
  share.textContent = 'Copiar link com estas fixações';
  share.addEventListener('click', async () => {
   const url = new URL(location.href);
   url.searchParams.set('fixarTempo', storage.read(pinKey) === true ? '1' : '0');
   url.searchParams.set('fixarAoVivo', storage.read(liveKey) === true ? '1' : '0');
   try {
    await navigator.clipboard.writeText(url.href);
    share.textContent = 'Link copiado';
   } catch (_) {
    window.prompt('Copie e abra este link no outro aparelho:', url.href);
   }
  });
  panel.querySelector('.toolbar').append(share);
 }
 window.addEventListener('storage', event => {
  if (event.key === pinKey || event.key === liveKey) applyPins();
 });
 applyPins();
 const find=s=>panel.querySelector(s),status=text=>{find('[data-weather-status]').textContent=text;};
 function label(code){if(code===0)return 'Céu limpo';if([1,2,3].includes(code))return 'Parcialmente nublado a nublado';if([45,48].includes(code))return 'Nevoeiro';if([51,53,55,56,57].includes(code))return 'Garoa';if([61,63,65,66,67,80,81,82].includes(code))return 'Chuva';if([71,73,75,77,85,86].includes(code))return 'Neve';if([95,96,99].includes(code))return 'Trovoadas';return 'Condição não informada';}
 const finite=x=>typeof x==='number'&&Number.isFinite(x),number=x=>finite(x)?Math.round(x).toLocaleString('pt-BR'):'—';
 function usable(data){return data&&data.current&&finite(data.current.temperature_2m)&&typeof data.current.time==='string'&&data.daily&&Array.isArray(data.daily.time)&&data.daily.time.length>0&&Array.isArray(data.daily.temperature_2m_min)&&Array.isArray(data.daily.temperature_2m_max)&&Array.isArray(data.daily.precipitation_probability_max);}
 function paint(data,at,stale){
  if(!usable(data))return false;
  panel.toggleAttribute('data-weather-clouds', data.current.weather_code > 0);
  find('[data-weather-title]').textContent=place.name+' · '+number(data.current.temperature_2m)+' °C';
  find('[data-weather-summary]').textContent=label(data.current.weather_code)+' · '+(stale?'dados salvos':'previsão de 3 dias');
  const days=find('[data-weather-days]');days.replaceChildren();
  data.daily.time.slice(0,3).forEach((day,i)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;const article=document.createElement('article'),title=document.createElement('strong'),range=document.createElement('span'),rain=document.createElement('span');title.textContent=new Date(day+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'});range.textContent=number(data.daily.temperature_2m_min[i])+' a '+number(data.daily.temperature_2m_max[i])+' °C';const probability=data.daily.precipitation_probability_max[i];rain.textContent=finite(probability)&&probability>=0&&probability<=100?'Chance de chuva: '+number(probability)+'%':'Chuva: não informada';article.append(title,range,rain);days.append(article);});
  status((stale?'Exibindo última consulta salva. ':'Consulta atualizada. ')+'Horário da previsão: '+data.current.time.replace('T',' ')+' (horário local da cidade).');return true;
 }
 async function json(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Consulta indisponível');return await response.json();}finally{clearTimeout(timer);}}
 async function load(force=false){
  if(loading)return;const request=++sequence,location={...place},key='arena-weather-cache-v1:'+location.latitude.toFixed(3)+':'+location.longitude.toFixed(3),cached=storage.read(key),now=Date.now();
  if(!force&&cached&&Number.isFinite(cached.at)&&cached.at<=now&&now-cached.at<TTL&&paint(cached.data,cached.at,false))return;
  if(cached)paint(cached.data,cached.at,true);
  loading=true;lastAttempt=now;panel.setAttribute('aria-busy','true');find('[data-weather-refresh]').disabled=true;status('Atualizando a previsão de '+location.name+'…');
  try{const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,current:'temperature_2m,weather_code',daily:'temperature_2m_min,temperature_2m_max,precipitation_probability_max',forecast_days:'3',timezone:'auto',temperature_unit:'celsius'}).toString();const data=await json(url);if(request!==sequence)return;if(!usable(data))throw Error('Dados incompletos');paint(data,now,false);storage.write(key,{at:now,data});}
  catch{if(request!==sequence)return;if(!(cached&&paint(cached.data,cached.at,true))){find('[data-weather-title]').textContent='Previsão · '+place.name;find('[data-weather-summary]').textContent='Indisponível no momento';find('[data-weather-days]').replaceChildren();status('Não foi possível consultar o tempo. Tente Atualizar previsão quando estiver conectado.');}else status('Sem atualização agora. Dados salvos da previsão: '+cached.data.current.time.replace('T',' ')+'.');}
  finally{if(request===sequence){loading=false;panel.setAttribute('aria-busy','false');find('[data-weather-refresh]').disabled=false;}}
 }
 find('[data-weather-refresh]').addEventListener('click',()=>load(true));
 find('[data-weather-search]').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,query=form.elements.city.value.trim();if(query.length<3)return;const request=++searchSequence,button=form.querySelector('button');button.disabled=true;const results=find('[data-weather-results]');results.replaceChildren();status('Buscando cidade…');try{const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:query,count:'5',language:'pt',countryCode:'BR'}).toString();const response=await json(url);if(request!==searchSequence)return;const rows=(Array.isArray(response.results)?response.results:[]).filter(row=>validPlace({...row,name:String(row.name||'')})).slice(0,5);if(!rows.length){status('Nenhuma cidade encontrada. Informe o nome completo.');return;}status('Escolha a cidade para consultar a previsão.');for(const row of rows){const name=[row.name,row.admin1,row.country].filter(x=>typeof x==='string'&&x).join(', ').slice(0,180),choice=document.createElement('button');choice.type='button';choice.textContent=name;choice.addEventListener('click',()=>{if(loading){status('Aguarde a consulta atual terminar e selecione a cidade novamente.');return;}place={name,latitude:row.latitude,longitude:row.longitude};storage.write('arena-weather-place-v1',place);results.replaceChildren();find('[data-weather-days]').replaceChildren();find('[data-weather-title]').textContent='Previsão · '+name;find('[data-weather-summary]').textContent='Consultando…';load();});results.append(choice);}}
  catch{if(request===searchSequence)status('Busca de cidade indisponível. Tente novamente em instantes.');}finally{if(request===searchSequence)button.disabled=false;}});
 window.addEventListener('storage',event=>{if(event.key==='arena-weather-place-v1'){const next=storage.read(event.key);if(validPlace(next)&&!loading){place=next;find('[data-weather-days]').replaceChildren();load();}}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastAttempt>=TTL)load();});
 load();
})();
