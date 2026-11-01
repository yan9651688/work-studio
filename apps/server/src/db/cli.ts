import { config } from '../config.js';
import { openDb } from './index.js';
import { seed } from './seed.js';
const cfg = config();
const db = openDb(cfg.dataDir);
if (process.argv[2] === 'seed') await seed(db, cfg);
db.sql.close();
console.log('Database ready.');
