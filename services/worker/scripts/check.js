process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const jobs = require('../src/jobs');
require('../src/health');
require('../src/scheduler');
for (const job of jobs) {
  if (typeof job.run !== 'function' || !job.name) throw new Error('malformed job module');
}
console.log(`build ok (${jobs.length} jobs)`);
