/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
const bindings = require("bindings")("blst_ts_addon");

bindings.verify = async function verify(msg, pk, sig) {
  return bindings.aggregateVerify([msg], [pk], sig);
};
bindings.verifySync = function verifySync(msg, pk, sig) {
  return bindings.aggregateVerifySync([msg], [pk], sig);
};
bindings.fastAggregateVerify = async function fastAggregateVerify(msg, pks, sig) {
  try {
    const aggPk = await bindings.aggregatePublicKeys(pks);
    return bindings.aggregateVerify([msg], [aggPk], sig);
  } catch {
    return false;
  }
};
bindings.fastAggregateVerifySync = function fastAggregateVerifySync(msg, pks, sig) {
  try {
    const keys = [];
    const aggPk = bindings.aggregatePublicKeysSync(pks);
    if (aggPk !== null) keys.push(aggPk);
    return bindings.aggregateVerifySync([msg], keys, sig);
  } catch {
    return false;
  }
};
bindings.CoordType = {
  affine: 0,
  jacobian: 1
};

module.exports = exports = bindings;
