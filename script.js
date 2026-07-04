const days = [
  {
    n: 1,
    date: '4 июля',
    title: 'Бишкек → Башня Бурана → Чон-Кемин',
    text: 'Первый день — дорога из Бишкека в Чон-Кемин через Башню Бурана. За несколько часов пейзаж меняется от равнин Чуйской долины до первых заснеженных хребтов Северного Тянь-Шаня.',
    tags: ['Шёлковый путь', 'Баласагун', 'Чон-Кемин']
  },
  { n: 2, date: '5 июля', title: 'Чон-Кемин → Боом → Кок-Мойнок → Чок-Тал', text: 'Конная прогулка утром, Боомское ущелье, каньон Кок-Мойнок и первый вечер у Иссык-Куля.', tags: ['лошади', 'каньон', 'Иссык-Куль'] },
  { n: 3, date: '6 июля', title: 'Чок-Тал → Чолпон-Ата → Семёновское ущелье → Каракол', text: 'Петроглифы Чолпон-Аты, северный берег озера, Семёновское ущелье и прибытие в Каракол.', tags: ['петроглифы', 'ущелье', 'Каракол'] },
  { n: 4, date: '7 июля', title: 'Алтын-Арашан', text: 'Внедорожная дорога, хвойная долина, горячие источники и возвращение в Каракол.', tags: ['горы', 'источники', 'внедорожник'] },
  { n: 5, date: '8 июля', title: 'Джети-Огуз → Барскоон → Сказка → Боконбаево', text: 'Красные скалы, водопады, каньон Сказка и южный берег Иссык-Куля.', tags: ['красные скалы', 'водопады', 'южный берег'] },
  { n: 6, date: '9 июля', title: 'Боконбаево → Шатылы → Ак-Сай → Коль-Укок → Кочкор', text: 'Панорамы южного берега, каньон Ак-Сай, озеро Коль-Укок и ночёвка в Кочкоре.', tags: ['панорамы', 'Ак-Сай', 'Коль-Укок'] },
  { n: 7, date: '10 июля', title: 'Кочкор → Сон-Кёль → Жумгал → Кызыл-Ой', text: 'Высокогорное озеро Сон-Кёль, кочевой быт, лошади, юрты и переезд через Жумгал.', tags: ['Сон-Кёль', 'кочевники', 'юрты'] },
  { n: 8, date: '11 июля', title: 'Кызыл-Ой → Кокомерен → Суусамыр → Бишкек', text: 'Финальная дорога через ущелье Кокомерен, Суусамырскую долину и возвращение к вылету.', tags: ['Кокомерен', 'Суусамыр', 'финал'] }
];

const story = [
  {
    title: 'Башня Бурана',
    text: 'Единственное хорошо сохранившееся сооружение древнего Баласагуна — одного из крупных городов Великого шёлкового пути.',
    match: '171835'
  },
  {
    title: 'Внутри башни',
    text: 'Узкая винтовая лестница проходит прямо внутри тысячелетней кирпичной кладки.',
    match: '173138'
  },
  {
    title: 'Вид с вершины',
    text: 'Сверху открывается Чуйская долина. Здесь проходили дороги между Востоком и Западом.',
    match: '172143'
  },
  {
    title: 'Балбалы',
    text: 'Каменные изваяния тюркской эпохи перевезены сюда из разных районов Кыргызстана и собраны в галерею под открытым небом.',
    match: '172715'
  },
  {
    title: 'Дорога в Чон-Кемин',
    text: 'После Бураны равнина постепенно уступает место предгорьям Северного Тянь-Шаня.',
    match: '195812'
  },
  {
    title: 'Вечер в горах',
    text: 'После короткого дождя выглянуло солнце и подсветило свежий снег на вершинах. Завтра — Чон-Кемин и конная прогулка.',
    match: '200919'
  }
];

const daysRoot = document.querySelector('#days');

async function loadDayPhotos() {
  try {
    const response = await fetch('data/day01-photos.json', { cache: 'no-store' });
    if (!response.ok) return [];
    const photos = await response.json();
    return Array.isArray(photos) ? photos : [];
  } catch {
    return [];
  }
}

function findPhoto(photos, key) {
  return photos.find((photo) => String(photo.public_id || '').includes(key));
}

function imageUrl(photo) {
  if (!photo || !photo.url) return '';
  return photo.url.replace('/image/upload/', '/image/upload/f_auto,q_auto,w_1800/');
}

function renderStoryItem(item, index, photos) {
  const photo = findPhoto(photos, item.match);
  const src = imageUrl(photo);
  const media = src
    ? `<img src="${src}" alt="${item.title}" loading="${index === 0 ? 'eager' : 'lazy'}">`
    : `<div class="photo-placeholder"><span>${item.title}</span></div>`;

  return `
    <article class="photo-story ${index === 0 ? 'photo-story--hero' : ''}">
      ${media}
      <div class="photo-caption">
        <h3>${item.title}</h3>
        <p>${item.text}</p>
      </div>
    </article>
  `;
}

function renderItinerary() {
  return `
    <section class="itinerary">
      <p class="eyebrow">Маршрут по дням</p>
      <h2>Вся поездка</h2>
      <div class="days-list">
        ${days.map(day => `
          <article class="day-card">
            <div>
              <div class="day-num">${String(day.n).padStart(2, '0')}</div>
              <div class="day-date">${day.date}</div>
            </div>
            <div>
              <h3>${day.title}</h3>
              <p>${day.text}</p>
              <div class="tags">${day.tags.map(tag => `<span>${tag}</span>`).join('')}</div>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

async function render() {
  const photos = await loadDayPhotos();

  const storyHtml = `
    <section class="story" id="story-day-1">
      <div class="story-head">
        <p class="eyebrow">День 1 · 4 июля 2026</p>
        <h2>Из Чуйской долины в Чон-Кемин</h2>
        <p>Первый день — дорога из Бишкека в Чон-Кемин через Башню Бурана. За несколько часов пейзаж меняется от равнин Чуйской долины до первых заснеженных хребтов Северного Тянь-Шаня.</p>
      </div>
      <div class="story-photos">
        ${story.map((item, index) => renderStoryItem(item, index, photos)).join('')}
      </div>
    </section>
  `;

  daysRoot.innerHTML = storyHtml + renderItinerary();
}

render();
