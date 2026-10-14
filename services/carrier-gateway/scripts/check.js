process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { createApp } = require('../src/app');
if (typeof createApp() !== 'function') throw new Error('createApp did not return an express app');
console.log('build ok');
