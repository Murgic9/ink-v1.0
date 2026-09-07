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
  prompts: [
    { id: 'prompt-poetry-1', category: 'Poetry', text: 'Write about a room that remembers your name.' },
    { id: 'prompt-poetry-2', category: 'Poetry', text: 'Write a poem about a hope that sounds like rain.' },
    { id: 'prompt-storytelling-1', category: 'Storytelling', text: 'A forgotten object begins speaking in a crowded train.' },
    { id: 'prompt-storytelling-2', category: 'Storytelling', text: 'Describe a goodbye that happens without anyone leaving.' },
    { id: 'prompt-reflection-1', category: 'Personal reflection', text: 'Write a letter to a version of yourself that has changed.' },
    { id: 'prompt-reflection-2', category: 'Personal reflection', text: 'Describe the smallest choice that changed your direction.' },
    { id: 'prompt-relationships-1', category: 'Relationships', text: 'Let two strangers recognize each other through one sentence.' },
    { id: 'prompt-relationships-2', category: 'Relationships', text: 'Write about a promise kept long after the people who made it forgot.' },
    { id: 'prompt-imagination-1', category: 'Imagination', text: 'Describe a city that only appears after midnight.' },
    { id: 'prompt-imagination-2', category: 'Imagination', text: 'A garden grows from the place where a secret was buried.' },
    { id: 'prompt-fiction-1', category: 'Fiction', text: 'Write about the last page of a book no one else has read.' },
    { id: 'prompt-fiction-2', category: 'Fiction', text: 'A melody from your childhood returns with a different ending.' },
    { id: 'prompt-character-1', category: 'Character development', text: 'Write from the perspective of a key that opens no door.' },
    { id: 'prompt-character-2', category: 'Character development', text: 'Give your character one kindness they cannot explain.' },
    { id: 'prompt-world-1', category: 'World-building', text: 'Invent a festival held for something your world has lost.' },
    { id: 'prompt-world-2', category: 'World-building', text: 'Describe the rule every child learns before they can read.' },
    { id: 'prompt-creativity-1', category: 'Creativity', text: 'Turn an ordinary grocery list into a confession.' },
    { id: 'prompt-creativity-2', category: 'Creativity', text: 'Write a scene using only questions and gestures.' },
    { id: 'prompt-short-1', category: 'Short-form writing', text: 'Tell an entire friendship in exactly six sentences.' },
    { id: 'prompt-short-2', category: 'Short-form writing', text: 'Write a 50-word story that ends with an unlocked door.' },
  ],
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
    const data = JSON.parse(raw);
    const defaults = ['users', 'writings', 'notifications', 'subscriptions', 'reports', 'feedback', 'prompts'];
    defaults.forEach((key) => {
      if (!Array.isArray(data[key])) data[key] = JSON.parse(JSON.stringify(seedData[key]));
    });
    return data;
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
