const fs = require('fs');
const path = require('path');

let dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : __dirname;
let dataFile = path.join(dataDir, 'app-data.json');
let usingFallback = false;
let mongoSynced = false;

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
  writings: [],
  notifications: [],
  subscriptions: [],
  reports: [],
  feedback: [],
  supportMessages: [],
  supportSurveys: [],
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
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, JSON.stringify(seedData, null, 2), 'utf8');
    }
  } catch (error) {
    if (usingFallback || !['EACCES', 'EROFS', 'ENOSPC'].includes(error.code)) throw error;

    dataDir = path.join(require('os').tmpdir(), 'inkurgic-data');
    dataFile = path.join(dataDir, 'app-data.json');
    usingFallback = true;
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, JSON.stringify(seedData, null, 2), 'utf8');
    }
    console.warn(`Data directory is not writable; using temporary storage at ${dataDir}.`);
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const data = JSON.parse(raw);
    const defaults = ['users', 'writings', 'notifications', 'subscriptions', 'reports', 'feedback', 'supportMessages', 'supportSurveys', 'prompts'];
    defaults.forEach((key) => {
      if (!Array.isArray(data[key])) data[key] = JSON.parse(JSON.stringify(seedData[key]));
    });
    return data;
  } catch (error) {
    return JSON.parse(JSON.stringify(seedData));
  }
}

let mongooseInstance = null;
let AppDataModel = null;

function initMongoSync(mongoose) {
  try {
    mongooseInstance = mongoose;
    if (!mongooseInstance) return;
    if (!AppDataModel) {
      const schema = new mongooseInstance.Schema({
        key: { type: String, unique: true },
        data: mongooseInstance.Schema.Types.Mixed,
      }, { timestamps: true });
      AppDataModel = mongooseInstance.models.AppDataStore || mongooseInstance.model('AppDataStore', schema);
    }
    AppDataModel.findOne({ key: 'inkurgic_data' }).then((doc) => {
      if (doc && doc.data) {
        const current = readStore();
        const merged = { ...current, ...doc.data };
        writeStore(merged, false);
      } else {
        const current = readStore();
        AppDataModel.create({ key: 'inkurgic_data', data: current }).catch(() => {});
      }
    }).catch((err) => {
      console.warn('MongoDB store sync warning:', err.message);
    });
  } catch (err) {
    console.warn('MongoDB store init error:', err.message);
  }
}

function writeStore(data, syncToMongo = true) {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
  if (syncToMongo && AppDataModel && mongooseInstance && mongooseInstance.connection?.readyState === 1) {
    AppDataModel.updateOne({ key: 'inkurgic_data' }, { data }, { upsert: true }).catch(() => {});
  }
  return data;
}

module.exports = { readStore, writeStore, seedData, initMongoSync };
