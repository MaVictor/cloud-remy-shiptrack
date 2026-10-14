const { Breaker } = require('../lib/breaker');

const factories = { dhl: require('./dhl'), ups: require('./ups'), postnord: require('./postnord') };

function createRegistry(carrierConfig, overrides = {}) {
  const registry = {};
  for (const [name, factory] of Object.entries(factories)) {
    registry[name] = { adapter: overrides[name] || factory(carrierConfig[name]), breaker: new Breaker(name) };
  }
  return registry;
}

module.exports = { createRegistry };
