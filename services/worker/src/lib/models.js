const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true },
    warehouse: { type: String, required: true },
    onHand: { type: Number, min: 0, required: true },
    reserved: { type: Number, min: 0, default: 0 },
    syncedAt: { type: Date, required: true },
  },
  { versionKey: false }
);
stockSchema.index({ sku: 1, warehouse: 1 }, { unique: true });
stockSchema.virtual('available').get(function available() {
  return Math.max(0, this.onHand - this.reserved);
});

const jobRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true },
    job: { type: String, required: true },
    status: { type: String, enum: ['running', 'succeeded', 'failed'], required: true },
    startedAt: Date,
    finishedAt: Date,
    summary: mongoose.Schema.Types.Mixed,
    error: String,
  },
  { versionKey: false }
);

module.exports = {
  Stock: mongoose.models.Stock || mongoose.model('Stock', stockSchema),
  JobRun: mongoose.models.JobRun || mongoose.model('JobRun', jobRunSchema),
};
