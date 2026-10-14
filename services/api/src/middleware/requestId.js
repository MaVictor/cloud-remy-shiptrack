const { v4: uuidv4, validate } = require('uuid');

// Propagate a caller-supplied X-Request-Id when it is a valid UUID, otherwise mint one.
module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && validate(incoming) ? incoming : uuidv4();
  res.set('X-Request-Id', req.id);
  next();
};
