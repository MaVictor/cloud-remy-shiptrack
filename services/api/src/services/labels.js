const path = require('path');
const send = require('send');
const config = require('../config');

// Label PDFs are cached on disk under <uploadDir>/<reference>/label.pdf after the carrier returns them.
function labelPath(reference) {
  return path.join(reference, 'label.pdf');
}

function streamLabel(req, res, reference, next) {
  send(req, labelPath(reference), { root: path.resolve(config.uploadDir), maxAge: '1h', dotfiles: 'deny' })
    .on('error', (err) => {
      if (err.status === 404) return res.status(404).json({ error: 'label_not_found' });
      return next(err);
    })
    .on('headers', (r) => {
      r.setHeader('Content-Disposition', `inline; filename="${reference}-label.pdf"`);
    })
    .pipe(res);
}

module.exports = { labelPath, streamLabel };
