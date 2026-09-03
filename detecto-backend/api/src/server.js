import { app } from './app.js';
import { config } from './config.js';

const listenCb = () => {
  const host = config.listenHost ?? 'localhost';
  console.log(`detecto-api listening on http://${host}:${config.port}`);
};

if (config.listenHost) {
  app.listen(config.port, config.listenHost, listenCb);
} else {
  app.listen(config.port, listenCb);
}
