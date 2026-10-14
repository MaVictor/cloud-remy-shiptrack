const path = require('path');
const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const pkg = require('../../package.json');

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: { title: 'ShipTrack API', version: pkg.version, description: pkg.description },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearer: [] }],
  },
  apis: [path.join(__dirname, '*.js')],
});

const router = express.Router();
router.get('/openapi.json', (req, res) => res.json(spec));
router.use('/', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'ShipTrack API' }));

module.exports = router;
