module.exports = {
  apps: [{ name: 'shiptrack-worker', script: 'src/index.js', instances: 1, env: { NODE_ENV: 'production' } }],
};
