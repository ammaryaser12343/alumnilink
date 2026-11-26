// Search page. Owner: Ammar.
const form = document.getElementById('search-form');
const message = document.getElementById('message');
const resultsBox = document.getElementById('results');
const prevButton = document.getElementById('prev-page');
const nextButton = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const industrySelect = document.getElementById('industry');

const contactDialog = document.getElementById('contact-dialog');
const contactForm = document.getElementById('contact-form');
const contactMessage = document.getElementById('contact-message');
const contactStatus = document.getElementById('contact-status');
const contactSend = document.getElementById('contact-send');
const user = currentUser();

let currentPage = 1;
let contactTarget = null;

INDUSTRIES.forEach((industry) => {
  const option = document.createElement('option');
  option.value = industry;
  option.textContent = industry;
  industrySelect.append(option);
});
document.getElementById('gradYear').max = new Date().getFullYear();

function buildQuery(page) {
  const params = new URLSearchParams();
  const near = document.getElementById('near').value.trim();
  for (const field of ['q', 'location', 'industry', 'gradYear', 'near', 'radiusKm', 'sort']) {
    const value = document.getElementById(field).value.trim();
    // Distance options only make sense with a place, so they are not sent without one.
    if (!near && (field === 'radiusKm' || (field === 'sort' && value === 'distance'))) continue;
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
    if (typeof alumnus.distanceKm === 'number') {
      addLine(card, 'Distance', `${alumnus.distanceKm} km`);
    }
    addLine(card, 'Graduated', alumnus.graduationYear);
    if (Array.isArray(alumnus.skills) && alumnus.skills.length > 0) {
      addLine(card, 'Skills', alumnus.skills.join(', '));
    }
    addLine(card, 'About', alumnus.bio);

    // Students and alumni can ask an alum for contact details, but not on their own card.
    if (user && (user.role === 'student' || user.role === 'alumni') && !alumnus.isMine) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'contact-button';
      button.textContent = 'Request contact';
      button.addEventListener('click', () => openContactDialog(alumnus));
      card.append(button);
    }

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
    const place = data.near ? ` within ${data.near.radiusKm} km of ${data.near.name}` : '';
    message.textContent = data.total === 0
      ? `No alumni match your search${place}.`
      : `${data.total} alumni found${place}.`;
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

function openContactDialog(alumnus) {
  contactTarget = alumnus;
  document.getElementById('contact-name').textContent = alumnus.name;
  contactMessage.value = '';
  contactStatus.textContent = '';
  contactSend.disabled = false;
  contactDialog.showModal();
}

contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = contactMessage.value.trim();
  if (text.length < 10 || text.length > 500) {
    contactStatus.textContent = 'Your message must be between 10 and 500 characters.';
    return;
  }
  contactSend.disabled = true;
  contactStatus.textContent = 'Sending...';
  try {
    await apiRequest(`${API.search}/contact-requests`, {
      method: 'POST',
      body: JSON.stringify({ alumniId: contactTarget.id, message: text })
    });
    contactStatus.textContent = 'Request sent. You will see the answer on the Contact requests page.';
  } catch (error) {
    contactStatus.textContent = error.message;
    contactSend.disabled = false;
  }
});
document.getElementById('contact-cancel').addEventListener('click', () => contactDialog.close());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  search(1);
});
prevButton.addEventListener('click', () => search(currentPage - 1));
nextButton.addEventListener('click', () => search(currentPage + 1));

// Fills a <datalist> so the browser suggests values while typing.
function fillSuggestions(input, listId, items) {
  let list = document.getElementById(listId);
  if (!list) {
    list = document.createElement('datalist');
    list.id = listId;
    document.body.append(list);
    input.setAttribute('list', listId);
  }
  list.replaceChildren(...items.map((item) => {
    const option = document.createElement('option');
    option.value = item.name;
    return option;
  }));
}

// GET /api/alumni/filters: industry counts, year range, common skills and places.
// The page still works with the plain lists above if this call fails.
async function loadFilterOptions() {
  try {
    const options = await apiRequest(`${API.search}/alumni/filters`);
    for (const option of industrySelect.options) {
      const match = options.industries.find((item) => item.name === option.value);
      if (match) option.textContent = `${match.name} (${match.count})`;
    }
    const year = document.getElementById('gradYear');
    if (options.graduationYears.min) year.min = options.graduationYears.min;
    if (options.graduationYears.max) year.max = options.graduationYears.max;
    fillSuggestions(document.getElementById('q'), 'skill-suggestions', options.skills);
    fillSuggestions(document.getElementById('location'), 'location-suggestions', options.locations);
  } catch (error) {
    // Not signed in or service down: the search itself shows the message.
  }
}

loadFilterOptions();
search(1);
