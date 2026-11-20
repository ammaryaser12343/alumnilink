// Contact requests page. Owner: Ammar.
// Students see the requests they sent (and the email once accepted).
// Alumni see the requests they received and can accept or decline them.
const list = document.getElementById('request-list');
const message = document.getElementById('message');
const intro = document.getElementById('intro');
const user = currentUser();

const STATUS_TEXT = { pending: 'Waiting for answer', accepted: 'Accepted', declined: 'Declined' };

// Every value goes in with textContent, never innerHTML, so message text cannot run as code.
function addLine(card, label, value) {
  if (value === undefined || value === null || value === '') return;
  const line = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  line.append(strong, document.createTextNode(String(value)));
  card.append(line);
}

function statusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `status status-${status}`;
  badge.textContent = STATUS_TEXT[status] || status;
  return badge;
}

function renderRequest(request, role) {
  const card = document.createElement('li');
  card.className = 'request-card';

  const title = document.createElement('h3');
  title.textContent = role === 'student' ? `To ${request.alumniName}` : `From ${request.studentName}`;
  card.append(title, statusBadge(request.status));

  addLine(card, 'Sent', new Date(request.createdAt).toLocaleString());
  addLine(card, 'Message', request.message);

  if (role === 'student' && request.status === 'accepted') {
    if (request.contactEmail) {
      addLine(card, 'Contact email', request.contactEmail);
    } else if (request.contactUnavailable) {
      addLine(card, 'Contact email', 'Temporarily unavailable, please reload later.');
    } else {
      addLine(card, 'Contact email', 'This alum has not added a contact email yet.');
    }
  }

  if (role === 'alumni' && request.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const [status, label] of [['accepted', 'Accept'], ['declined', 'Decline']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (status === 'declined') button.className = 'secondary';
      button.addEventListener('click', () => answer(request.id, status));
      actions.append(button);
    }
    card.append(actions);
  }
  return card;
}

async function answer(id, status) {
  message.textContent = 'Saving...';
  try {
    await apiRequest(`${API.search}/contact-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await load();
    message.textContent = status === 'accepted'
      ? 'Accepted. The student can now see your contact email.'
      : 'Declined.';
  } catch (error) {
    message.textContent = error.message;
  }
}

async function load() {
  if (!user) {
    message.textContent = 'Please log in to see your contact requests.';
    return;
  }
  intro.textContent = user.role === 'alumni'
    ? 'Students who asked for your contact details. Your email is shared only if you accept.'
    : 'Requests you sent to alumni. Once an alum accepts, their contact email appears here.';

  message.textContent = 'Loading...';
  try {
    const data = await apiRequest(`${API.search}/contact-requests`);
    list.replaceChildren(...data.requests.map((request) => renderRequest(request, data.role)));
    message.textContent = data.requests.length === 0 ? 'No contact requests yet.' : '';
  } catch (error) {
    list.replaceChildren();
    message.textContent = error.status === 401 ? 'Please log in to see your contact requests.' : error.message;
  }
}

load();
