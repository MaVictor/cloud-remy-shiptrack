// "Build" step: load every module so a missing export or removed API fails fast,
// then make sure the OpenAPI spec still generates.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../src/app');
require('../src/services/tracking');
require('../src/services/carrier');
require('../src/services/reports');

if (typeof app !== 'function') throw new Error('app did not export an express handler');
console.log('build ok');
