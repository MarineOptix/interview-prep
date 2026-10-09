import { createServer } from 'node:http';
import handle, { positions } from './lib/app.js';
import { startDailyBackup } from './lib/backup.js';
import { dbFile } from './lib/db.js';

const PORT = Number(process.env.PORT) || 3000;

// Opens the database of access codes and keeps a daily copy of it. The written plan works without it.
if (startDailyBackup()) console.log(`Database: ${dbFile()}`);

createServer(handle).listen(PORT, () => {
  console.log(`Interview Prep on http://localhost:${PORT} (${positions.length} positions, mock LLM: ${process.env.MOCK_LLM === '1'})`);
});
