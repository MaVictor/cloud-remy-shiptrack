const axios = require('axios');
const serviceToken = require('./serviceToken');

function serviceClient(baseURL, scope) {
  const client = axios.create({ baseURL, timeout: 10000 });
  client.interceptors.request.use((req) => {
    req.headers.Authorization = `Bearer ${serviceToken.issue(scope)}`;
    return req;
  });
  return client;
}

module.exports = { serviceClient };
