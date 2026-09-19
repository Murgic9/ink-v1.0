const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (error) {
  nodemailer = null;
}

require('dotenv').config();

const { connectDB } = require('./config/db');
const { readStore, writeStore } = require('./data/store');
const { requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'inkurgic@gmail.com').trim().toLowerCase();
const CLIENT_URL = String(process.env.CLIENT_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SUPPORT_NAME = String(process.env.SUPPORT_NAME || 'Luma').trim();

function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to a strong value in production.');
  }

}

try {
  validateProductionEnvironment();
} catch (error) {
  console.error('Production configuration error:', error.message);
  process.exit(1);
}

const allowedOrigins = [
  process.env.CLIENT_URL,
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const cleanOrigin = origin.replace(/\/$/, '');
  const cleanClientUrl = (process.env.CLIENT_URL || '').replace(/\/$/, '');
  if (cleanClientUrl && cleanOrigin === cleanClientUrl) return true;
  if (allowedOrigins.some((allowed) => allowed && cleanOrigin === allowed.replace(/\/$/, ''))) return true;
  if (/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(cleanOrigin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin)) return true;
  return false;
}

function getMailer() {
  if (!nodemailer || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail({ to, subject, text }) {
  const mailer = getMailer();
  if (!mailer) {
    console.warn(`Email not sent (SMTP is not configured): ${subject} -> ${to}`);
    return false;
  }

  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });
  return true;
}

function sendUserEmail(user, subject, text) {
  if (!user?.email) return Promise.resolve(false);
  return sendEmail({ to: user.email, subject, text }).catch((error) => {
    console.error(`Email delivery error for ${user.email}:`, error.message);
    return false;
  });
}

function ensureAdminAccount() {
  const store = readStore();
  const admin = store.users.find((user) => user.isAdmin || user.email === ADMIN_EMAIL);
  if (!admin) return;

  let changed = false;
  if (admin.email !== ADMIN_EMAIL) {
    admin.email = ADMIN_EMAIL;
    changed = true;
  }
  if (admin.displayName !== SUPPORT_NAME) {
    admin.displayName = SUPPORT_NAME;
    changed = true;
  }
  if (process.env.ADMIN_PASSWORD && admin.passwordHash) {
    admin.passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    changed = true;
  }
  if (!admin.isAdmin) {
    admin.isAdmin = true;
    changed = true;
  }
  if (!admin.isPaid) {
    admin.isPaid = true;
    changed = true;
  }
  if (changed) writeStore(store);
}

ensureAdminAccount();

connectDB();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.paystack.co'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://paystack.com'],
      styleSrcElem: ["'self'", "'unsafe-inline'", 'https://paystack.com'],
      connectSrc: ["'self'", 'https://api.paystack.co'],
      fontSrc: ["'self'", 'data:'],
      frameSrc: ['https://js.paystack.co', 'https://checkout.paystack.com'],
    },
  },
}));
app.use(compression());
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
}));

app.use(express.static(path.join(__dirname)));

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: Boolean(user.isAdmin),
    },
    process.env.JWT_SECRET || 'ink-dev-secret',
    { expiresIn: '7d' }
  );
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return {
    ...safeUser,
    followersCount: Array.isArray(user.followers) ? user.followers.length : 0,
    followingCount: Array.isArray(user.following) ? user.following.length : 0,
  };
}

function serializeWriting(writing, store = readStore()) {
  const author = store.users.find((user) => user.id === writing.authorId);
  const safeWriting = { ...writing };

  if (author) {
    safeWriting.authorName = author.displayName || author.username;
    safeWriting.authorAvatar = author.avatar || '';
    safeWriting.authorUsername = author.username;
  } else {
    safeWriting.authorName = 'Unknown writer';
    safeWriting.authorAvatar = '';
    safeWriting.authorUsername = 'unknown';
  }

  safeWriting.likesCount = Array.isArray(writing.likes) ? writing.likes.length : 0;
  safeWriting.commentsCount = Array.isArray(writing.comments) ? writing.comments.length : 0;
  return safeWriting;
}

function isAllowedAvatar(value) {
  return /^\.\/Img\/avatar-(sunrise|moss|cobalt|rose)\.svg$/.test(String(value))
    || String(value) === './Img/luma.svg'
    || /^data:image\/(jpeg|jpg|png|webp);base64,/.test(String(value));
}

