const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const dataFile = path.join(dataDir, 'app-data.json');

const seedData = {
  users: [
    {
      id: 'user-admin',
      username: 'ember',
      displayName: 'Ember',
      email: 'inkurgic@gmail.com',
      passwordHash: '$2a$10$MhmQjSIw5Q0ZyB9s9myukusA7K0FtMN0DqtBO9t8DuGBBRQzQnE4y',
      bio: 'Poet, editor, and steward of creative sparks.',
      avatar: '',
      isAdmin: true,
      isPaid: true,
      followers: [],
      following: [],
      saved: [],
      createdAt: new Date().toISOString(),
    },
  ],
  writings: [
    {
      id: 'writing-demo-1',
      authorId: 'user-admin',
      title: 'Night Lanterns',
      content: 'The city keeps its breath beneath rain-slick windows, and every window learns the shape of longing.',
      category: 'poetry',
      tags: ['night', 'city', 'poetry'],
      image: '',
      status: 'published',
      likes: [],
      comments: [
        {
          id: 'comment-demo-1',
          authorId: 'user-admin',
          authorName: 'Ember',
          text: 'This one feels warm and alive.',
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'writing-demo-2',
      authorId: 'user-admin',
      title: 'The Quiet Margin',
      content: 'I keep my best sentences for the pauses between the bells, where silence becomes an honest witness.',
      category: 'prose',
      tags: ['reflection', 'silence'],
      image: '',
      status: 'published',
      likes: [],
      comments: [],
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ],
  notifications: [],
  subscriptions: [],
  reports: [],
  feedback: [],
};

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(seedData, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return JSON.parse(JSON.stringify(seedData));
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

module.exports = { readStore, writeStore, seedData };
