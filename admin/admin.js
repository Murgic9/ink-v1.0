const STORAGE_KEYS = {
  settings: 'ink_site_settings',
};

function getSiteSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)) || {};
  } catch {
    return {};
  }
}

function saveSiteSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function escapeHtml(text = '') {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function getAdminToken() {
  return localStorage.getItem('ink_admin_token') || localStorage.getItem('ink_token');
}

async function requestAdminJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

function renderStats(data = {}) {
  const users = Array.isArray(data.users) ? data.users : [];
  const writings = Array.isArray(data.writings) ? data.writings : [];
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const paidCount = users.filter((user) => user.isPaid).length;
  const followers = users.reduce((sum, user) => {
    const count = Array.isArray(user.followers) ? user.followers.length : Number(user.followers || 0);
    return sum + count;
  }, 0);

  const userCountEl = document.getElementById('adminUserCount');
  const paidCountEl = document.getElementById('adminPaidCount');
  const publishedCountEl = document.getElementById('adminPublishedCount');
  const followerCountEl = document.getElementById('adminFollowerCount');
  const notificationCountEl = document.getElementById('adminNotificationCount');

  if (userCountEl) userCountEl.textContent = users.length;
  if (paidCountEl) paidCountEl.textContent = paidCount;
  if (publishedCountEl) publishedCountEl.textContent = writings.filter((item) => item.status !== 'draft').length;
  if (followerCountEl) followerCountEl.textContent = followers;
  if (notificationCountEl) notificationCountEl.textContent = notifications.length;
}

function renderOverview(data = {}) {
  const stats = data.stats || {};
  const overview = document.getElementById('adminOverviewList');
  if (!overview) return;

  overview.innerHTML = `
    <div class="overview-row">
      <span>Writers</span>
      <strong>${stats.users || 0}</strong>
    </div>
    <div class="overview-row">
      <span>Paid members</span>
      <strong>${stats.paidUsers || 0}</strong>
    </div>
    <div class="overview-row">
      <span>Published works</span>
      <strong>${stats.writings || 0}</strong>
    </div>
    <div class="overview-row">
      <span>Followers</span>
      <strong>${stats.followers || 0}</strong>
    </div>
    <div class="overview-row">
      <span>Drafts in the studio</span>
      <strong>${stats.drafts || 0}</strong>
    </div>
    <div class="overview-row">
      <span>Active writing streaks</span>
      <strong>${stats.activeStreaks || 0}</strong>
    </div>
  `;
}

function renderPulse(data = {}) {
  const stats = data.stats || {};
  const container = document.getElementById('adminPulseGrid');
  if (!container) return;
  container.innerHTML = `
    <div class="pulse-card"><span>Administrators</span><strong>${stats.admins || 0}</strong><small>trusted operators</small></div>
    <div class="pulse-card"><span>Open conversations</span><strong>${stats.supportMessages || 0}</strong><small>support messages</small></div>
    <div class="pulse-card"><span>Draft energy</span><strong>${stats.drafts || 0}</strong><small>pieces awaiting a spark</small></div>
    <div class="pulse-card"><span>Premium members</span><strong>${stats.paidUsers || 0}</strong><small>unlocked accounts</small></div>
  `;
}

function renderApprovals(items = []) {
  const approvals = Array.isArray(items) ? items : [];
  const container = document.getElementById('approvalsList');
  if (!container) return;

  container.innerHTML = '';

  if (!approvals.length) {
    container.innerHTML = '<p style="color:#666;">No payment records yet.</p>';
    return;
  }

  approvals.slice().reverse().forEach((record) => {
    const row = document.createElement('div');
    row.className = 'approval-item';
    const title = record.userName || record.username || 'Writer';
    const plan = record.planId || 'go-pro';
    const time = new Date(record.createdAt || record.date || Date.now()).toLocaleString();
    const status = record.approved ? 'Approved' : 'Pending';

    row.innerHTML = `
      <div>
        <strong>${escapeHtml(title)}</strong>
        <div class="meta">Plan: ${escapeHtml(plan)} • ${time}</div>
        <div class="meta">Status: ${status}</div>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderUsers(users = []) {
  const container = document.getElementById('usersList');
  if (!container) return;

  const list = Array.isArray(users) ? users : [];
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = '<p style="color:#666;">No registered writers yet.</p>';
    return;
  }

  list.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'user-item';
    row.innerHTML = `
      <div class="user-row-main">
        <div class="user-avatar-wrap">
          <img src="${user.avatar || '../Img/Logo.jpg'}" alt="${escapeHtml(user.displayName || user.username)}" />
        </div>
        <div>
          <strong>${escapeHtml(user.displayName || user.username)}</strong>
          <div class="meta">@${escapeHtml(user.username)}</div>
          <div class="meta">${escapeHtml(user.email || 'no-email')}</div>
          <div class="meta">Followers: ${Array.isArray(user.followers) ? user.followers.length : 0} • Following: ${Array.isArray(user.following) ? user.following.length : 0}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn" data-toggle-paid="${user.id}">${user.isPaid ? 'Revoke Paid' : 'Mark Paid'}</button>
        <button class="btn primary" data-toggle-admin="${user.id}">${user.isAdmin ? 'Remove Admin' : 'Make Admin'}</button>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderWritings(writings = []) {
  const container = document.getElementById('writingsList');
  if (!container) return;

  const list = Array.isArray(writings) ? writings : [];
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = '<p style="color:#666;">No published writing yet.</p>';
    return;
  }

  list.slice(0, 6).forEach((writing) => {
    const item = document.createElement('div');
    item.className = 'compact-item';
    const status = writing.status === 'draft' ? 'draft' : 'published';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(writing.title || 'Untitled work')}</strong>
        <div class="meta">${escapeHtml(writing.category || 'poetry')} • ${new Date(writing.createdAt).toLocaleDateString()}</div>
      </div>
      <span class="status-pill ${status}">${status}</span>
    `;
    container.appendChild(item);
  });
}

async function renderChatUsers() {
  const container = document.getElementById('chatUsersList');
  if (!container) return;

  const token = getAdminToken();
  if (!token) {
    container.innerHTML = '<p class="empty-copy">Sign in with an administrator account to view conversations.</p>';
    return;
  }

  try {
    const data = await requestAdminJson('../api/admin/support/messages', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = data.messages || [];
    const users = [...new Set(messages.map((message) => message.userId))];
    container.innerHTML = '';
    if (!users.length) {
      container.innerHTML = '<p class="empty-copy">No conversations yet.</p>';
      return;
    }
    users.forEach((userId) => {
      const userMessages = messages.filter((message) => message.userId === userId);
    const item = document.createElement('div');
    item.className = 'approval-item';
    item.style.cursor = 'pointer';
      item.innerHTML = `<div><strong>${escapeHtml(userId)}</strong><div class="meta">${userMessages.length} messages</div></div><span class="status-pill published">Live</span>`;
      item.addEventListener('click', () => renderConversation(userId, messages));
    container.appendChild(item);
    });
  } catch (error) {
    container.innerHTML = `<p class="empty-copy">${escapeHtml(error.message || 'Unable to load conversations.')}</p>`;
  }
}

function renderConversation(userId, messages) {
  const conv = messages.filter((message) => message.userId === userId);
  const win = document.getElementById('chatWindow');
  if (!win) return;

  win.dataset.target = userId;
  win.innerHTML = conv
    .map((message) => {
      const time = new Date(message.createdAt).toLocaleString();
      return `<div class="chat-message"><div><strong>${escapeHtml(message.from)}</strong> <span>${time}</span></div><p>${escapeHtml(message.text)}</p></div>`;
    })
    .join('') || '<p style="color:#666;">No messages in this conversation.</p>';
  const chatReply = document.getElementById('chatReply');
  if (chatReply) chatReply.style.display = 'block';
}

function loadSettings() {
  const settings = getSiteSettings();
  const hero = document.getElementById('heroText');
  const plan = document.getElementById('planDesc');

  if (hero) hero.value = settings.heroMessage || 'Every idea is a spark. Write it into existence.';
  if (plan) plan.value = settings.planDescription || 'Unlock analytics, priority tools, unlimited uploads, and the support writers need to publish faster.';
}

function saveSettings() {
  const hero = document.getElementById('heroText')?.value || '';
  const plan = document.getElementById('planDesc')?.value || '';

  saveSiteSettings({ heroMessage: hero, planDescription: plan });
  alert('Homepage settings saved. Refresh the main page to see changes.');
}

async function loadAdminOverview() {
  const token = getAdminToken();
  if (!token) {
    renderStats({ users: [], writings: [], notifications: [] });
    renderOverview({ stats: { users: 0, paidUsers: 0, writings: 0, followers: 0 } });
    const overview = document.getElementById('adminOverviewList');
    if (overview) overview.innerHTML = '<p class="empty-copy">Sign in on the main site with an administrator account, then reopen this page.</p>';
    renderUsers([]);
    renderWritings([]);
    return;
  }

  try {
    const data = await requestAdminJson('../api/admin/overview', {
      headers: { Authorization: `Bearer ${token}` },
    });

    renderStats(data);
    renderOverview(data);
    renderPulse(data);
    renderUsers(data.users || []);
    renderWritings(data.writings || []);
    renderApprovals(data.subscriptions || []);
    await renderChatUsers();
  } catch (error) {
    console.error('Admin overview error:', error);
    renderStats({ users: [], writings: [], notifications: [] });
    renderOverview({ stats: { users: 0, paidUsers: 0, writings: 0, followers: 0 } });
    renderPulse({ stats: {} });
    renderUsers([]);
    renderWritings([]);
  }
}

async function toggleUserPaid(userId) {
  const token = getAdminToken();
  if (!token) return;

  try {
    await requestAdminJson(`../api/admin/users/${userId}/pay`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    await loadAdminOverview();
  } catch (error) {
    alert(error.message || 'Unable to update payment status.');
  }
}

async function toggleAdminUser(userId) {
  const token = getAdminToken();
  if (!token) return;

  try {
    await requestAdminJson(`../api/admin/users/${userId}/admin`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    await loadAdminOverview();
  } catch (error) {
    alert(error.message || 'Unable to update role.');
  }
}

async function promoteAdmin(event) {
  event.preventDefault();
  const input = document.getElementById('promoteAdminEmail');
  const status = document.getElementById('promoteAdminStatus');
  const email = input?.value.trim();
  if (!email) return;

  try {
    const data = await requestAdminJson('../api/admin/promote', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ email }),
    });
    if (status) {
      status.textContent = data.message;
      status.className = 'admin-form-status success';
    }
    input.value = '';
    await loadAdminOverview();
  } catch (error) {
    if (status) {
      status.textContent = error.message || 'Unable to grant administrator access.';
      status.className = 'admin-form-status error';
    }
  }
}

function bindAdminEvents() {
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const refreshBtn = document.getElementById('refreshAdminBtn');
  const closeBtn = document.getElementById('closeConvBtn');
  const sendBtn = document.getElementById('sendReplyBtn');
  const promoteForm = document.getElementById('promoteAdminForm');
  const inboxButton = document.getElementById('focusInboxBtn');

  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);
  if (refreshBtn) refreshBtn.addEventListener('click', loadAdminOverview);
  if (promoteForm) promoteForm.addEventListener('submit', promoteAdmin);
  if (inboxButton) inboxButton.addEventListener('click', () => document.getElementById('chatUsersList')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const chatWindow = document.getElementById('chatWindow');
      if (chatWindow) chatWindow.innerHTML = '<p style="color:#666;">Select a conversation to view messages.</p>';
      const chatReply = document.getElementById('chatReply');
      if (chatReply) chatReply.style.display = 'none';
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const target = document.getElementById('chatWindow')?.dataset.target;
      const text = document.getElementById('replyText')?.value.trim();
      if (!target || !text) return;

      try {
        await requestAdminJson('../api/admin/support/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getAdminToken()}` },
          body: JSON.stringify({ userId: target, text }),
        });
        const replyInput = document.getElementById('replyText');
        if (replyInput) replyInput.value = '';
        await renderChatUsers();
        const data = await requestAdminJson('../api/admin/support/messages', {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
        });
        renderConversation(target, data.messages || []);
      } catch (error) {
        alert(error.message || 'Unable to send reply.');
      }
    });
  }

  document.addEventListener('click', async (event) => {
    const target = event.target;
    const paidButton = target.closest('[data-toggle-paid]');
    const adminButton = target.closest('[data-toggle-admin]');

    if (paidButton) {
      await toggleUserPaid(paidButton.dataset.togglePaid);
    }

    if (adminButton) {
      await toggleAdminUser(adminButton.dataset.toggleAdmin);
    }
  });
}

async function initAdminPage() {
  loadSettings();
  renderChatUsers();
  bindAdminEvents();
  await loadAdminOverview();
  window.setInterval(() => {
    renderChatUsers();
  }, 10000);
}

window.addEventListener('DOMContentLoaded', initAdminPage);
