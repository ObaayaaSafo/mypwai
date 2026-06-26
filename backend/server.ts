import { loadEnv } from './env.js';

loadEnv();
const { default: app } = await import('./app.js');

const PORT = process.env.PORT || 4007;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
