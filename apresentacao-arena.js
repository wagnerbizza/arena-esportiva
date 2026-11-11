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