function getPaystackAmount() {
  return 299;
}

function getPaystackCurrency() {
  return 'USD';
}

function isPaystackTestMode() {
  return String(process.env.PAYSTACK_TEST_MODE || 'true').toLowerCase() === 'true';
}

function getPaystackConfigurationError() {
  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || '');
  const expectsTestKey = isPaystackTestMode();
  if (!secretKey) return 'PAYSTACK_SECRET_KEY is missing.';
  if (expectsTestKey && !secretKey.startsWith('sk_test_')) return 'PAYSTACK_TEST_MODE=true requires a sk_test_ secret key.';
  if (!expectsTestKey && !secretKey.startsWith('sk_live_')) return 'PAYSTACK_TEST_MODE=false requires a sk_live_ secret key.';
  return '';
}

function recordUserActivity(user, activityType = 'writing') {
  if (!user) return null;
  const today = new Date().toISOString().slice(0, 10);
  const streak = user.streak || { goal: 100, current: 0, best: 0, checkIns: [] };
  streak.checkIns = Array.isArray(streak.checkIns) ? streak.checkIns : [];
  streak.activityLog = Array.isArray(streak.activityLog) ? streak.activityLog : [];

  streak.activityLog.push({
    type: activityType,
    date: today,
    timestamp: new Date().toISOString(),
  });

  if (!streak.checkIns.includes(today)) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    streak.current = streak.checkIns.includes(yesterday) ? (streak.current || 0) + 1 : 1;
    streak.best = Math.max(streak.best || 0, streak.current);
    streak.checkIns.push(today);
  }

  user.streak = streak;
  return streak;
}

