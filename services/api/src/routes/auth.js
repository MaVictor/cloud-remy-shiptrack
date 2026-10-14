const express = require('express');
const { celebrate, Joi, Segments } = require('celebrate');
const users = require('../services/users');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Exchange email and password for a bearer token
 *     tags: [auth]
 */
router.post(
  '/login',
  celebrate({
    [Segments.BODY]: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    }),
  }),
  (req, res) => {
    const user = users.authenticate(req.body.email, req.body.password);
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    return res.json({ token: users.issueToken(user), user: { id: user.id, name: user.name, role: user.role } });
  }
);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Claims for the current token
 *     tags: [auth]
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.sub, role: req.user.role, email: req.user.email });
});

module.exports = router;
