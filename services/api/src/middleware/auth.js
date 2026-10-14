const jwt = require('express-jwt');
const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const config = require('../config');
const users = require('../services/users');

// API routes: verify the bearer token and expose its claims on req.user.
const requireAuth = jwt({
  secret: config.jwt.secret,
  algorithms: ['HS256'],
});

// Admin routes go through passport so we can load the full user record.
passport.use(
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.jwt.secret,
      algorithms: ['HS256'],
    },
    (payload, done) => {
      const user = users.findById(payload.sub);
      if (!user) return done(null, false);
      return done(null, user);
    }
  )
);

const requireAdmin = [
  passport.authenticate('jwt', { session: false }),
  (req, res, next) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    return next();
  },
];

module.exports = { requireAuth, requireAdmin, passport };