function buildNotification({ userId, type, message, relatedId = null }) {
  return {
    id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId,
    type,
    message,
    relatedId,
    read: false,
    createdAt: new Date().toISOString(),
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'INKurgic API is live.',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    paystackTestMode: isPaystackTestMode(),
    paystackCurrency: getPaystackCurrency(),
    paystackAmount: getPaystackAmount(),
    clientUrl: process.env.CLIENT_URL || 'http://localhost:5000',
  });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, displayName, email, password } = req.body || {};
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedPassword = typeof password === 'string' ? password : '';

    if (!normalizedUsername || !normalizedDisplayName || !normalizedEmail || !normalizedPassword) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({ message: 'Username must be 3-30 characters using letters, numbers, or underscores.' });
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    if (normalizedPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const store = readStore();
    const exists = store.users.some(
      (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase() || user.email.toLowerCase() === normalizedEmail
    );

    if (exists) {
      return res.status(409).json({ message: 'A user with that username or email already exists.' });
    }

    const newUser = {
      id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      username: normalizedUsername,
      displayName: normalizedDisplayName,
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(normalizedPassword, 10),
      bio: 'New writer on INKurgic.',
      avatar: '',
      isAdmin: false,
      isPaid: false,
      followers: [],
      following: [],
      saved: [],
      createdAt: new Date().toISOString(),
    };

    store.users.push(newUser);
    writeStore(store);

    await sendEmail({
      to: newUser.email,
      subject: 'Welcome to INKurgic',
      text: `Welcome ${newUser.displayName}! Your INKurgic account is ready. Keep writing, keep returning, and let your voice find its readers.`,
    }).catch((error) => console.error('Welcome email error:', error.message));

    const token = generateToken(newUser);
    return res.status(201).json({
      token,
      user: sanitizeUser(newUser),
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Unable to register user right now.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const store = readStore();
    const loginValue = String(username).trim().toLowerCase();
    const user = store.users.find((item) => {
      const legacyAdminEmail = item.isAdmin && loginValue === 'ember@inkurgic.com';
      return item.username.toLowerCase() === loginValue || item.email.toLowerCase() === loginValue || legacyAdminEmail;
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const isValid = await bcrypt.compare(String(password), user.passwordHash || '');
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = generateToken(user);
    await sendEmail({
      to: user.email,
      subject: 'New INKurgic sign-in',
      text: `Hi ${user.displayName || user.username}, your INKurgic account was just signed in to. If this was not you, reset your password immediately.`,
    }).catch((error) => console.error('Login email error:', error.message));
    return res.json({
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Unable to log in right now.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' };
  if (!email) return res.status(400).json({ message: 'Email is required.' });

  const store = readStore();
  const user = store.users.find((item) => item.email.toLowerCase() === email);
  if (!user) return res.json(genericResponse);

  const crypto = require('crypto');
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.passwordReset = {
    tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  writeStore(store);

  const resetUrl = `${CLIENT_URL}/?reset=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: 'Reset your INKurgic password',
    text: `Use this link to reset your password: ${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
  }).catch((error) => console.error('Password reset email error:', error.message));
  return res.json(genericResponse);
});

app.post('/api/auth/reset-password', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!token || password.length < 8) return res.status(400).json({ message: 'A valid token and a password of at least 8 characters are required.' });

  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const store = readStore();
  const user = store.users.find((item) => item.passwordReset?.tokenHash === hash && new Date(item.passwordReset.expiresAt) > new Date());
  if (!user) return res.status(400).json({ message: 'This reset link is invalid or expired.' });

  user.passwordHash = await bcrypt.hash(password, 10);
  delete user.passwordReset;
  writeStore(store);
  await sendEmail({ to: user.email, subject: 'Your INKurgic password changed', text: 'Your INKurgic password was changed successfully.' }).catch((error) => console.error('Password confirmation email error:', error.message));
  return res.json({ message: 'Password reset successfully. You can now log in.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.put('/api/users/me', requireAuth, async (req, res) => {
  const { displayName, bio, avatar } = req.body || {};
  const store = readStore();
  const index = store.users.findIndex((user) => user.id === req.user.id);

  if (index === -1) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (avatar === './Img/luma.svg' && !store.users[index].isPaid && !store.users[index].isAdmin) {
    return res.status(402).json({ message: 'The premium Luma avatar is available after upgrading.' });
  }

  if (avatar !== undefined && avatar !== '' && (!isAllowedAvatar(avatar) || (String(avatar).startsWith('data:') && avatar.length > 1500000))) {
    return res.status(400).json({ message: 'Profile images must be JPEG, PNG, or WebP files smaller than 1 MB.' });
  }

  store.users[index] = {
    ...store.users[index],
    displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : store.users[index].displayName,
    bio: typeof bio === 'string' && bio.trim() ? bio.trim() : store.users[index].bio,
    avatar: avatar !== undefined ? avatar : store.users[index].avatar,
  };

  writeStore(store);
  await sendUserEmail(store.users[index], 'Your INKurgic profile was updated', `Hi ${store.users[index].displayName || store.users[index].username}, your profile details or profile image were updated successfully.`);
  return res.json({ user: sanitizeUser(store.users[index]) });
});

app.get('/api/users', (req, res) => {
  const { q } = req.query;
  const store = readStore();
  const users = store.users.map(sanitizeUser);

  const filtered = q
    ? users.filter((user) => {
      const text = `${user.username} ${user.displayName} ${user.bio}`.toLowerCase();
      return text.includes(String(q).toLowerCase());
    })
    : users;

  return res.json({ users: filtered });
});

app.get('/api/users/:id', (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.params.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.post('/api/users/:id/follow', requireAuth, async (req, res) => {
  const { id } = req.params;
  const store = readStore();
  const currentUser = store.users.find((user) => user.id === req.user.id);
  const targetUser = store.users.find((user) => user.id === id);

  if (!targetUser || !currentUser) {
    return res.status(404).json({ message: 'User not found.' });
  }

  const isFollowing = currentUser.following.includes(id);

  if (isFollowing) {
    currentUser.following = currentUser.following.filter((userId) => userId !== id);
    targetUser.followers = targetUser.followers.filter((userId) => userId !== currentUser.id);
  } else {
    currentUser.following.push(id);
    if (!targetUser.followers.includes(currentUser.id)) targetUser.followers.push(currentUser.id);

    const notification = buildNotification({
      userId: targetUser.id,
      type: 'follow',
      message: `${currentUser.displayName} started following you.`,
      relatedId: currentUser.id,
    });
    store.notifications.unshift(notification);
  }

  writeStore(store);

  if (!isFollowing) {
    await sendUserEmail(targetUser, 'You have a new INKurgic follower', `${currentUser.displayName || currentUser.username} started following you on INKurgic.`);
  }

  return res.json({
    following: currentUser.following.includes(id),
    followersCount: targetUser.followers.length,
    followingCount: currentUser.following.length,
  });
});

app.get('/api/writings', (req, res) => {
  const store = readStore();
  const { q, authorId } = req.query;
  const writings = [...store.writings]
    .filter((post) => post.status !== 'draft')
    .filter((post) => {
      if (!q) return true;
      const haystack = `${post.title} ${post.content} ${post.category} ${(post.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(String(q).toLowerCase());
    })
    .filter((post) => (!authorId ? true : post.authorId === authorId))
    .sort((a, b) => {
      const following = req.user?.following || [];
      const aPriority = following.includes(a.authorId) ? 1 : 0;
      const bPriority = following.includes(b.authorId) ? 1 : 0;
      return bPriority - aPriority || new Date(b.createdAt) - new Date(a.createdAt);
    })
    .map((post) => serializeWriting(post, store));

  return res.json({ writings });
});

app.get('/api/writings/mine', requireAuth, (req, res) => {
  const store = readStore();
  const writings = store.writings
    .filter((post) => post.authorId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((post) => serializeWriting(post, store));
  return res.json({ writings });
});

app.get('/api/writings/:id', (req, res) => {
  const store = readStore();
  const writing = store.writings.find((post) => post.id === req.params.id);

  if (!writing) {
    return res.status(404).json({ message: 'Writing not found.' });
  }

  return res.json({ writing: serializeWriting(writing, store) });
});

app.post('/api/writings', requireAuth, async (req, res) => {
  try {
    const { title, content, category = 'poetry', tags = [], image = '', status = 'published' } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required.' });
    }

    if (image && (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(String(image)) || String(image).length > 1500000)) {
      return res.status(400).json({ message: 'Writing images must be JPEG, PNG, or WebP files smaller than 1 MB.' });
    }

    const store = readStore();
    const author = store.users.find((user) => user.id === req.user.id);
    const imageCount = store.writings.filter((writing) => writing.authorId === req.user.id && writing.image).length;
    if (image && author && !author.isPaid && !author.isAdmin && imageCount >= 3) {
      return res.status(402).json({ message: 'Free writers can attach images to 3 writings. Unlock premium for unlimited image uploads.' });
    }
    const writing = {
      id: `writing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      authorId: req.user.id,
      title: String(title).trim(),
      content: String(content),
      category: String(category).trim() || 'poetry',
      tags: Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      image: String(image || ''),
      status: status === 'draft' ? 'draft' : 'published',
      likes: [],
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.writings.unshift(writing);
    if (author) recordUserActivity(author, writing.status === 'draft' ? 'saved_draft' : 'published_poem');
    writeStore(store);
    await sendUserEmail(author, writing.status === 'draft' ? 'Your INKurgic draft was saved' : 'Your writing is live on INKurgic', `Your writing "${writing.title}" was ${writing.status === 'draft' ? 'saved as a draft' : 'published'} successfully.`);
    return res.status(201).json({ writing });
  } catch (error) {
    console.error('Create writing error:', error);
    return res.status(500).json({ message: 'Unable to create writing right now.' });
  }
});

app.put('/api/writings/:id', requireAuth, async (req, res) => {
  const store = readStore();
  const writing = store.writings.find((post) => post.id === req.params.id);

  if (!writing) {
    return res.status(404).json({ message: 'Writing not found.' });
  }

  if (writing.authorId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ message: 'You can only edit your own writing.' });
  }

  const { title, content, category, tags, image, status } = req.body || {};
  writing.title = title || writing.title;
  writing.content = content || writing.content;
  writing.category = category || writing.category;
  writing.tags = tags || writing.tags;
  const nextImage = image !== undefined ? image : writing.image;
  if (nextImage && (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(String(nextImage)) || String(nextImage).length > 1500000)) {
    return res.status(400).json({ message: 'Writing images must be JPEG, PNG, or WebP files smaller than 1 MB.' });
  }
  writing.image = nextImage;
  writing.status = status || writing.status;
  writing.updatedAt = new Date().toISOString();

  const author = store.users.find((user) => user.id === writing.authorId);
  if (author) recordUserActivity(author, 'updated_writing');
  writeStore(store);
  await sendUserEmail(author, 'Your INKurgic writing was updated', `Your writing "${writing.title}" was updated successfully.`);
  return res.json({ writing });
});

app.delete('/api/writings/:id', requireAuth, async (req, res) => {
  const store = readStore();
  const writingIndex = store.writings.findIndex((post) => post.id === req.params.id);

  if (writingIndex === -1) {
    return res.status(404).json({ message: 'Writing not found.' });
  }

  const writing = store.writings[writingIndex];
  if (writing.authorId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ message: 'You can only delete your own writing.' });
  }

  store.writings.splice(writingIndex, 1);
  writeStore(store);
  const author = store.users.find((user) => user.id === writing.authorId);
  await sendUserEmail(author, 'Your INKurgic writing was deleted', `Your writing "${writing.title}" was deleted from INKurgic.`);
  return res.json({ message: 'Writing deleted successfully.' });
});

app.post('/api/writings/:id/like', requireAuth, async (req, res) => {
  const store = readStore();
  const writing = store.writings.find((post) => post.id === req.params.id);

  if (!writing) {
    return res.status(404).json({ message: 'Writing not found.' });
  }

  const hasLiked = writing.likes.includes(req.user.id);

  if (hasLiked) {
    writing.likes = writing.likes.filter((userId) => userId !== req.user.id);
  } else {
    writing.likes.push(req.user.id);

    const author = store.users.find((user) => user.id === writing.authorId);
    if (author && author.id !== req.user.id) {
      const notification = buildNotification({
        userId: author.id,
        type: 'like',
        message: `${req.user.username} liked your writing.`,
        relatedId: writing.id,
      });
      store.notifications.unshift(notification);
      await sendUserEmail(author, 'Someone liked your INKurgic writing', notification.message);
    }
  }

  const currentUser = store.users.find((user) => user.id === req.user.id);
  if (currentUser) recordUserActivity(currentUser, 'like');
  writeStore(store);
  return res.json({ likes: writing.likes.length, liked: !hasLiked });
});

app.post('/api/writings/:id/comment', requireAuth, async (req, res) => {
  const { text } = req.body || {};
  const store = readStore();
  const writing = store.writings.find((post) => post.id === req.params.id);

  if (!writing) {
    return res.status(404).json({ message: 'Writing not found.' });
  }

  if (!text || !String(text).trim()) {
    return res.status(400).json({ message: 'Comment text is required.' });
  }

  const author = store.users.find((user) => user.id === req.user.id);
  const comment = {
    id: `comment-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    authorId: req.user.id,
    authorName: author ? author.displayName : req.user.username,
    text: String(text).trim(),
    createdAt: new Date().toISOString(),
  };

  writing.comments.push(comment);
  if (author) recordUserActivity(author, 'comment');

  const targetAuthor = store.users.find((user) => user.id === writing.authorId);
  if (targetAuthor && targetAuthor.id !== req.user.id) {
    const notification = buildNotification({
      userId: targetAuthor.id,
      type: 'comment',
      message: `${author ? author.displayName : req.user.username} commented on your writing.`,
      relatedId: writing.id,
    });
    store.notifications.unshift(notification);
    await sendUserEmail(targetAuthor, 'Someone commented on your INKurgic writing', notification.message);
  }

  writeStore(store);
  return res.status(201).json({ comment });
});

app.post('/api/writings/:id/save', requireAuth, (req, res) => {
  const store = readStore();
  const currentUser = store.users.find((user) => user.id === req.user.id);
  const hasSaved = currentUser.saved.includes(req.params.id);

  if (hasSaved) {
    currentUser.saved = currentUser.saved.filter((writingId) => writingId !== req.params.id);
  } else {
    currentUser.saved.push(req.params.id);
  }

  writeStore(store);
  return res.json({ saved: !hasSaved, savedCount: currentUser.saved.length });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const store = readStore();
  const notifications = store.notifications.filter((note) => note.userId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json({ notifications });
});

app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
  const store = readStore();
  const notification = store.notifications.find((note) => note.id === req.params.id && note.userId === req.user.id);

  if (!notification) {
    return res.status(404).json({ message: 'Notification not found.' });
  }

  notification.read = true;
  writeStore(store);
  return res.json({ notification });
});

app.get('/api/support/messages', requireAuth, (req, res) => {
  const store = readStore();
  const messages = (store.supportMessages || [])
    .filter((message) => message.userId === req.user.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return res.json({ messages });
});

app.post('/api/support/messages', requireAuth, (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ message: 'Support message cannot be empty.' });
  }

  const store = readStore();
  store.supportMessages = store.supportMessages || [];
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User account not found.' });
  const message = {
    id: `support-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: user.id,
    email: user.email,
    displayName: user.displayName || user.username,
    senderType: 'user',
    senderName: user.displayName || user.username,
    from: 'You',
    priority: Boolean(user.isPaid || user.isAdmin),
    text: text.slice(0, 500),
    status: 'unread',
    createdAt: new Date().toISOString(),
  };
  store.supportMessages.push(message);
  writeStore(store);
  return res.status(201).json({ message });
});

app.post('/api/support/survey', requireAuth, (req, res) => {
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim().slice(0, 80) : '';
  if (!answer) return res.status(400).json({ message: 'Survey response is required.' });
  const store = readStore();
  store.supportSurveys = Array.isArray(store.supportSurveys) ? store.supportSurveys : [];
  store.supportSurveys.push({ id: `survey-${Date.now()}`, userId: req.user.id, answer, createdAt: new Date().toISOString() });
  writeStore(store);
  return res.status(201).json({ message: 'Thanks. Luma will use that to route your support.' });
});

app.post('/api/feedback', requireAuth, (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const category = typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 40) : 'General';
  if (!message) return res.status(400).json({ message: 'Feedback cannot be empty.' });
  if (message.length > 2000) return res.status(400).json({ message: 'Feedback must be 2000 characters or fewer.' });

  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User account not found.' });
  const feedback = {
    id: `feedback-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: req.user.id,
    email: user?.email || '',
    displayName: user?.displayName || user?.username || 'Writer',
    message: message.slice(0, 2000),
    category,
    status: 'unread',
    createdAt: new Date().toISOString(),
  };
  store.feedback.unshift(feedback);
  writeStore(store);
  return res.status(201).json({ feedback });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const writings = store.writings || [];
  const supportMessages = store.supportMessages || [];
  const feedbackList = store.feedback || [];
  const activeStreaks = store.users.filter((user) => Number(user.streak?.current) > 0).length;
  const subscriptions = (store.subscriptions || []).map((sub) => {
    const subscriber = store.users.find((u) => u.id === sub.userId);
    return {
      ...sub,
      userName: sub.userName || subscriber?.displayName || subscriber?.username || 'Writer',
      email: sub.email || subscriber?.email || '',
      approved: sub.approved !== undefined ? sub.approved : Boolean(sub.active),
    };
  });
  return res.json({
    stats: {
      users: store.users.length,
      paidUsers: store.users.filter((user) => user.isPaid).length,
      writings: writings.filter((writing) => writing.status !== 'draft').length,
      notifications: store.notifications.length,
      followers: store.users.reduce((sum, user) => sum + (user.followers || []).length, 0),
      drafts: writings.filter((writing) => writing.status === 'draft').length,
      supportMessages: supportMessages.length,
      feedback: feedbackList.length,
      unreadFeedback: feedbackList.filter((item) => item.status !== 'read').length,
      activeStreaks,
      admins: store.users.filter((user) => user.isAdmin).length,
      subscriptionsCount: subscriptions.length,
    },
    users: store.users.map(sanitizeUser),
    writings,
    notifications: store.notifications,
    subscriptions,
    feedback: feedbackList,
  });
});

app.get('/api/admin/support/messages', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  return res.json({ messages: (store.supportMessages || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) });
});

app.get('/api/admin/feedback', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  return res.json({ feedback: store.feedback.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

app.patch('/api/admin/feedback/:id/read', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const item = store.feedback.find((feedback) => feedback.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Feedback not found.' });
  item.status = 'read';
  writeStore(store);
  return res.json({ feedback: item });
});

app.post('/api/admin/support/messages', requireAuth, requireAdmin, (req, res) => {
  const { userId, text } = req.body || {};
  const messageText = typeof text === 'string' ? text.trim() : '';
  const user = readStore().users.find((item) => item.id === userId);

  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (!messageText) return res.status(400).json({ message: 'Reply cannot be empty.' });

  const store = readStore();
  store.supportMessages = store.supportMessages || [];
  const message = {
    id: `support-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: user.id,
    email: user.email,
    displayName: user.displayName || user.username,
    senderType: 'admin',
    senderName: SUPPORT_NAME,
    from: SUPPORT_NAME,
    priority: true,
    text: messageText.slice(0, 500),
    status: 'read',
    createdAt: new Date().toISOString(),
  };
  store.supportMessages.push(message);

  // Mark all previous messages in this conversation as read
  store.supportMessages.forEach((item) => {
    if (item.userId === userId) {
      item.status = 'read';
    }
  });

  writeStore(store);
  store.notifications = store.notifications || [];
  store.notifications.unshift(buildNotification({
    userId,
    type: 'support',
    message: `${SUPPORT_NAME} replied to your support conversation.`,
    relatedId: message.id,
  }));
  writeStore(store);
  sendEmail({
    to: user.email,
    subject: `A new message from ${SUPPORT_NAME} at INKurgic`,
    text: `${SUPPORT_NAME} replied to your support conversation:\n\n${message.text}`,
  }).catch((error) => console.error('Support reply email error:', error.message));
  return res.status(201).json({ message });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  return res.json({ users: store.users.map(sanitizeUser) });
});

app.patch('/api/admin/users/:id/pay', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.params.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  user.isPaid = !user.isPaid;
  writeStore(store);
  return res.json({ user: sanitizeUser(user) });
});

app.patch('/api/admin/users/:id/admin', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.params.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  user.isAdmin = !user.isAdmin;
  if (user.isAdmin) user.isPaid = true;
  writeStore(store);
  return res.json({ user: sanitizeUser(user) });
});

app.post('/api/admin/promote', requireAuth, requireAdmin, (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }

  const store = readStore();
  const user = store.users.find((item) => item.email.toLowerCase() === email);
  if (!user) return res.status(404).json({ message: 'No registered user found with that email.' });

  user.isAdmin = true;
  user.isPaid = true;
  writeStore(store);
  sendEmail({
    to: user.email,
    subject: 'You are now an INKurgic administrator',
    text: `Your INKurgic account has been granted administrator access. Sign in again to open the Admin Control Center.`,
  }).catch((error) => console.error('Admin promotion email error:', error.message));
  return res.json({ message: `${user.displayName || user.username} is now an administrator.`, user: sanitizeUser(user) });
});

app.get('/api/prompts', (req, res) => {
  const store = readStore();
  const prompts = store.prompts.slice();
  const offset = Math.floor(Date.now() / 86400000) % prompts.length;
  const rotated = prompts.slice(offset).concat(prompts.slice(0, offset));
  return res.json({ prompts: rotated.map((prompt) => prompt.text), promptData: rotated });
});

app.get('/api/streak', requireAuth, (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const today = new Date().toISOString().slice(0, 10);
  const streak = user.streak || { goal: 100, current: 0, best: 0, checkIns: [] };
  streak.checkIns = Array.isArray(streak.checkIns) ? streak.checkIns : [];

  const wroteToday = (store.writings || []).some(
    (w) => w.authorId === user.id && (String(w.createdAt).slice(0, 10) === today || String(w.updatedAt).slice(0, 10) === today)
  );
  if (wroteToday && !streak.checkIns.includes(today)) {
    recordUserActivity(user, 'writing');
    writeStore(store);
  }

  const activeToday = (user.streak?.checkIns || []).includes(today);
  return res.json({
    streak: {
      ...(user.streak || streak),
      activeToday,
    },
  });
});

app.post('/api/streak/check-in', requireAuth, async (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const today = new Date().toISOString().slice(0, 10);
  const alreadyCheckedIn = (user.streak?.checkIns || []).includes(today);
  const streak = recordUserActivity(user, 'practice');
  writeStore(store);
  await sendUserEmail(user, 'Your INKurgic streak was updated', `You checked in today and reached a ${streak.current}-day writing streak.`);
  return res.json({ streak: { ...streak, activeToday: true }, alreadyCheckedIn });
});

app.patch('/api/streak', requireAuth, async (req, res) => {
  const goal = Number(req.body?.goal);
  if (!Number.isInteger(goal) || goal < 1 || goal > 365) return res.status(400).json({ message: 'Choose a goal between 1 and 365 days.' });
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  user.streak = { ...(user.streak || { current: 0, best: 0, checkIns: [] }), goal };
  writeStore(store);
  await sendUserEmail(user, 'Your INKurgic writing goal changed', `Your writing streak goal is now ${goal} days.`);
  return res.json({ streak: user.streak });
});

app.post('/api/payments/initialize', requireAuth, async (req, res) => {
  const user = readStore().users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.isPaid || user.isAdmin) return res.status(409).json({ message: 'Premium access is already active.' });
  const paystackConfigurationError = getPaystackConfigurationError();
  if (paystackConfigurationError) {
    console.error(`Paystack configuration error: ${paystackConfigurationError}`);
    return res.status(503).json({ message: 'Premium checkout is not configured correctly. Please contact support.' });
  }

  const reference = `ink-${user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const amount = getPaystackAmount();
  const currency = getPaystackCurrency();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const paystackFetch = module.exports.paystackFetch || fetch;
    const response = await paystackFetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        amount,
        currency,
        reference,
        callback_url: `${CLIENT_URL}/?payment=return`,
        metadata: { userId: user.id, planId: 'go-pro' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== true || !result.data?.authorization_url) {
      console.error('Paystack initialization failed:', result.message || `HTTP ${response.status}`, result);
      const providerMessage = String(result.message || '').toLowerCase();
      const userMessage = providerMessage.includes('currency not supported')
        ? 'Paystack is not enabled to accept USD on this merchant account. Enable USD for the Paystack account, then try again.'
        : result.message
          ? `Paystack: ${result.message}`
          : 'Paystack could not initialize this payment.';
      return res.status(providerMessage.includes('currency not supported') ? 503 : 502).json({ message: userMessage });
    }
    return res.json({ authorizationUrl: result.data.authorization_url, reference: result.data.reference });
  } catch (error) {
    console.error('Paystack initialize error:', error);
    return res.status(error.name === 'AbortError' ? 504 : 502).json({ message: 'Unable to connect to Paystack right now.' });
  }
});

app.post('/api/subscribe', requireAuth, async (req, res) => {
  const { planId = 'go-pro', reference } = req.body || {};
  const store = readStore();
  store.subscriptions = Array.isArray(store.subscriptions) ? store.subscriptions : [];
  const user = store.users.find((item) => item.id === req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (user.isAdmin) {
    user.isPaid = true;
    writeStore(store);
    return res.json({ message: 'Administrator premium access is already active.', user: sanitizeUser(user) });
  }

  if (!reference || !process.env.PAYSTACK_SECRET_KEY) {
    return res.status(400).json({ message: 'A verified Paystack transaction is required.' });
  }

  if ((store.subscriptions || []).some((subscription) => subscription.reference === String(reference))) {
    return res.status(409).json({ message: 'This Paystack transaction has already been used.' });
  }

  try {
    const verificationController = new AbortController();
    const verificationTimeout = setTimeout(() => verificationController.abort(), 10000);
    const paystackFetch = module.exports.paystackFetch || fetch;
    const verification = await paystackFetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      signal: verificationController.signal,
    });
    clearTimeout(verificationTimeout);
    const result = await verification.json().catch(() => ({}));
    const expectedAmount = getPaystackAmount();
    const expectedCurrency = getPaystackCurrency();
    if (!verification.ok || result.status !== true || result.data?.status !== 'success' || result.data?.customer?.email?.toLowerCase() !== user.email.toLowerCase() || Number(result.data?.amount) !== expectedAmount || String(result.data?.currency).toUpperCase() !== expectedCurrency) {
      return res.status(402).json({ message: 'Payment could not be verified for this account.' });
    }
  } catch (error) {
    console.error('Paystack verification error:', error.message);
    return res.status(504).json({ message: 'Payment verification took too long. Please try again; your payment reference remains safe to verify.' });
  }

  user.isPaid = true;
  store.subscriptions.push({
    id: `sub-${Date.now()}`,
    userId: user.id,
    userName: user.displayName || user.username,
    email: user.email,
    planId,
    amount: getPaystackAmount(),
    currency: getPaystackCurrency(),
    active: true,
    approved: true,
    reference: String(reference),
    createdAt: new Date().toISOString(),
  });

  writeStore(store);
  return res.json({ message: 'Subscription activated.', user: sanitizeUser(user) });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  return res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer() {
  return app.listen(PORT, '0.0.0.0', () => {
    console.log(`INKurgic server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, paystackFetch: null };
