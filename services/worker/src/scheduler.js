const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

function parseEvery(every) {
  const m = /^(\d+)([smh])$/.exec(every);
  if (!m) throw new Error(`bad interval ${every}`);
  return moment.duration(Number(m[1]), m[2]).asMilliseconds();
}

// "07:00" runs daily; "Mon 08:00" runs weekly. Returns the next run strictly after `now`.
function nextRun(at, now = new Date()) {
  const [day, time] = at.includes(' ') ? at.split(' ') : [null, at];
  const [h, min] = time.split(':').map(Number);
  const next = moment(now).hours(h).minutes(min).seconds(0).milliseconds(0);
  if (day) {
    next.isoWeekday(moment().isoWeekday(day).isoWeekday());
    if (!next.isAfter(now)) next.add(1, 'week');
  } else if (!next.isAfter(now)) {
    next.add(1, 'day');
  }
  return next.toDate();
}

class Scheduler {
  constructor({ jobs, context, onRun = () => {} }) {
    this.jobs = jobs;
    this.context = context;
    this.onRun = onRun;
    this.timers = [];
  }

  async runOnce(name, extra = {}) {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`unknown job ${name}`);
    const record = { runId: uuidv4(), job: name, status: 'running', startedAt: new Date() };
    try {
      record.summary = await job.run({ ...this.context, ...extra });
      record.status = 'succeeded';
    } catch (err) {
      record.status = 'failed';
      record.error = err.message;
    }
    record.finishedAt = new Date();
    this.onRun(record);
    return record;
  }

  start() {
    for (const job of this.jobs) {
      if (job.every) {
        this.timers.push(setInterval(() => this.runOnce(job.name), parseEvery(job.every)));
      } else if (job.at) {
        const schedule = () => {
          const delay = nextRun(job.at).getTime() - Date.now();
          this.timers.push(setTimeout(() => this.runOnce(job.name).finally(schedule), delay));
        };
        schedule();
      }
    }
  }

  stop() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}

module.exports = { Scheduler, parseEvery, nextRun };
