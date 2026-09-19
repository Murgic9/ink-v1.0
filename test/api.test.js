const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkurgic-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'inkurgic-test-secret-that-is-long-enough';
process.env.ADMIN_EMAIL = 'inkurgic@gmail.com';

const serverModule = require('../server');
const { app } = serverModule;
const { readStore, writeStore } = require('../data/store');

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

  const uploadedAvatar = 'data:image/jpeg;base64,' + Buffer.from('profile-image-fixture').toString('base64');
  const uploadedAvatarResponse = await request('/users/me', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ avatar: uploadedAvatar }),
  });
  assert.equal(uploadedAvatarResponse.user.avatar, uploadedAvatar);
  const refreshedUser = await request('/auth/me', { headers: auth });
  assert.equal(refreshedUser.user.avatar, uploadedAvatar);

  const writing = await request('/writings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Persistent voice', content: 'This writing must remain attached to the account.' }),
  });
  const supportMessage = await request('/support/messages', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ userId: 'user-admin', text: 'Please help with my persistent profile.' }),
  });
  assert.equal(supportMessage.message.userId, registered.user.id);
  assert.equal(supportMessage.message.email, email);
  assert.equal(supportMessage.message.status, 'unread');
  const persistenceFeedback = await request('/feedback', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ category: 'Account', message: 'My account should remain available after logout.' }),
  });

  const logoutLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: email, password: 'password123' }),
  });
  assert.equal(logoutLogin.user.id, registered.user.id);
  assert.equal(logoutLogin.user.avatar, uploadedAvatar);
  assert.equal(logoutLogin.user.displayName, 'Test Writer');
  const persistedWritings = await request('/writings/mine', { headers: { Authorization: `Bearer ${logoutLogin.token}` } });
  assert.ok(persistedWritings.writings.some((item) => item.id === writing.writing.id));
  const adminFeedback = await request('/admin/feedback', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.ok(adminFeedback.feedback.some((item) => item.id === persistenceFeedback.feedback.id && item.userId === registered.user.id && item.email === email));
  const adminSupport = await request('/admin/support/messages', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.ok(adminSupport.messages.some((item) => item.id === supportMessage.message.id && item.displayName === 'Test Writer' && item.email === email));

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

  const deleteResponse = await fetch(`${baseUrl}/writings/${draft.writing.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...auth },
  });
  assert.equal(deleteResponse.status, 200);
  const afterDelete = await request('/writings/mine', { headers: auth });
  assert.equal(afterDelete.writings.some((writing) => writing.id === draft.writing.id), false);

  const feedback = await request('/feedback', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ category: 'Product', message: 'The prompt library feels useful.' }),
  });
  assert.equal(feedback.feedback.status, 'unread');

  const prompts = await request('/prompts');
  assert.ok(prompts.prompts.length >= 10);
  const initialStreak = await request('/streak', { headers: auth });
  assert.equal(initialStreak.streak.current, 1);
  assert.equal(initialStreak.streak.activeToday, true);
  const checkIn = await request('/streak/check-in', { method: 'POST', headers: auth });
  assert.equal(checkIn.streak.current, 1);
  assert.equal(checkIn.alreadyCheckedIn, true);

  const resetRequest = await request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  assert.match(resetRequest.message, /reset link/i);

  const resetToken = 'test-reset-token';
  const resetStore = readStore();
  const resetUser = resetStore.users.find((user) => user.id === registered.user.id);
  resetUser.passwordReset = {
    tokenHash: crypto.createHash('sha256').update(resetToken).digest('hex'),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  writeStore(resetStore);
  const resetResponse = await request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: 'newpassword123' }),
  });
  assert.match(resetResponse.message, /successfully/i);
  const resetLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: email, password: 'newpassword123' }),
  });
  assert.equal(resetLogin.user.id, registered.user.id);

  const overview = await request('/admin/overview', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.ok(overview.stats.users >= 2);

  const feedbackInbox = await request('/admin/feedback', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(feedbackInbox.feedback[0].id, feedback.feedback.id);
  const feedbackRead = await request(`/admin/feedback/${feedback.feedback.id}/read`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(feedbackRead.feedback.status, 'read');

  const promoted = await request('/admin/promote', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ email }),
  });
  assert.equal(promoted.user.isAdmin, true);
  assert.equal(promoted.user.isPaid, true);

  const config = await request('/config');
  assert.equal(config.paystackCurrency, 'USD');
  assert.equal(config.paystackAmount, 299);

  const paymentUsername = `premium${Date.now()}`;
  const paymentEmail = `${paymentUsername}@example.com`;
  const paymentUser = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: paymentUsername, displayName: 'Premium Writer', email: paymentEmail, password: 'password123' }),
  });
  const paymentAuth = { Authorization: `Bearer ${paymentUser.token}` };

  process.env.PAYSTACK_SECRET_KEY = 'sk_test_inkurgic';
  const paystackCalls = [];
  serverModule.paystackFetch = async (url, options = {}) => {
    paystackCalls.push({ url, options });
    if (url.includes('/transaction/initialize')) {
      return new Response(JSON.stringify({ status: true, data: { authorization_url: 'https://checkout.paystack.com/test', reference: 'paystack-test-reference' } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      status: true,
      data: {
        status: 'success',
        amount: 299,
        currency: 'USD',
        customer: { email: paymentEmail },
      },
    }), { status: 200 });
  };
  const paymentInit = await request('/payments/initialize', {
    method: 'POST',
    headers: paymentAuth,
    body: JSON.stringify({ planId: 'go-pro' }),
  });
  assert.equal(paymentInit.authorizationUrl, 'https://checkout.paystack.com/test');
  const initPayload = JSON.parse(paystackCalls[0].options.body);
  assert.equal(initPayload.amount, 299);
  assert.equal(initPayload.currency, 'USD');
  const paymentComplete = await request('/subscribe', {
    method: 'POST',
    headers: paymentAuth,
    body: JSON.stringify({ planId: 'go-pro', reference: 'paystack-test-reference' }),
  });
  assert.equal(paymentComplete.user.isPaid, true);
  assert.equal(paystackCalls.length, 2);
  serverModule.paystackFetch = null;

  const adminReply = await request('/admin/support/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ userId: registered.user.id, text: 'Hello from Luma support.' }),
  });
  assert.equal(adminReply.message.senderType, 'admin');

  const userMessagesAfterReply = await request('/support/messages', { headers: auth });
  assert.ok(userMessagesAfterReply.messages.some((m) => m.senderType === 'admin'));
});
