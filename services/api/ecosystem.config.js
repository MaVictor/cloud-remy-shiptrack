module.exports = {
  apps: [
    {
      name: 'shiptrack-api',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production' },
    },
  ],
};
