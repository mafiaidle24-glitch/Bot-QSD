require('dotenv').config();

const bot = require('./bot');
const { startWeb } = require('./web');

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

bot
  .start()
  .then(() => startWeb(bot))
  .catch((e) => {
    console.error('Falha ao iniciar:', e.message);
    process.exit(1);
  });
