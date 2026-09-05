const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

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

  if (!process.env.DATA_DIR) {
    throw new Error('DATA_DIR must point to a persistent Render disk in production.');
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

function ensureAdminAccount() {
  const store = readStore();
  const admin = store.users.find((user) => user.isAdmin) || store.users[0];
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
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
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
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_your_public_key_here',
    paystackTestMode: String(process.env.PAYSTACK_TEST_MODE || 'true').toLowerCase() === 'true',
    paystackCurrency: String(process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase(),
    paystackAmount: Number(process.env.PAYSTACK_AMOUNT || 299),
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

app.put('/api/users/me', requireAuth, (req, res) => {
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

app.post('/api/users/:id/follow', requireAuth, (req, res) => {
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

app.post('/api/writings', requireAuth, (req, res) => {
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
    writeStore(store);
    return res.status(201).json({ writing });
  } catch (error) {
    console.error('Create writing error:', error);
    return res.status(500).json({ message: 'Unable to create writing right now.' });
  }
});

app.put('/api/writings/:id', requireAuth, (req, res) => {
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

  writeStore(store);
  return res.json({ writing });
});

app.delete('/api/writings/:id', requireAuth, (req, res) => {
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
  return res.json({ message: 'Writing deleted successfully.' });
});

app.post('/api/writings/:id/like', requireAuth, (req, res) => {
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
      store.notifications.unshift(
        buildNotification({
          userId: author.id,
          type: 'like',
          message: `${req.user.username} liked your writing.`,
          relatedId: writing.id,
        })
      );
    }
  }

  writeStore(store);
  return res.json({ likes: writing.likes.length, liked: !hasLiked });
});

app.post('/api/writings/:id/comment', requireAuth, (req, res) => {
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

  const targetAuthor = store.users.find((user) => user.id === writing.authorId);
  if (targetAuthor && targetAuthor.id !== req.user.id) {
    store.notifications.unshift(
      buildNotification({
        userId: targetAuthor.id,
        type: 'comment',
        message: `${author ? author.displayName : req.user.username} commented on your writing.`,
        relatedId: writing.id,
      })
    );
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
  const message = {
    id: `support-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    userId: req.user.id,
    from: 'You',
    priority: Boolean(store.users.find((user) => user.id === req.user.id)?.isPaid),
    text: text.slice(0, 240),
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

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  const writings = store.writings || [];
  const supportMessages = store.supportMessages || [];
  const activeStreaks = store.users.filter((user) => Number(user.streak?.current) > 0).length;
  return res.json({
    stats: {
      users: store.users.length,
      paidUsers: store.users.filter((user) => user.isPaid).length,
      writings: writings.length,
      notifications: store.notifications.length,
      followers: store.users.reduce((sum, user) => sum + (user.followers || []).length, 0),
      drafts: writings.filter((writing) => writing.status === 'draft').length,
      supportMessages: supportMessages.length,
      activeStreaks,
      admins: store.users.filter((user) => user.isAdmin).length,
    },
    users: store.users.map(sanitizeUser),
    writings,
    notifications: store.notifications,
    subscriptions: store.subscriptions || [],
  });
});

app.get('/api/admin/support/messages', requireAuth, requireAdmin, (req, res) => {
  const store = readStore();
  return res.json({ messages: (store.supportMessages || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) });
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
    userId,
    from: SUPPORT_NAME,
    priority: true,
    text: messageText.slice(0, 240),
    createdAt: new Date().toISOString(),
  };
  store.supportMessages.push(message);
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
  const prompts = [
    'Write about a room that remembers your name.',
    'Describe a city that only appears after midnight.',
    'Write a letter to a version of yourself that has changed.',
    'A forgotten object begins speaking in a crowded train.',
    'Write a poem about a hope that sounds like rain.',
    'Write about the last page of a book no one else has read.',
    'A melody from your childhood returns with a different ending.',
    'Write from the perspective of a key that opens no door.',
    'Describe a goodbye that happens without anyone leaving.',
    'Let two strangers recognize each other through one sentence.',
    'Write about a promise made to the future at 3 a.m.',
    'A garden grows from the place where a secret was buried.',
  ];
  const day = Math.floor(Date.now() / 86400000);
  const offset = day % prompts.length;
  return res.json({ prompts: prompts.slice(offset).concat(prompts.slice(0, offset)) });
});

app.get('/api/streak', requireAuth, (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  return res.json({ streak: user.streak || { goal: 100, current: 0, best: 0, checkIns: [] } });
});

app.post('/api/streak/check-in', requireAuth, (req, res) => {
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const today = new Date().toISOString().slice(0, 10);
  const streak = user.streak || { goal: 100, current: 0, best: 0, checkIns: [] };
  streak.checkIns = Array.isArray(streak.checkIns) ? streak.checkIns : [];
  if (streak.checkIns.includes(today)) return res.json({ streak, alreadyCheckedIn: true });

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  streak.current = streak.checkIns.includes(yesterday) ? streak.current + 1 : 1;
  streak.best = Math.max(streak.best || 0, streak.current);
  streak.checkIns.push(today);
  user.streak = streak;
  writeStore(store);
  return res.json({ streak, alreadyCheckedIn: false });
});

app.patch('/api/streak', requireAuth, (req, res) => {
  const goal = Number(req.body?.goal);
  if (!Number.isInteger(goal) || goal < 1 || goal > 365) return res.status(400).json({ message: 'Choose a goal between 1 and 365 days.' });
  const store = readStore();
  const user = store.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  user.streak = { ...(user.streak || { current: 0, best: 0, checkIns: [] }), goal };
  writeStore(store);
  return res.json({ streak: user.streak });
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
    const verification = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const result = await verification.json();
    const expectedAmount = Number(process.env.PAYSTACK_AMOUNT || 299);
    const expectedCurrency = String(process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase();
    if (!verification.ok || result.status !== true || result.data?.status !== 'success' || result.data?.customer?.email?.toLowerCase() !== user.email.toLowerCase() || Number(result.data?.amount) !== expectedAmount || String(result.data?.currency).toUpperCase() !== expectedCurrency) {
      return res.status(402).json({ message: 'Payment could not be verified for this account.' });
    }
  } catch (error) {
    console.error('Paystack verification error:', error.message);
    return res.status(502).json({ message: 'Payment verification is temporarily unavailable.' });
  }

  user.isPaid = true;
  store.subscriptions.push({
    id: `sub-${Date.now()}`,
    userId: user.id,
    planId,
    active: true,
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

module.exports = { app, startServer };
