const API_BASE = '/api';
const tokenKey = 'ink_token';
const userKey = 'ink_user';
const themeKey = 'ink_theme';
const paystackReady = new Promise((resolve, reject) => {
  if (window.PaystackPop) {
    resolve(window.PaystackPop);
    return;
  }

  const script = document.getElementById('paystackScript');
  if (!script) {
    reject(new Error('Paystack checkout script is missing.'));
    return;
  }

  script.addEventListener('load', () => {
    if (window.PaystackPop) resolve(window.PaystackPop);
    else reject(new Error('Paystack checkout loaded without its SDK.'));
  }, { once: true });
  script.addEventListener('error', () => reject(new Error('Paystack checkout could not be loaded.')), { once: true });
});

const state = {
  currentUser: null,
  currentPrompt: '',
  prompts: [],
  promptData: [],
  posts: [],
  myPosts: [],
  users: [],
  notifications: [],
  streak: null,
  selectedAvatar: '',
  guideStep: 0,
  activeSection: 'home',
};

function readStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function applyTheme(theme = 'light') {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.theme = nextTheme;
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const isDark = nextTheme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', isDark ? 'Switch to day mode' : 'Switch to night mode');
    const icon = button.querySelector('.theme-toggle-icon');
    const label = button.querySelector('[data-theme-label]');
    if (icon) icon.textContent = isDark ? '☀' : '☾';
    if (label) label.textContent = isDark ? 'Day' : 'Night';
  });
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(themeKey, nextTheme);
  applyTheme(nextTheme);
}

function showToast(message, type = 'info') {
  const container = document.querySelector('.toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2200);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function showSuccessBadge() {
  const badge = document.createElement('div');
  badge.className = 'success-badge';
  badge.innerHTML = '<div class="circle"><span class="check">✓</span></div>';
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 1200);
}

