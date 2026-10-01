import { createServer } from 'node:http';
import handle, { positions } from './lib/app.js';

const PORT = Number(process.env.PORT) || 3000;

createServer(handle).listen(PORT, () => {
  console.log(`Interview Prep on http://localhost:${PORT} (${positions.length} positions, mock LLM: ${process.env.MOCK_LLM === '1'})`);
});
