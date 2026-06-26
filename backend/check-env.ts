import { loadEnv } from './env.js';
loadEnv();
console.log('PORT:', process.env.PORT);
console.log('DB_HOST:', process.env.DB_HOST);
