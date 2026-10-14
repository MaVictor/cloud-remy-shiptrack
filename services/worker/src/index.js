const minimist = require('minimist');
const mongoose = require('mongoose');
const config = require('./config');
const jobs = require('./jobs');
const { Scheduler } = require('./scheduler');
const { createHealthApp } = require('./health');

const history = [];

async function main(argv) {
  const args = minimist(argv, { string: ['run'], boolean: ['once'] });
  if (config.env !== 'test') {
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://localhost:27017/shiptrack', { serverSelectionTimeoutMS: 2000 }).catch((err) => {
      console.warn(`mongo unavailable: ${err.message}`);
    });
  }
  const scheduler = new Scheduler({ jobs, context: { config }, onRun: (r) => history.push(r) });

  if (args.run) {
    const record = await scheduler.runOnce(args.run);
    console.log(JSON.stringify(record, null, 2));
    return record.status === 'succeeded' ? 0 : 1;
  }

  scheduler.start();
  createHealthApp(history).listen(config.healthPort, () => console.log(`worker health on :${config.healthPort}`));
  return null;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== null) process.exit(code);
  });
}

module.exports = { main };
