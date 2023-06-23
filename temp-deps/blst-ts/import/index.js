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
  try {
    return bindings.aggregateVerify([msg], [bindings.aggregatePublicKeys(pks)], sig);
  } catch {
    return false;
  }
};

bindings.asyncFastAggregateVerify = function asyncFastAggregateVerify(msg, pks, sig) {
  try {
    return bindings.asyncAggregateVerify([msg], [bindings.aggregatePublicKeys(pks)], sig);
  } catch {
    return false;
  }
};

bindings.CoordType = {
  affine: 0,
  jacobian: 1,
};

module.exports = exports = bindings;
