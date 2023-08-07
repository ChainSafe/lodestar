/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
const bindings = require("bindings")("blst_ts_addon");

bindings.verify = function verify(msg, pk, sig) {
  return bindings.aggregateVerify([msg], [pk], sig);
};

bindings.asyncVerify = function asyncVerify(msg, pk, sig) {
  return bindings.asyncAggregateVerify([msg], [pk], sig);
};

bindings.fastAggregateVerify = function fastAggregateVerify(msg, pks, sig) {
  let key;
  try {
    // this throws for invalid key, catch and return false
    key = bindings.aggregatePublicKeys(pks);
  } catch {
    return false;
  }
  return bindings.aggregateVerify([msg], [key], sig);
};

bindings.asyncFastAggregateVerify = function asyncFastAggregateVerify(msg, pks, sig) {
  let key;
  try {
    // this throws for invalid key, catch and return false
    key = bindings.aggregatePublicKeys(pks);
  } catch {
    return false;
  }
  return bindings.asyncAggregateVerify([msg], [key], sig);
};

bindings.CoordType = {
  affine: 0,
  jacobian: 1,
};

module.exports = exports = bindings;
