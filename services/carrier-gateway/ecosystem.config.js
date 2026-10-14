module.exports = {
  apps: [{ name: 'shiptrack-carrier-gateway', script: 'src/server.js', instances: 2, exec_mode: 'cluster', env: { NODE_ENV: 'production' } }],
};
