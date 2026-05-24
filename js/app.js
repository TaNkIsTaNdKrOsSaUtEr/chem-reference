// ====== Инициализация SmilesDrawer ======
// (для большого окна создадим drawer позже)
let mainDrawer = null;

// ====== Работа с IndexedDB ======
const DB_NAME = 'chem-cache';
const DB_VERSION = 1;
const STORE_NAME = 'formulas';

const dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    db.createObjectStore(STORE_NAME, { keyPath: 'formula' });
  },
});

async function cachePut(formula, compounds) {
  const db = await dbPromise;
  return db.put(STORE_NAME, {
    formula,
    compounds,
    cached_at: Date.now(),
  });
}

async function cacheGet(formula) {
  const db = await dbPromise;
  return db.get(STORE_NAME, formula);
}

async function cacheClear() {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.store.clear();
  await tx.done;
}

async function cacheCount() {
  const db = await dbPromise;
  return db.count(STORE_NAME);
}

// ====== Запрос к PubChem (SMILES) ======
async function fetchFromPubChem(formula) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastformula/${formula}/property/SMILES,IUPACName/JSON`;
  console.log('Запрос к PubChem:', url);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('По этой формуле ничего не найдено');
    if (res.status === 503) throw new Error('PubChem перегружен, попробуйте позже');
    throw new Error(`Ошибка сервера (${res.status})`);
  }
  const data = await res.json();
  console.log('Ответ PubChem:', data);
  const props = data.PropertyTable?.Properties;
  if (!props || props.length === 0) throw new Error('Нет данных о соединениях');
  
  const compounds = props.map(p => ({
    cid: p.CID,
    name: p.IUPACName || 'Безымянное соединение',
    smiles: p.SMILES,
  }));
  console.log('Сырые SMILES:', compounds.map(c => c.smiles));
  return compounds;
}

// ====== Основная функция поиска ======
async function searchFormula(formula) {
  const normalized = formula.trim().toUpperCase();
  if (!normalized) throw new Error('Введите формулу');

  const cached = await cacheGet(normalized);
  if (cached) {
    console.log('Загружено из кэша:', cached);
    return { compounds: cached.compounds, fromCache: true };
  }

  if (!navigator.onLine) {
    throw new Error('Нет интернета и формула отсутствует в кэше');
  }

  const compounds = await fetchFromPubChem(normalized);
  await cachePut(normalized, compounds);
  return { compounds, fromCache: false };
}

// ====== Переменные пагинации ======
let allCompounds = [];
let shownCount = 0;
const PAGE_SIZE = 20;

// ====== UI-функции ======
function clearResults() {
  document.getElementById('results').innerHTML = '';
  document.getElementById('drawArea').innerHTML = '';
  document.getElementById('status').textContent = '';
  document.getElementById('loadMoreContainer')?.remove();
}

function showStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.style.color = isError ? '#e74c3c' : '#2c3e50';
}

function isValidSmiles(s) {
  return typeof s === 'string' && s.trim() !== '' && s.trim().toLowerCase() !== 'undefined' && s.trim().toLowerCase() !== 'null';
}

// --- Новые функции отрисовки на canvas ---
function drawMoleculeOnCanvas(smiles, canvas, width = 300, height = 300) {
  if (!isValidSmiles(smiles)) {
    // Очищаем canvas и пишем текст ошибки
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#e74c3c';
    ctx.fillText('Нет структуры', 10, 20);
    return;
  }
  
  // Создаём временный SmilesDrawer с размерами canvas
  const drawer = new SmilesDrawer.Drawer({
    width: canvas.width,
    height: canvas.height,
    bondThickness: 1.5,
    shortBondLength: 0.8,
  });
  
  SmilesDrawer.parse(smiles, tree => {
    drawer.draw(tree, canvas, 'light', false);
  }, err => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#e74c3c';
    ctx.fillText('Ошибка: ' + err, 10, 20);
  });
}

function renderMoreCompounds() {
  const resultsDiv = document.getElementById('results');
  const nextBatch = allCompounds.slice(shownCount, shownCount + PAGE_SIZE);
  
  nextBatch.forEach((c, idx) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    const smiles = isValidSmiles(c.smiles) ? c.smiles : 'нет данных';
    div.innerHTML = `
      <div class="name">${shownCount + idx + 1}. ${c.name}</div>
      <div class="smiles">SMILES: ${smiles}</div>
    `;
    
    // Создаём canvas для миниатюры
    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 150;
    canvas.className = 'mol-canvas';
    div.appendChild(canvas);
    
    // Обработчик клика по карточке (рисует в большом окне)
    div.addEventListener('click', () => {
      if (isValidSmiles(c.smiles)) {
        drawMainMolecule(c.smiles);
      } else {
        showStatus('Нет структуры для отображения', true);
      }
    });
    resultsDiv.appendChild(div);
    
    // Рисуем миниатюру
    drawMoleculeOnCanvas(c.smiles, canvas, 150, 150);
  });

  shownCount += nextBatch.length;

  if (shownCount < allCompounds.length) {
    showLoadMoreButton();
  } else {
    removeLoadMoreButton();
  }
}

function drawMainMolecule(smiles) {
  const area = document.getElementById('drawArea');
  area.innerHTML = '';
  const mainCanvas = document.createElement('canvas');
  mainCanvas.width = 300;
  mainCanvas.height = 300;
  mainCanvas.id = 'mainCanvas';
  area.appendChild(mainCanvas);
  drawMoleculeOnCanvas(smiles, mainCanvas, 300, 300);
}

function showLoadMoreButton() {
  removeLoadMoreButton();
  const btn = document.createElement('button');
  btn.id = 'loadMoreBtn';
  btn.textContent = `Показать ещё (осталось ${allCompounds.length - shownCount})`;
  btn.addEventListener('click', renderMoreCompounds);
  
  const container = document.createElement('div');
  container.id = 'loadMoreContainer';
  container.style.textAlign = 'center';
  container.style.margin = '1rem 0';
  container.appendChild(btn);
  
  document.querySelector('main').appendChild(container);
}

function removeLoadMoreButton() {
  const container = document.getElementById('loadMoreContainer');
  if (container) container.remove();
}

async function updateCacheInfo() {
  const count = await cacheCount();
  document.getElementById('cacheSize').textContent = `Формул в кэше: ${count}`;
}

// ====== Обработчики ======
document.getElementById('searchBtn').addEventListener('click', async () => {
  const input = document.getElementById('formulaInput');
  const formula = input.value.trim();
  if (!formula) return;

  clearResults();
  showStatus('Ищем...');

  try {
    const { compounds, fromCache } = await searchFormula(formula);
    allCompounds = compounds.filter(c => isValidSmiles(c.smiles));
    console.log('Валидных соединений:', allCompounds.length);
    
    if (allCompounds.length === 0) {
      showStatus('Нет соединений с корректными SMILES', true);
      return;
    }

    shownCount = 0;
    document.getElementById('results').innerHTML = '';
    renderMoreCompounds();
    
    showStatus(fromCache ? 'Загружено из кэша' : 'Получено из PubChem');
    
    if (allCompounds.length > 0) {
      drawMainMolecule(allCompounds[0].smiles);
    }
  } catch (e) {
    showStatus(e.message, true);
    console.error(e);
  } finally {
    updateCacheInfo();
  }
});

document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  if (!confirm('Удалить все сохранённые формулы?')) return;
  await cacheClear();
  updateCacheInfo();
  showStatus('Кэш очищен');
});

window.addEventListener('load', () => {
  updateCacheInfo();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('SW не зарегистрирован:', err);
    });
  }
});
