const passport = require('passport');
const { Strategy, ExtractJwt } = require('passport-jwt');
const config = require('../config');

// Only ShipTrack services call the gateway; they present scoped service tokens.
passport.use(
  new Strategy(
    { jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: config.serviceSecret, algorithms: ['HS256'] },
    (payload, done) => done(null, payload.sub && payload.sub.startsWith('svc:') ? payload : false)
  )
);

function requireScope(...scopes) {
  return [
    passport.authenticate('jwt', { session: false }),
    (req, res, next) => (scopes.includes(req.user.scope) ? next() : res.status(403).json({ error: 'insufficient_scope' })),
  ];
}

module.exports = { passport, requireScope };
