// Search page. Owner: Ammar.
const form = document.getElementById('search-form');
const message = document.getElementById('message');
const resultsBox = document.getElementById('results');
const prevButton = document.getElementById('prev-page');
const nextButton = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const industrySelect = document.getElementById('industry');

let currentPage = 1;

INDUSTRIES.forEach((industry) => {
  const option = document.createElement('option');
  option.value = industry;
  option.textContent = industry;
  industrySelect.append(option);
});
document.getElementById('gradYear').max = new Date().getFullYear();

function buildQuery(page) {
  const params = new URLSearchParams();
  for (const field of ['q', 'location', 'industry', 'gradYear', 'sort']) {
    const value = document.getElementById(field).value.trim();
    if (value) params.set(field, value);
  }
  params.set('page', page);
  return params.toString();
}

// Every value goes in with textContent, never innerHTML, so profile text cannot run as code.
function addLine(card, label, value) {
  if (value === undefined || value === null || value === '') return;
  const line = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  line.append(strong, document.createTextNode(String(value)));
  card.append(line);
}

function renderResults(results) {
  resultsBox.replaceChildren();
  results.forEach((alumnus) => {
    const card = document.createElement('article');
    card.className = 'result-card';

    const name = document.createElement('h3');
    name.textContent = alumnus.name;
    card.append(name);

    addLine(card, 'Company', alumnus.company);
    addLine(card, 'Industry', alumnus.industry);
    addLine(card, 'Location', alumnus.location);
    addLine(card, 'Graduated', alumnus.graduationYear);
    if (Array.isArray(alumnus.skills) && alumnus.skills.length > 0) {
      addLine(card, 'Skills', alumnus.skills.join(', '));
    }
    addLine(card, 'About', alumnus.bio);

    resultsBox.append(card);
  });
}

async function search(page) {
  message.textContent = 'Searching...';
  try {
    const data = await apiRequest(`${API.search}/alumni?${buildQuery(page)}`);
    currentPage = data.page;
    renderResults(data.results);

    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    message.textContent = data.total === 0
      ? 'No alumni match your search.'
      : `${data.total} alumni found.`;
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages;
  } catch (error) {
    resultsBox.replaceChildren();
    pageInfo.textContent = '';
    prevButton.disabled = true;
    nextButton.disabled = true;
    message.textContent = error.status === 401
      ? 'Please log in to search the directory.'
      : error.message;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  search(1);
});
prevButton.addEventListener('click', () => search(currentPage - 1));
nextButton.addEventListener('click', () => search(currentPage + 1));

search(1);