function setToken(token) {
  if (token) {
    writeStorage(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

function getToken() {
  return readStorage(tokenKey, null);
}

function setCurrentUser(user) {
  state.currentUser = user;
  state.selectedAvatar = user?.avatar || '';
  if (user) {
    writeStorage(userKey, user);
  } else {
    localStorage.removeItem(userKey);
  }
  renderAuthState();
  updateAppVisibility();
}

function updateAppVisibility() {
  const authenticated = Boolean(getCurrentUser());
  document.body.classList.toggle('authenticated', authenticated);
  const landingSplash = document.getElementById('landingSplash');
  if (landingSplash && !landingSplash.dataset.dismissed) {
    window.setTimeout(() => {
      landingSplash.classList.add('dismissed');
      landingSplash.dataset.dismissed = 'true';
    }, 2200);
  }
}

function getCurrentUser() {
  state.currentUser = readStorage(userKey, null);
  return state.currentUser;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      setToken(null);
      setCurrentUser(null);
    }
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

function attachAuthHeaders(headers = {}) {
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function renderAuthState() {
  const authArea = document.getElementById('authArea');
  const userArea = document.getElementById('userArea');
  const currentUserEl = document.getElementById('currentUser');
  const currentAvatar = document.getElementById('currentAvatar');
  const adminBtn = document.getElementById('adminBtn');

  const user = getCurrentUser();
  if (user) {
    authArea.style.display = 'none';
    userArea.style.display = 'flex';
    currentUserEl.textContent = user.displayName || user.username;
    currentAvatar.src = user.avatar || './Img/Logo.jpg';
    adminBtn.style.display = user.isAdmin ? 'inline-flex' : 'none';
  } else {
    authArea.style.display = 'flex';
    userArea.style.display = 'none';
    currentUserEl.textContent = '';
  }

  renderProfileSummary();
  renderWriterList();
}

async function loadSession() {
  const token = getToken();
  if (!token) return;

  try {
    const data = await requestJson(`${API_BASE}/auth/me`, {
      headers: attachAuthHeaders(),
    });
    setCurrentUser(data.user);
  } catch (error) {
    setToken(null);
    setCurrentUser(null);
  }
}

function navigate(target) {
  state.activeSection = target;
  document.querySelectorAll('.section').forEach((section) => {
    const isActive = section.id === `${target}Section`;
    section.classList.toggle('active', isActive);
  });

  const navItems = document.querySelectorAll('[data-navigate]');
  navItems.forEach((link) => {
    const value = link.dataset.navigate;
    link.style.opacity = value === target ? '1' : '0.75';
  });
}

async function loadPrompts() {
  try {
    const data = await requestJson(`${API_BASE}/prompts`);
    state.prompts = data.prompts || [];
    state.promptData = data.promptData || state.prompts.map((text) => ({ text, category: 'Writing' }));
    if (!state.currentPrompt && state.prompts.length) {
      state.currentPrompt = state.prompts[0];
    }
    renderPromptCard();
    renderPromptGrid();
  } catch (error) {
    state.prompts = [
      'Write about a room that remembers your name.',
      'Describe a city that only appears after midnight.',
      'Write a letter to a version of yourself that has changed.',
    ];
    state.currentPrompt = state.prompts[0];
    renderPromptCard();
    renderPromptGrid();
  }
}

function renderPromptCard() {
  const promptText = document.getElementById('promptText');
  if (promptText) {
    promptText.textContent = state.currentPrompt || 'Need inspiration? Shuffle the prompt to get a new creative spark.';
  }
}

function renderPromptGrid() {
  const promptGrid = document.getElementById('promptGrid');
  if (!promptGrid) return;

  promptGrid.innerHTML = '';
  const prompts = state.prompts.slice(0, 8);
  prompts.forEach((prompt, index) => {
    const item = document.createElement('div');
    item.className = 'prompt-item';
    item.innerHTML = `<strong>Prompt ${index + 1}</strong><p>${escapeHtml(prompt)}</p>`;
    promptGrid.appendChild(item);
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function loadPaystackConfig() {
  try {
    const data = await requestJson(`${API_BASE}/config`);
    window.PAYSTACK_PUBLIC_KEY = data.paystackPublicKey || '';
    window.PAYSTACK_CURRENCY = data.paystackCurrency || 'USD';
    window.PAYSTACK_AMOUNT = Number(data.paystackAmount || 299);
    const amountLabel = document.getElementById('planPrice');
    if (amountLabel) {
      const amount = window.PAYSTACK_AMOUNT / 100;
      const symbol = window.PAYSTACK_CURRENCY === 'NGN' ? '₦' : window.PAYSTACK_CURRENCY === 'USD' ? '$' : `${window.PAYSTACK_CURRENCY} `;
      amountLabel.innerHTML = `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}<span>/month</span>`;
    }
    const label = document.getElementById('paystackModeLabel');
    if (label) label.hidden = true;
  } catch (error) {
    showToast('Premium checkout is temporarily unavailable.', 'error');
  }
}

async function loadPosts(searchTerm = '') {
  try {
    const url = searchTerm ? `${API_BASE}/writings?q=${encodeURIComponent(searchTerm)}` : `${API_BASE}/writings`;
    const data = await requestJson(url);
    const following = getCurrentUser()?.following || [];
    state.posts = (data.writings || []).sort((a, b) => {
      const aPriority = following.includes(a.authorId) ? 1 : 0;
      const bPriority = following.includes(b.authorId) ? 1 : 0;
      return bPriority - aPriority || new Date(b.createdAt) - new Date(a.createdAt);
    });
    await loadMyPosts();
    renderPosts();
  } catch (error) {
    state.posts = [];
    renderPosts();
  }
}

async function loadMyPosts() {
  if (!getCurrentUser()) {
    state.myPosts = [];
    return;
  }
  try {
    const data = await requestJson(`${API_BASE}/writings/mine`, { headers: attachAuthHeaders() });
    state.myPosts = data.writings || [];
  } catch (error) {
    state.myPosts = [];
  }
}

async function loadStreak() {
  const container = document.getElementById('engageContent');
  if (!container) return;
  const user = getCurrentUser();
  if (!user) {
    renderStreakOverview(null);
    container.innerHTML = '<div class="engage-card"><h3>Build a writing rhythm</h3><p>Sign in to track your daily practice and forge a streak that belongs to you.</p><button class="btn primary" type="button" data-open-login>Sign in to begin</button></div>';
    return;
  }

  try {
    const data = await requestJson(`${API_BASE}/streak`, { headers: attachAuthHeaders() });
    state.streak = data.streak;
    const streak = state.streak;
    renderStreakOverview(streak);
    container.innerHTML = `
      <div class="engage-card">
        <span class="fire-icon">✦</span>
        <h3>Your writing forge</h3>
        <strong class="streak-number">${streak.current || 0}</strong>
        <p>day${streak.current === 1 ? '' : 's'} in your current streak</p>
        <p class="streak-activity-note">Your streak updates automatically when you publish or save writing today.</p>
        <div class="streak-stats"><span>Best <strong>${streak.best || 0}</strong></span><span>Goal <strong>${streak.goal || 100}</strong></span></div>
      </div>
      <div class="engage-card">
        <h3>Choose your next chapter</h3>
        <p>A goal gives today’s words somewhere to travel.</p>
        <select id="streakGoal" aria-label="Streak goal">
          ${[7, 14, 30, 100].map((goal) => `<option value="${goal}" ${Number(streak.goal) === goal ? 'selected' : ''}>${goal} days</option>`).join('')}
        </select>
        <button class="btn" type="button" data-streak-goal>Save goal</button>
      </div>`;
  } catch (error) {
    renderStreakOverview(null);
    container.innerHTML = '<div class="engage-card"><p>Streak Forge is warming up. Try again in a moment.</p></div>';
  }
}

function renderStreakOverview(streak) {
  const value = document.getElementById('writerStreakValue');
  const note = document.getElementById('writerStreakNote');
  const bar = document.getElementById('writerStreakBar');
  const current = Number(streak?.current || 0);
  const goal = Number(streak?.goal || 100);
  if (value) value.textContent = `${current} day${current === 1 ? '' : 's'}`;
  if (note) note.textContent = current ? `${Math.min(100, Math.round((current / goal) * 100))}% of your ${goal}-day goal` : 'Start your first day';
  if (bar) bar.style.width = `${Math.min(100, Math.round((current / goal) * 100))}%`;
}

async function loadUsers() {
  try {
    const data = await requestJson(`${API_BASE}/users`);
    state.users = data.users || [];
    renderWriterList();
  } catch (error) {
    state.users = [];
    renderWriterList();
  }
}

function renderProfileSummary() {
  const user = getCurrentUser();
  const profileSummaryName = document.getElementById('profileSummaryName');
  const profileSummaryUsername = document.getElementById('profileSummaryUsername');
  const profileSummaryAvatar = document.getElementById('profileSummaryAvatar');
  const profileDisplayName = document.getElementById('profileDisplayName');
  const profileBio = document.getElementById('profileBio');
  const writerStatusValue = document.getElementById('writerStatusValue');
  const writerStatusNote = document.getElementById('writerStatusNote');
  const writerMomentumValue = document.getElementById('writerMomentumValue');
  const writerSavedValue = document.getElementById('writerSavedValue');

  if (!user) {
    state.selectedAvatar = '';
    if (profileSummaryName) profileSummaryName.textContent = 'Your name';
    if (profileSummaryUsername) profileSummaryUsername.textContent = '@username';
    if (profileSummaryAvatar) profileSummaryAvatar.src = './Img/Logo.jpg';
    if (profileDisplayName) profileDisplayName.value = '';
    if (profileBio) profileBio.value = '';
    if (writerStatusValue) writerStatusValue.textContent = 'Guest';
    if (writerStatusNote) writerStatusNote.textContent = 'Sign in to start writing';
    if (writerMomentumValue) writerMomentumValue.textContent = '0';
    if (writerSavedValue) writerSavedValue.textContent = '0';
      renderStreakOverview(null);
    const planCard = document.getElementById('planCard');
    if (planCard) planCard.hidden = false;
    return;
  }

  if (profileSummaryName) profileSummaryName.textContent = user.displayName || user.username;
  if (profileSummaryUsername) profileSummaryUsername.textContent = `@${user.username}`;
  if (profileSummaryAvatar) profileSummaryAvatar.src = state.selectedAvatar || user.avatar || './Img/Logo.jpg';
  if (profileDisplayName) profileDisplayName.value = user.displayName || '';
  if (profileBio) profileBio.value = user.bio || '';
  document.querySelectorAll('.avatar-option').forEach((option) => {
    option.classList.toggle('selected', option.dataset.avatar === (state.selectedAvatar || user.avatar));
  });

  const publishedCount = document.getElementById('writerPublishedCount');
  const draftCount = document.getElementById('writerDraftCount');
  const followersCount = document.getElementById('writerFollowersCount');
  const followingCount = document.getElementById('writerFollowingCount');
  const savedCount = document.getElementById('writerSavedCount');
  const myPosts = state.myPosts || [];
  const momentumCount = myPosts.filter((item) => item.status !== 'draft').length;
  const savedTotal = Array.isArray(user.saved) ? user.saved.length : 0;

  if (publishedCount) publishedCount.textContent = String(momentumCount);
  if (draftCount) draftCount.textContent = String(myPosts.filter((item) => item.status === 'draft').length);
  if (followersCount) followersCount.textContent = String(Array.isArray(user.followers) ? user.followers.length : 0);
  if (followingCount) followingCount.textContent = String(Array.isArray(user.following) ? user.following.length : 0);
  if (savedCount) savedCount.textContent = String(savedTotal);
  if (writerMomentumValue) writerMomentumValue.textContent = String(momentumCount);
  if (writerSavedValue) writerSavedValue.textContent = String(savedTotal);
  renderStreakOverview(state.streak);
  if (writerStatusValue) writerStatusValue.textContent = user.isPaid ? 'Pro' : 'Free';
  if (writerStatusNote) writerStatusNote.textContent = user.isPaid ? 'Premium tools unlocked' : 'Unlock premium tools';
  const planCard = document.getElementById('planCard');
  if (planCard) planCard.hidden = Boolean(user.isAdmin);
  const writingPace = Math.min(100, myPosts.filter((item) => item.status !== 'draft').length * 20 + (state.streak?.current || 0) * 5);
  const audienceGrowth = Math.min(100, (user.followers?.length || 0) * 12 + (user.following?.length || 0) * 6);
  const writingPaceValue = document.getElementById('writingPaceValue');
  const writingPaceBar = document.getElementById('writingPaceBar');
  const audienceGrowthValue = document.getElementById('audienceGrowthValue');
  const audienceGrowthBar = document.getElementById('audienceGrowthBar');
  if (writingPaceValue) writingPaceValue.textContent = `${writingPace}%`;
  if (writingPaceBar) writingPaceBar.style.width = `${writingPace}%`;
  if (audienceGrowthValue) audienceGrowthValue.textContent = `${audienceGrowth}%`;
  if (audienceGrowthBar) audienceGrowthBar.style.width = `${audienceGrowth}%`;
}

function selectAvatar(avatar) {
  state.selectedAvatar = avatar;
  const preview = document.getElementById('profileSummaryAvatar');
  if (preview) preview.src = avatar;
  document.querySelectorAll('.avatar-option').forEach((option) => {
    option.classList.toggle('selected', option.dataset.avatar === avatar);
  });
  const fileInput = document.getElementById('profileAvatarInput');
  if (fileInput) fileInput.value = '';
}

function renderSupportMessages(container, messages) {
  if (!messages.length) {
    container.innerHTML = '<p class="chat-empty">No messages yet. Our team is here when you need us.</p>';
    return;
  }

  container.innerHTML = messages.map((message) => `
    <div class="support-message ${message.from !== 'You' ? 'admin' : 'user'}">
      <strong>${escapeHtml(message.from !== 'You' ? message.from : 'You')}</strong>
      <span>${escapeHtml(message.text)}</span>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

async function loadSupportMessages(container) {
  const user = getCurrentUser();
  if (!container) return;
  if (!user) {
    container.innerHTML = '<p class="chat-empty">Sign in to start a private support conversation.</p>';
    return;
  }

  container.innerHTML = '<p class="chat-empty">Loading your conversation...</p>';
  try {
    const data = await requestJson(`${API_BASE}/support/messages`, {
      headers: attachAuthHeaders(),
    });
    renderSupportMessages(container, data.messages || []);
  } catch (error) {
    container.innerHTML = '<p class="chat-empty chat-error">Support chat is temporarily unavailable.</p>';
  }
}

function renderSupportChat() {
  const container = document.getElementById('supportChatMessages');
  return loadSupportMessages(container);
}

async function submitSupportChat(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const input = form.querySelector('input');
  if (!input || !getCurrentUser()) {
    openModal('logModal');
    return;
  }

  const message = input.value.trim();
  if (!message) return;

  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await requestJson(`${API_BASE}/support/messages`, {
      method: 'POST',
      headers: attachAuthHeaders(),
      body: JSON.stringify({ text: message }),
    });
    input.value = '';
    const containerId = form.id === 'supportChatModalForm' ? 'supportChatModalMessages' : 'supportChatMessages';
    await loadSupportMessages(document.getElementById(containerId));
    showSupportSurvey(containerId);
    showToast('Your message reached Luma Support.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to send your support message.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function submitFeedback(event) {
  event.preventDefault();
  if (!getCurrentUser()) {
    openModal('logModal');
    return;
  }
  const form = event.currentTarget;
  const messageInput = form.querySelector('#feedbackMessage');
  const button = form.querySelector('button[type="submit"]');
  const message = messageInput?.value.trim() || '';
  const category = form.querySelector('#feedbackCategory')?.value || 'General';
  if (!message) return showToast('Write some feedback before sending it.', 'error');
  if (button) button.disabled = true;
  try {
    await requestJson(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: attachAuthHeaders(),
      body: JSON.stringify({ message, category }),
    });
    form.reset();
    updateFeedbackCharacterCount();
    showToast('Thanks. Your feedback reached the INKurgic team.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to send feedback.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function updateFeedbackCharacterCount() {
  const input = document.getElementById('feedbackMessage');
  const counter = document.getElementById('feedbackCharCount');
  if (input && counter) counter.textContent = `${input.value.length} / ${input.maxLength || 2000}`;
}

function showSupportSurvey(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('.support-survey')) return;
  const survey = document.createElement('div');
  survey.className = 'support-survey';
  survey.innerHTML = '<strong>What would help most?</strong><div><button type="button" data-survey="Publishing">Publishing</button><button type="button" data-survey="Account">Account</button><button type="button" data-survey="Feedback">Feedback</button></div>';
  container.appendChild(survey);
  survey.querySelectorAll('[data-survey]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const data = await requestJson(`${API_BASE}/support/survey`, { method: 'POST', headers: attachAuthHeaders(), body: JSON.stringify({ answer: button.dataset.survey }) });
      survey.innerHTML = `<strong>${escapeHtml(data.message)}</strong>`;
    } catch (error) {
      showToast(error.message || 'Unable to save survey response.', 'error');
    }
  }));
}

function renderWriterDashboard() {
  const user = getCurrentUser();
  const draftList = document.getElementById('draftList');
  const savedList = document.getElementById('savedList');

  if (!user) {
    if (draftList) draftList.innerHTML = '<p class="empty-copy">Sign in to review drafts and saved reads.</p>';
    if (savedList) savedList.innerHTML = '<p class="empty-copy">Your saved pieces will appear here.</p>';
    renderSupportChat();
    return;
  }

  const drafts = (state.myPosts || []).filter((item) => item.status === 'draft').slice(0, 4);
  const savedIds = Array.isArray(user.saved) ? user.saved : [];
  const saved = (state.posts || []).filter((item) => savedIds.includes(item.id)).slice(0, 4);

  if (draftList) {
    draftList.innerHTML = drafts.length
      ? drafts.map((draft) => `
          <div class="mini-item">
            <div>
              <strong>${escapeHtml(draft.title || 'Untitled draft')}</strong>
              <p>${escapeHtml((draft.content || '').slice(0, 70))}${(draft.content || '').length > 70 ? '…' : ''}</p>
            </div>
            <span class="status-badge">Draft</span>
          </div>
        `).join('')
      : '<p class="empty-copy">No drafts saved yet.</p>';
  }

  if (savedList) {
    savedList.innerHTML = saved.length
      ? saved.map((entry) => `
          <div class="mini-item">
            <div>
              <strong>${escapeHtml(entry.title || 'Saved writing')}</strong>
              <p>${escapeHtml((entry.content || '').slice(0, 70))}${(entry.content || '').length > 70 ? '…' : ''}</p>
            </div>
            <span class="status-badge muted">Saved</span>
          </div>
        `).join('')
      : '<p class="empty-copy">You have not saved any writing yet.</p>';
  }
}

function renderWriterList() {
  const writersList = document.getElementById('writersList');
  if (!writersList) return;

  const me = getCurrentUser();
  const writers = state.users
    .slice()
    .sort((a, b) => {
      const followed = (user) => me && Array.isArray(me.following) && me.following.includes(user.id) ? 1 : 0;
      return followed(b) - followed(a);
    })
    .slice(0, 8);

  if (!writers.length) {
    writersList.innerHTML = '<div class="post-card"><p>New voices will appear here as soon as the community grows.</p></div>';
    return;
  }

  writersList.innerHTML = writers
    .map((user) => {
      const isFollowing = me && Array.isArray(me.following) ? me.following.includes(user.id) : false;
      return `
        <article class="writer-card">
          <div class="writer-head">
            <img src="${user.avatar || './Img/Logo.jpg'}" alt="${escapeHtml(user.displayName || user.username)}" />
            <div>
              <strong>${escapeHtml(user.displayName || user.username)}</strong>
              <span>@${escapeHtml(user.username)}</span>
            </div>
          </div>
          <p>${escapeHtml(user.bio || 'Fresh voice in the INKurgic community.')}</p>
          <div class="writer-meta">
            <span>${user.followersCount || user.followers?.length || 0} followers</span>
            <button class="btn ${isFollowing ? '' : 'primary'}" type="button" data-follow="${user.id}">${isFollowing ? 'Following' : 'Follow'}</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderPosts() {
  renderWriterDashboard();
  renderProfileSummary();

  const postsContainer = document.getElementById('posts');
  const poemsGrid = document.getElementById('poemsGrid');

  if (postsContainer) {
    postsContainer.innerHTML = '';
    if (!state.posts.length) {
      postsContainer.innerHTML = '<div class="post-card"><p>No writings have been published yet. Be the first to share a piece.</p></div>';
    }
    state.posts.slice(0, 6).forEach((post) => {
      const card = document.createElement('article');
      card.className = 'post';
      const comments = Array.isArray(post.comments) ? post.comments : [];
      card.innerHTML = `
        <div class="meta">
          <img src="${post.authorAvatar || './Img/Logo.jpg'}" alt="${escapeHtml(post.authorName || 'Writer')}" />
          <div>
            <strong>${escapeHtml(post.authorName || 'Writer')}</strong>
            <div class="muted">${new Date(post.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
        <h4>${escapeHtml(post.title)}</h4>
        <p>${escapeHtml(post.content.slice(0, 220))}${post.content.length > 220 ? '…' : ''}</p>
        ${post.image ? `<img class="full" src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" />` : ''}
        <div class="reactions">
          <button class="react-btn" data-like="${post.id}">♥ ${post.likesCount || post.likes?.length || 0}</button>
          <button class="react-btn" data-comment="${post.id}" type="button">💬 ${post.commentsCount || comments.length}</button>
          <button class="react-btn" data-save="${post.id}">🔖 Save</button>
          ${getCurrentUser()?.id === post.authorId || getCurrentUser()?.isAdmin ? `<button class="react-btn danger" data-delete="${post.id}" aria-label="Delete ${escapeHtml(post.title)}">🗑 Delete</button>` : ''}
        </div>
        <div class="comment-block">
          <div class="comment-summary">Comments (${post.commentsCount || comments.length})</div>
          ${comments.slice(0, 2).map((comment) => `
            <div class="comment-item">
              <strong>${escapeHtml(comment.authorName || 'Writer')}</strong>
              <p>${escapeHtml(comment.text)}</p>
            </div>
          `).join('') || '<p style="color:#666;">No comments yet.</p>'}
          <form class="comment-form" data-comment-form="${post.id}">
            <textarea class="comment-input" data-comment-input="${post.id}" placeholder="Leave a comment on this writing..." rows="2"></textarea>
            <button class="btn primary" type="submit">Post Comment</button>
          </form>
        </div>
      `;
      postsContainer.appendChild(card);
    });
  }

  if (poemsGrid) {
    poemsGrid.innerHTML = '';
    if (!state.posts.length) {
      poemsGrid.innerHTML = '<div class="post-card"><p>No poetry workshop pieces yet.</p></div>';
      return;
    }

    state.posts.slice(0, 8).forEach((post) => {
      const comments = Array.isArray(post.comments) ? post.comments : [];
      const item = document.createElement('article');
      item.className = 'post-card';
      item.innerHTML = `
        <h3>${escapeHtml(post.title)}</h3>
        ${post.image ? `<img class="writing-card-image" src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" />` : ''}
        <p>${escapeHtml(post.content.slice(0, 180))}${post.content.length > 180 ? '…' : ''}</p>
        <div class="meta">
          <span>${escapeHtml(post.category || 'poetry')}</span>
          <span>${new Date(post.createdAt).toLocaleDateString()}</span>
        </div>
        ${(getCurrentUser()?.id === post.authorId || getCurrentUser()?.isAdmin) ? `<button class="react-btn danger writeup-delete" type="button" data-delete="${post.id}" aria-label="Delete ${escapeHtml(post.title)}" title="Delete writeup">🗑 Delete</button>` : ''}
        <div class="comment-block">
          <div class="comment-summary">Comments (${post.commentsCount || comments.length})</div>
          ${comments.slice(0, 2).map((comment) => `
            <div class="comment-item">
              <strong>${escapeHtml(comment.authorName || 'Writer')}</strong>
              <p>${escapeHtml(comment.text)}</p>
            </div>
          `).join('') || '<p style="color:#666;">No comments yet.</p>'}
          <form class="comment-form" data-comment-form="${post.id}">
            <textarea class="comment-input" data-comment-input="${post.id}" placeholder="Share your thoughts..." rows="2"></textarea>
            <button class="btn primary" type="submit">Reply</button>
          </form>
        </div>
      `;
      poemsGrid.appendChild(item);
    });
  }

  bindCommentForms();
}

function bindCommentForms() {
  document.querySelectorAll('.comment-form').forEach((form) => {
    form.removeEventListener('submit', form._inkCommentSubmitHandler);
    const submitHandler = async (event) => {
      event.preventDefault();
      const postId = form.dataset.commentForm;
      const textarea = form.querySelector('textarea[data-comment-input]');
      if (!postId || !textarea) return;
      await submitComment(postId, textarea.value);
      textarea.value = '';
    };
    form._inkCommentSubmitHandler = submitHandler;
    form.addEventListener('submit', submitHandler);
  });
}

async function deleteWriting(writingId) {
  const post = state.posts.find((item) => item.id === writingId);
  if (!post || !window.confirm(`Delete “${post.title || 'this writing'}”? This cannot be undone.`)) return;

  try {
    await requestJson(`${API_BASE}/writings/${writingId}`, {
      method: 'DELETE',
      headers: attachAuthHeaders(),
    });
    state.posts = state.posts.filter((item) => item.id !== writingId);
    renderPosts();
    showToast('Writing deleted.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to delete this writing.', 'error');
  }
}

async function renderSupportChatModal() {
  const container = document.getElementById('supportChatModalMessages');
  const modal = document.getElementById('supportChatModal');
  if (!container) return;

  if (modal) {
    modal.classList.remove('hidden');
  }
  await loadSupportMessages(container);
}

function openSupportChatModal() {
  if (!getCurrentUser()) {
    openModal('logModal');
    return;
  }
  renderSupportChatModal();
}

function closeSupportChatModal() {
  const modal = document.getElementById('supportChatModal');
  if (modal) modal.classList.add('hidden');
}

async function submitComment(postId, text) {
  const message = String(text || '').trim();
  const user = getCurrentUser();

  if (!user) {
    openModal('logModal');
    return;
  }

  if (!message) {
    showToast('Write a comment before posting it.', 'error');
    return;
  }

  try {
    await requestJson(`${API_BASE}/writings/${postId}/comment`, {
      method: 'POST',
      headers: attachAuthHeaders(),
      body: JSON.stringify({ text: message }),
    });

    showToast('Comment posted successfully.', 'success');
    await loadPosts();
  } catch (error) {
    showToast(error.message || 'Unable to post the comment.', 'error');
  }
}

function updateChallengeSummary() {
  const challengeSelect = document.getElementById('challengeSelect');
  const customChallenge = document.getElementById('customChallenge');
  const challengeValue = document.getElementById('challengeValue');
  const currentChallenge = document.getElementById('currentChallenge');

  if (!challengeSelect) return;

  const value = challengeSelect.value;
  const finalValue = value === 'custom' ? customChallenge.value || 100 : value;

  if (challengeValue) challengeValue.textContent = finalValue;
  if (currentChallenge) currentChallenge.textContent = finalValue;

  if (value === 'custom') {
    customChallenge.style.display = 'block';
  } else {
    customChallenge.style.display = 'none';
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 480;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      image.onerror = () => reject(new Error('Unable to process the selected image.'));
      image.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function saveDraft(event) {
  if (event) event.preventDefault();

  const user = getCurrentUser();
  if (!user) {
    openModal('logModal');
    return;
  }

  const title = document.getElementById('title').value.trim();
  const content = document.getElementById('content').value.trim();

  if (!title && !content) {
    showToast('Write a title or a few lines before saving a draft.', 'error');
    return;
  }

  try {
    const fileInput = document.getElementById('image');
    const image = fileInput?.files?.[0] ? await readFileAsDataUrl(fileInput.files[0]) : '';
    await requestJson(`${API_BASE}/writings`, {
      method: 'POST',
      headers: attachAuthHeaders(),
      body: JSON.stringify({
        title: title || 'Untitled Draft',
        content: content || 'Draft saved from INKurgic.',
        category: 'poetry',
        image,
        status: 'draft',
      }),
    });

    showToast('Draft saved successfully.', 'success');
    document.getElementById('postForm').reset();
    loadPosts();
  } catch (error) {
    showToast(error.message || 'Could not save draft.', 'error');
  }
}

async function submitPost(event) {
  event.preventDefault();

  const user = getCurrentUser();
  if (!user) {
    showToast('Please sign in to publish your writing.', 'error');
    return;
  }

  const title = document.getElementById('title').value.trim();
  const content = document.getElementById('content').value.trim();
  const category = 'poetry';

  if (!title || !content) {
    showToast('Your writing needs a title and content.', 'error');
    return;
  }

  try {
    const fileInput = document.getElementById('image');
    const image = fileInput && fileInput.files && fileInput.files[0] ? await readFileAsDataUrl(fileInput.files[0]) : '';

    await requestJson(`${API_BASE}/writings`, {
      method: 'POST',
      headers: attachAuthHeaders(),
      body: JSON.stringify({ title, content, category, image, status: 'published' }),
    });

    document.getElementById('postForm').reset();
    showSuccessBadge();
    showToast('Your writing has been published.', 'success');
    loadPosts();
  } catch (error) {
    showToast(error.message || 'Could not publish writing.', 'error');
  }
}

async function handleProfileSave(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) {
    openModal('logModal');
    return;
  }

  try {
    const avatarInput = document.getElementById('profileAvatarInput');
    const avatar = avatarInput && avatarInput.files && avatarInput.files[0]
      ? await readFileAsDataUrl(avatarInput.files[0])
      : state.selectedAvatar || user.avatar;
    const payload = {
      displayName: document.getElementById('profileDisplayName').value.trim() || user.displayName,
      bio: document.getElementById('profileBio').value.trim() || user.bio,
      avatar: avatar !== undefined ? avatar : user.avatar,
    };

    const data = await requestJson(`${API_BASE}/users/me`, {
      method: 'PUT',
      headers: attachAuthHeaders(),
      body: JSON.stringify(payload),
    });

    setCurrentUser(data.user);
    state.selectedAvatar = data.user.avatar || '';
    renderProfileSummary();
    renderWriterList();
    if (avatar !== undefined) {
      const currentAvatar = document.getElementById('currentAvatar');
      if (currentAvatar) currentAvatar.src = data.user.avatar || './Img/Logo.jpg';
    }
    showToast('Profile updated.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to update profile.', 'error');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const payload = {
    username: document.getElementById('regUser').value.trim(),
    displayName: document.getElementById('regName').value.trim(),
    email: document.getElementById('regEmail').value.trim(),
    password: document.getElementById('regPass').value,
  };

  if (payload.password !== document.getElementById('regConfirm').value) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  try {
    const data = await requestJson(`${API_BASE}/auth/register`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setToken(data.token);
    setCurrentUser(data.user);
    closeModal('regModal');
    document.getElementById('regForm').reset();
    showSuccessBadge();
    showToast('Welcome to INKurgic.', 'success');
    navigate('home');
    loadPosts();
    loadStreak();
    renderSupportChat();
    loadNotifications();
  } catch (error) {
    showToast(error.message || 'Registration failed.', 'error');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const payload = {
    username: document.getElementById('logUser').value.trim(),
    password: document.getElementById('logPass').value,
  };

  try {
    const data = await requestJson(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setToken(data.token);
    setCurrentUser(data.user);
    closeModal('logModal');
    document.getElementById('logForm').reset();
    showSuccessBadge();
    showToast('Signed in successfully.', 'success');
    navigate('home');
    loadPosts();
    loadStreak();
  } catch (error) {
    showToast(error.message || 'Login failed.', 'error');
  }
}

function showResetRequestForm() {
  const requestForm = document.getElementById('resetRequestForm');
  const passwordForm = document.getElementById('resetPasswordForm');
  if (requestForm) requestForm.hidden = false;
  if (passwordForm) passwordForm.hidden = true;
  openModal('resetModal');
}

async function requestPasswordReset(event) {
  event?.preventDefault();
  const email = document.getElementById('resetEmail')?.value.trim();
  if (!email) return showResetRequestForm();
  try {
    const data = await requestJson(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
    });
    showToast(data.message, 'success');
    closeModal('resetModal');
  } catch (error) {
    showToast(error.message || 'Unable to start password reset.', 'error');
  }
}

async function resetPasswordFromLink() {
  const token = new URLSearchParams(window.location.search).get('reset');
  if (!token) return;
  state.resetToken = token;
  document.getElementById('resetRequestForm').hidden = true;
  document.getElementById('resetPasswordForm').hidden = false;
  openModal('resetModal');
}

async function submitPasswordReset(event) {
  event.preventDefault();
  const password = document.getElementById('resetPassword')?.value || '';
  const confirmation = document.getElementById('resetPasswordConfirm')?.value || '';
  if (password !== confirmation) return showToast('Passwords do not match.', 'error');
  try {
    const data = await requestJson(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ token: state.resetToken, password }),
    });
    window.history.replaceState({}, document.title, window.location.pathname);
    closeModal('resetModal');
    showToast(data.message, 'success');
    openModal('logModal');
  } catch (error) {
    showToast(error.message || 'Unable to reset password.', 'error');
  }
}

function togglePasswordVisibility(inputId, buttonId) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);

  if (!input || !button) return;

  const shouldShow = input.type === 'password';
  input.type = shouldShow ? 'text' : 'password';
  button.textContent = shouldShow ? '🙈' : '👁';
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

async function logout() {
  setToken(null);
  setCurrentUser(null);
  navigate('home');
  showToast('You have been signed out.', 'info');
}

async function subscribeToPlan() {
  const user = getCurrentUser();
  if (!user) return openModal('logModal');
  if (user.isAdmin) return showToast('Admin premium access is already active.', 'info');
  const button = document.getElementById('subscribeBtn');
  if (button) button.disabled = true;
  try {
    const data = await requestJson(`${API_BASE}/payments/initialize`, {
      method: 'POST',
      headers: attachAuthHeaders(),
      body: JSON.stringify({ planId: 'go-pro' }),
    });
    window.location.assign(data.authorizationUrl);
  } catch (error) {
    if (button) button.disabled = false;
    showToast(error.message || 'Paystack checkout could not be loaded.', 'error');
  }
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') !== 'return') return;
  const reference = params.get('reference') || params.get('trxref');
  window.history.replaceState({}, document.title, window.location.pathname);
  if (!reference) return showToast('Payment was cancelled. No charge was verified.', 'info');
  try {
    const data = await requestJson(`${API_BASE}/subscribe`, { method: 'POST', headers: attachAuthHeaders(), body: JSON.stringify({ planId: 'go-pro', reference }) });
    setCurrentUser(data.user);
    renderProfileSummary();
    showToast('Premium unlocked. Welcome to the deeper studio.', 'success');
  } catch (error) {
    showToast(error.message || 'Payment verification failed. No premium access was granted.', 'error');
  }
}

const guideSteps = [
  { topic: 'Home Sanctuary', title: 'Start at Home', text: 'Find fresh writing, daily prompts, and your personal creative focus from the Home page.', visual: 'home', section: 'home' },
  { topic: 'Poems', title: 'Read and discover', text: 'Open Poems to browse community work, leave thoughtful reactions, and follow writers whose voices stay with you.', visual: 'poems', section: 'poems' },
  { topic: 'Create and Write', title: 'Make something yours', text: 'Use Poem Studio to save a draft, set a writing goal, or publish a finished piece.', visual: 'create', section: 'poems' },
  { topic: 'Engage', title: 'Build a rhythm', text: 'Engage tracks progress from real writing activity and keeps one check-in per day, automatically.', visual: 'engage', section: 'engage' },
  { topic: 'Profile', title: 'Shape your writer identity', text: 'Manage your name, bio, avatar, drafts, saved works, and audience from Profile.', visual: 'profile', section: 'profile' },
  { topic: 'Your view', title: 'Choose your atmosphere', text: 'Use the day and night toggle in the landing page or main navigation to make the writing space feel like yours.', visual: 'home', section: 'home' },
  { topic: 'Support', title: 'Ask Luma', text: 'Open Luma Support for a private conversation, or send feedback directly to the INKurgic team.', visual: 'support', section: 'home' },
  { topic: 'Premium', title: 'Unlock your edge', text: 'Writer Premium adds deeper tools, unlimited uploads, and priority support for your practice.', visual: 'premium', section: 'home' },
];

function renderGuide() {
  const step = guideSteps[state.guideStep];
  const visual = document.getElementById('tourVisual');
  const indicator = document.getElementById('tourStepIndicator');
  const topic = document.getElementById('tourTopic');
  const title = document.getElementById('tourTitle');
  const description = document.getElementById('tourDescription');
  const dots = document.getElementById('tourDots');
  if (!step || !visual || !indicator || !topic || !title || !description || !dots) return;
  visual.dataset.tourView = step.visual;
  visual.innerHTML = `<span class="tour-visual-label">${escapeHtml(step.topic)}</span><span class="tour-visual-marker" aria-hidden="true"></span>`;
  indicator.textContent = `Step ${state.guideStep + 1} of ${guideSteps.length}`;
  topic.textContent = step.topic;
  title.textContent = step.title;
  description.textContent = step.text;
  dots.innerHTML = guideSteps.map((item, index) => `<span class="tour-dot${index === state.guideStep ? ' active' : ''}" aria-label="Step ${index + 1}"></span>`).join('');
  document.getElementById('tourPrevBtn').disabled = state.guideStep === 0;
  document.getElementById('tourNextBtn').textContent = state.guideStep === guideSteps.length - 1 ? 'Done' : 'Next step';
}

async function loadNotifications() {
  const user = getCurrentUser();
  if (!user) return;

  try {
    const data = await requestJson(`${API_BASE}/notifications`, {
      headers: attachAuthHeaders(),
    });
    state.notifications = data.notifications || [];
  } catch (error) {
    state.notifications = [];
  }
}

async function handlePromptShuffle() {
  if (!state.prompts.length) return;
  const currentIndex = state.prompts.indexOf(state.currentPrompt);
  const nextIndex = (currentIndex + 1 + Math.floor(Math.random() * (state.prompts.length - 1))) % state.prompts.length;
  state.currentPrompt = state.prompts[nextIndex];
  renderPromptCard();
  showToast('Fresh prompt ready.', 'info');
}

async function handlePostAction(target, action) {
  const post = state.posts.find((item) => item.id === target);
  if (!post) return;

  if (!getCurrentUser()) {
    openModal('logModal');
    return;
  }

  try {
    if (action === 'like') {
      const data = await requestJson(`${API_BASE}/writings/${target}/like`, {
        method: 'POST',
        headers: attachAuthHeaders(),
      });
      post.likesCount = data.likes;
      showToast(data.liked ? 'Writing liked.' : 'Like removed.', 'success');
    }

    if (action === 'save') {
      const data = await requestJson(`${API_BASE}/writings/${target}/save`, {
        method: 'POST',
        headers: attachAuthHeaders(),
      });
      showToast(data.saved ? 'Saved to your reading list.' : 'Removed from saved list.', 'success');
    }

    renderPosts();
  } catch (error) {
    showToast(error.message || 'Unable to update writing.', 'error');
  }
}

function bindEvents() {
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', toggleTheme);
  });
  document.querySelectorAll('[data-open-register]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('publicExperience')?.classList.add('leaving');
      openModal('regModal');
    });
  });
  document.querySelectorAll('[data-open-login]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('publicExperience')?.classList.add('leaving');
      openModal('logModal');
    });
  });
  document.getElementById('registerBtn')?.addEventListener('click', () => openModal('regModal'));
  document.getElementById('loginBtn')?.addEventListener('click', () => openModal('logModal'));
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('adminBtn')?.addEventListener('click', () => window.open('./admin/index.html', '_self'));
  document.getElementById('startWritingBtn')?.addEventListener('click', () => navigate('poems'));
  document.getElementById('subscribeBtn')?.addEventListener('click', subscribeToPlan);
  document.getElementById('guideFab')?.addEventListener('click', () => { state.guideStep = 0; renderGuide(); openModal('howToUseModal'); });
  document.getElementById('tourNextBtn')?.addEventListener('click', () => {
    if (state.guideStep === guideSteps.length - 1) return closeModal('howToUseModal');
    state.guideStep += 1;
    renderGuide();
  });
  document.getElementById('tourPrevBtn')?.addEventListener('click', () => {
    state.guideStep = Math.max(0, state.guideStep - 1);
    renderGuide();
  });
  document.getElementById('tourCloseBtn')?.addEventListener('click', () => closeModal('howToUseModal'));
  document.getElementById('tourJumpBtn')?.addEventListener('click', () => navigate(guideSteps[state.guideStep].section));
  document.getElementById('footerHowToUseBtn')?.addEventListener('click', () => {
    state.guideStep = 0;
    renderGuide();
    openModal('howToUseModal');
  });
  document.getElementById('footerSupportBtn')?.addEventListener('click', openSupportChatModal);
  document.getElementById('footerFeedbackBtn')?.addEventListener('click', () => {
    navigate('home');
    document.getElementById('feedbackSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('writerBoostBtn')?.addEventListener('click', () => {
    navigate('poems');
    showToast('Your next draft can start from the Poem Studio.', 'info');
  });
  document.getElementById('shufflePromptBtn')?.addEventListener('click', handlePromptShuffle);
  document.getElementById('seeMorePromptsBtn')?.addEventListener('click', () => navigate('prompts'));
  document.getElementById('postForm')?.addEventListener('submit', submitPost);
  document.getElementById('regForm')?.addEventListener('submit', handleRegister);
  document.getElementById('logForm')?.addEventListener('submit', handleLogin);
  document.getElementById('forgotPasswordLink')?.addEventListener('click', requestPasswordReset);
  document.getElementById('resetRequestForm')?.addEventListener('submit', requestPasswordReset);
  document.getElementById('resetPasswordForm')?.addEventListener('submit', submitPasswordReset);
  document.getElementById('challengeSelect')?.addEventListener('change', updateChallengeSummary);
  document.getElementById('customChallenge')?.addEventListener('input', updateChallengeSummary);
  document.getElementById('mainSearch')?.addEventListener('input', async (event) => {
    const value = event.target.value.trim();
    await loadPosts(value);
  });
  document.getElementById('saveDraftBtn')?.addEventListener('click', saveDraft);
  document.getElementById('clearBtn')?.addEventListener('click', () => document.getElementById('postForm').reset());
  document.getElementById('image')?.addEventListener('change', async (event) => {
    const preview = document.getElementById('writingImagePreview');
    const file = event.target.files?.[0];
    if (!preview || !file) {
      if (preview) preview.hidden = true;
      return;
    }
    try {
      preview.src = await readFileAsDataUrl(file);
      preview.hidden = false;
    } catch (error) {
      event.target.value = '';
      preview.hidden = true;
      showToast(error.message || 'Unable to preview this image.', 'error');
    }
  });
  document.getElementById('profileForm')?.addEventListener('submit', handleProfileSave);
  document.querySelectorAll('.avatar-option').forEach((option) => {
    option.addEventListener('click', () => selectAvatar(option.dataset.avatar));
  });
  document.getElementById('profileAvatarInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      state.selectedAvatar = await readFileAsDataUrl(file);
      const preview = document.getElementById('profileSummaryAvatar');
      if (preview) preview.src = state.selectedAvatar;
      document.querySelectorAll('.avatar-option').forEach((option) => option.classList.remove('selected'));
    } catch (error) {
      event.target.value = '';
      showToast(error.message || 'Unable to preview this profile image.', 'error');
    }
  });
  document.getElementById('supportChatForm')?.addEventListener('submit', submitSupportChat);
  document.getElementById('supportChatModalForm')?.addEventListener('submit', submitSupportChat);
  document.getElementById('feedbackForm')?.addEventListener('submit', submitFeedback);
  document.getElementById('feedbackMessage')?.addEventListener('input', updateFeedbackCharacterCount);
  document.getElementById('supportChatFab')?.addEventListener('click', openSupportChatModal);
  document.querySelectorAll('[data-close-modal="supportChatModal"]').forEach((button) => {
    button.addEventListener('click', closeSupportChatModal);
  });
  document.getElementById('regPassToggle')?.addEventListener('click', () => togglePasswordVisibility('regPass', 'regPassToggle'));
  document.getElementById('regConfirmToggle')?.addEventListener('click', () => togglePasswordVisibility('regConfirm', 'regConfirmToggle'));
  document.getElementById('logPassToggle')?.addEventListener('click', () => togglePasswordVisibility('logPass', 'logPassToggle'));
  document.querySelectorAll('.close-modal').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal('regModal');
      closeModal('logModal');
      closeModal('emailModal');
      closeModal('howToUseModal');
      closeModal('resetModal');
    });
  });

  document.querySelector('.nav-toggle')?.addEventListener('click', () => {
    const nav = document.querySelector('.nav-links');
    const toggle = document.querySelector('.nav-toggle');
    nav.classList.toggle('show');
    toggle.classList.toggle('open');
    toggle.setAttribute('aria-expanded', nav.classList.contains('show') ? 'true' : 'false');
  });

  document.querySelectorAll('[data-navigate]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const target = link.dataset.navigate || 'home';
      navigate(target);
      if (window.innerWidth <= 600) {
        document.querySelector('.nav-links').classList.remove('show');
        document.querySelector('.nav-toggle').classList.remove('open');
      }
    });
  });

  document.addEventListener('click', async (event) => {
    const likeButton = event.target.closest('[data-like]');
    const saveButton = event.target.closest('[data-save]');
    const commentButton = event.target.closest('[data-comment]');
    const followButton = event.target.closest('[data-follow]');
    const deleteButton = event.target.closest('[data-delete]');
    const loginButton = event.target.closest('[data-open-login]');
    const goalButton = event.target.closest('[data-streak-goal]');

    if (loginButton) {
      openModal('logModal');
      return;
    }

    if (goalButton) {
      const goal = document.getElementById('streakGoal')?.value;
      try {
        await requestJson(`${API_BASE}/streak`, { method: 'PATCH', headers: attachAuthHeaders(), body: JSON.stringify({ goal }) });
        await loadStreak();
        showToast('Your new goal is set.', 'success');
      } catch (error) {
        showToast(error.message || 'Unable to save your goal.', 'error');
      }
      return;
    }

    if (deleteButton) {
      await deleteWriting(deleteButton.dataset.delete);
      return;
    }

    if (likeButton) {
      await handlePostAction(likeButton.dataset.like, 'like');
      return;
    }

    if (saveButton) {
      await handlePostAction(saveButton.dataset.save, 'save');
      return;
    }

    if (commentButton) {
      const textarea = document.querySelector(`textarea[data-comment-input="${commentButton.dataset.comment}"]`);
      if (textarea) {
        textarea.focus();
        textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

    if (followButton) {
      const userId = followButton.dataset.follow;
      if (!userId) return;

      if (!getCurrentUser()) {
        openModal('logModal');
        return;
      }

      try {
        await requestJson(`${API_BASE}/users/${userId}/follow`, {
          method: 'POST',
          headers: attachAuthHeaders(),
        });

        await loadUsers();
        await loadSession();
        showToast('Writer updated.', 'success');
      } catch (error) {
        showToast(error.message || 'Unable to follow writer.', 'error');
      }
    }
  });

}

async function initApp() {
  applyTheme(localStorage.getItem(themeKey) || 'light');
  getCurrentUser();
  updateAppVisibility();
  bindEvents();
  renderAuthState();
  renderPromptCard();
  updateChallengeSummary();
  loadPaystackConfig();
  await loadSession();
  await loadPrompts();
  await loadUsers();
  renderSupportChat();
  await loadPosts();
  await loadStreak();
  renderWriterDashboard();
  renderProfileSummary();
  await loadNotifications();
  const initialUser = getCurrentUser();
  if (initialUser) {
    showToast(`Welcome back, ${initialUser.displayName || initialUser.username}.`, 'success');
  }
  await resetPasswordFromLink();
  await handlePaymentReturn();
}

window.addEventListener('DOMContentLoaded', initApp);
