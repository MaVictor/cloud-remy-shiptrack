module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  serviceSecret: process.env.SERVICE_JWT_SECRET || 'shiptrack-service-dev-secret',
  smtpUrl: process.env.SMTP_URL || '',
  alertRecipients: (process.env.ALERT_RECIPIENTS || 'oncall@shiptrack.example.com').split(','),
  carriers: {
    dhl: { baseURL: process.env.DHL_URL || 'https://api.dhl.example.com', apiKey: process.env.DHL_API_KEY || '', apiVersion: process.env.DHL_API_VERSION || '2.3.1' },
    ups: { baseURL: process.env.UPS_URL || 'https://onlinetools.ups.example.com', clientId: process.env.UPS_CLIENT_ID || '', clientSecret: process.env.UPS_CLIENT_SECRET || '' },
    postnord: { baseURL: process.env.POSTNORD_URL || 'https://soap.postnord.example.com', signingKeyFile: process.env.POSTNORD_KEY_FILE || '' },
  },
};
