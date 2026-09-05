const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkurgic-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'inkurgic-test-secret-that-is-long-enough';
process.env.ADMIN_EMAIL = 'inkurgic@gmail.com';

const { app } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${route}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

test('core account, privacy, streak, prompt, and admin flows work', async () => {
  const admin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'inkurgic@gmail.com', password: 'inkurgic' }),
  });
  assert.equal(admin.user.email, 'inkurgic@gmail.com');
  assert.equal(admin.user.isAdmin, true);

  const legacyAdminLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'ember@inkurgic.com', password: 'inkurgic' }),
  });
  assert.equal(legacyAdminLogin.user.isAdmin, true);

  const username = `writer${Date.now()}`;
  const email = `${username}@example.com`;
  const registered = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, displayName: 'Test Writer', email, password: 'password123' }),
  });
  const auth = { Authorization: `Bearer ${registered.token}` };

  const avatarUpdate = await request('/users/me', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ avatar: './Img/avatar-sunrise.svg' }),
  });
  assert.equal(avatarUpdate.user.avatar, './Img/avatar-sunrise.svg');

  const premiumAvatarResponse = await fetch(`${baseUrl}/users/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ avatar: './Img/luma.svg' }),
  });
  assert.equal(premiumAvatarResponse.status, 402);

  const draft = await request('/writings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Private draft', content: 'Only its author should see this.', status: 'draft' }),
  });
  const publicFeed = await request('/writings');
  const privateFeed = await request('/writings/mine', { headers: auth });
  assert.equal(publicFeed.writings.some((writing) => writing.id === draft.writing.id), false);
  assert.equal(privateFeed.writings.some((writing) => writing.id === draft.writing.id), true);

  const prompts = await request('/prompts');
  assert.ok(prompts.prompts.length >= 10);
  const initialStreak = await request('/streak', { headers: auth });
  assert.equal(initialStreak.streak.current, 0);
  const checkIn = await request('/streak/check-in', { method: 'POST', headers: auth });
  assert.equal(checkIn.streak.current, 1);

  const resetRequest = await request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  assert.match(resetRequest.message, /reset link/i);

  const overview = await request('/admin/overview', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.ok(overview.stats.users >= 2);

  const promoted = await request('/admin/promote', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ email }),
  });
  assert.equal(promoted.user.isAdmin, true);
  assert.equal(promoted.user.isPaid, true);
});
