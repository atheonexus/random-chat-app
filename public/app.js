const gateScreen = document.getElementById('gate');
const guidelinesScreen = document.getElementById('guidelines');
const chatScreen = document.getElementById('chat');

const ageCheckbox = document.getElementById('ageCheckbox');
const enterBtn = document.getElementById('enterBtn');
const openGuidelines = document.getElementById('openGuidelines');
const closeGuidelines = document.getElementById('closeGuidelines');

const statusText = document.getElementById('statusText');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const skipBtn = document.getElementById('skipBtn');
const leaveBtn = document.getElementById('leaveBtn');
const reportBtn = document.getElementById('reportBtn');

const reportModal = document.getElementById('reportModal');
const reportReason = document.getElementById('reportReason');
const cancelReport = document.getElementById('cancelReport');
const submitReport = document.getElementById('submitReport');

let socket = null;
let paired = false;

ageCheckbox.addEventListener('change', () => {
  enterBtn.disabled = !ageCheckbox.checked;
});

openGuidelines.addEventListener('click', (e) => {
  e.preventDefault();
  gateScreen.classList.add('hidden');
  guidelinesScreen.classList.remove('hidden');
});

closeGuidelines.addEventListener('click', () => {
  guidelinesScreen.classList.add('hidden');
  gateScreen.classList.remove('hidden');
});

enterBtn.addEventListener('click', () => {
  if (!ageCheckbox.checked) return;
  gateScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  connect();
});

function connect() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join_queue');
  });

  socket.on('queued', () => {
    paired = false;
    setInputEnabled(false);
    statusText.textContent = 'Waiting for a stranger…';
  });

  socket.on('matched', () => {
    paired = true;
    messagesEl.innerHTML = '';
    setInputEnabled(true);
    statusText.textContent = 'Connected to a stranger';
    addSystemMessage('You are now chatting with a random stranger. Say hi!');
  });

  socket.on('message', ({ text, self }) => {
    addMessage(text, self ? 'self' : 'other');
  });

  socket.on('system', ({ text }) => {
    addSystemMessage(text);
  });

  socket.on('partner_left', () => {
    paired = false;
    setInputEnabled(false);
    statusText.textContent = 'Stranger disconnected';
    addSystemMessage('The stranger left the chat. Click "Next stranger" to find someone new.');
  });

  socket.on('disconnect', () => {
    paired = false;
    setInputEnabled(false);
    statusText.textContent = 'Disconnected from server';
  });
}

function setInputEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

function addMessage(text, kind) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystemMessage(text) {
  addMessage(text, 'system');
}

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !paired || !socket) return;
  socket.emit('message', { text });
  messageInput.value = '';
});

skipBtn.addEventListener('click', () => {
  if (!socket) return;
  socket.emit('skip');
  paired = false;
  setInputEnabled(false);
  statusText.textContent = 'Looking for a new stranger…';
  messagesEl.innerHTML = '';
});

leaveBtn.addEventListener('click', () => {
  if (!socket) return;
  socket.emit('leave');
  socket.disconnect();
  chatScreen.classList.add('hidden');
  gateScreen.classList.remove('hidden');
  ageCheckbox.checked = false;
  enterBtn.disabled = true;
  messagesEl.innerHTML = '';
});

reportBtn.addEventListener('click', () => {
  if (!paired) return;
  reportReason.value = '';
  reportModal.classList.remove('hidden');
});

cancelReport.addEventListener('click', () => {
  reportModal.classList.add('hidden');
});

submitReport.addEventListener('click', () => {
  if (!socket) return;
  socket.emit('report', { reason: reportReason.value.trim() });
  reportModal.classList.add('hidden');
  paired = false;
  setInputEnabled(false);
  statusText.textContent = 'Report submitted';
});
