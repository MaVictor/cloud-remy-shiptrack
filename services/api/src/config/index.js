const Joi = require('joi');

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  JWT_SECRET: Joi.string().min(16).default('shiptrack-dev-secret-change-me'),
  JWT_TTL: Joi.string().default('1h'),
  MONGO_URL: Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).default('mongodb://localhost:27017/shiptrack'),
  CARRIER_API_URL: Joi.string().uri().default('https://api.carrier.example.com'),
  CARRIER_API_KEY: Joi.string().allow('').default(''),
  SMTP_URL: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().email().default('noreply@shiptrack.example.com'),
  UPLOAD_DIR: Joi.string().default('uploads'),
  ERP_URL: Joi.string().uri({ scheme: ['mssql'] }).allow(''),
  CUSTOMS_KEY_FILE: Joi.string().allow(''),
  CUSTOMS_EORI: Joi.string().default('GB123456789000'),
}).unknown();

const { value, error } = schema.validate(process.env);
if (error) {
  throw new Error(`Invalid configuration: ${error.message}`);
}

module.exports = {
  env: value.NODE_ENV,
  port: value.PORT,
  jwt: { secret: value.JWT_SECRET, ttl: value.JWT_TTL },
  mongoUrl: value.MONGO_URL,
  carrier: { url: value.CARRIER_API_URL, apiKey: value.CARRIER_API_KEY },
  mail: { smtpUrl: value.SMTP_URL, from: value.MAIL_FROM },
  uploadDir: value.UPLOAD_DIR,
  erpUrl: value.ERP_URL,
  customs: { keyFile: value.CUSTOMS_KEY_FILE, eori: value.CUSTOMS_EORI, traderName: 'ShipTrack Fulfilment Ltd' },
};
