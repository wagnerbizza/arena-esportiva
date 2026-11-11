const examples = [
  ['Placar ao vivo', 'Aurora 2 × 1 Horizonte', 'Futebol · segundo tempo · 64 minutos.'],
  ['Agenda', 'Aurora × Estrela', 'Vôlei · sábado, 14h · Ginásio Central.'],
  ['Classificação', '1º Aurora · 9 pontos', 'Futebol · três vitórias em três partidas.'],
];

const stage = document.getElementById('demo-etapa');
const value = document.getElementById('demo-valor');
const detail = document.getElementById('demo-info');
let current = 0;

function changeExample(direction) {
  current = (current + direction + examples.length) % examples.length;
  const [title, score, description] = examples[current];
  stage.textContent = (current + 1) + ' de ' + examples.length + ' · ' + title;
  value.textContent = score;
  detail.textContent = description;
}

document.getElementById('demo-anterior').addEventListener('click', () => changeExample(-1));
document.getElementById('demo-proximo').addEventListener('click', () => changeExample(1));

for (const name of ['access', 'preferences']) {
  const dialog = document.getElementById('demo-' + name);
  document.querySelectorAll('[data-demo-' + name + ']').forEach(button => {
    button.addEventListener('click', () => dialog.showModal());
  });
}

const root = document.documentElement;
const paletteColors = {
  blue: ['#7dd6ff', '#075985'],
  violet: ['#d8b4fe', '#6b21a8'],
  amber: ['#ffd477', '#854d0e'],
};
let systemAccent = '';
const fields = {};
for (const name of ['theme', 'palette', 'scale', 'contrast', 'motion']) {
  const field = document.getElementById('demo-' + name);
  const key = 'arena_apresentacao_' + (name === 'theme' ? 'tema' : name);
  fields[name] = field;
  try {
    const value = localStorage.getItem(key);
    if (field.type === 'checkbox') field.checked = value === 'true';
    else if (Array.from(field.options).some(option => option.value === value)) field.value = value;
  } catch {}
  field.addEventListener('change', () => {
    try { localStorage.setItem(key, field.type === 'checkbox' ? String(field.checked) : field.value); } catch {}
    applyReadingPreferences();
  });
}

function applyReadingPreferences() {
  root.dataset.theme = fields.theme.value;
  root.dataset.demoContrast = String(fields.contrast.checked);
  root.dataset.demoMotion = String(fields.motion.checked);
  root.style.fontSize = Number(fields.scale.value) * 100 + '%';
  const custom = paletteColors[fields.palette.value]?.[fields.theme.value === 'light' ? 1 : 0];
  if (custom || systemAccent) root.style.setProperty('--accent', custom || systemAccent);
  else root.style.removeProperty('--accent');
}
applyReadingPreferences();

async function loadBrand() {
  const config = window.CONFIG?.firebase;
  if (!config?.projectId) return;
  const [app, firestore] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js'),
  ]);
  const database = firestore.getFirestore(app.initializeApp(config, 'arena-apresentacao'));
  const snapshot = await firestore.getDoc(firestore.doc(database, 'publicSettings', 'main'));
  const branding = snapshot.data();
  if (!branding) return;
  if (branding.title) document.getElementById('demo-brand-name').textContent = branding.title;
  if (/^#[0-9a-f]{6}$/i.test(branding.color || '')) {
    systemAccent = branding.color;
    applyReadingPreferences();
  }
  if (/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(branding.logo || '')) {
    const logo = document.getElementById('demo-logo');
    logo.onload = () => { logo.hidden = false; };
    logo.src = branding.logo;
  }
}

loadBrand().catch(() => {
  // A apresentação e os atalhos continuam disponíveis sem a identidade publicada.
});
