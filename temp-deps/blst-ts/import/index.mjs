/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const {default: getBindings} = await import("bindings");
const bindings = getBindings("blst_ts_addon");
const {
  BLST_CONSTANTS,
  SecretKey,
  PublicKey,
  Signature,
  aggregatePublicKeys,
  aggregateSignatures,
  aggregateVerify,
  verifyMultipleAggregateSignatures,
  asyncAggregateVerify,
  asyncVerifyMultipleAggregateSignatures,
} = bindings;

SecretKey.prototype.toHex = function() {
  return `0x${this.serialize().toString("hex")}`;
}

PublicKey.prototype.toHex = function(compress) {
  return `0x${this.serialize(compress).toString("hex")}`;
}

Signature.prototype.toHex = function(compress) {
  return `0x${this.serialize(compress).toString("hex")}`;
}

export {
  BLST_CONSTANTS,
  SecretKey,
  PublicKey,
  Signature,
  aggregatePublicKeys,
  aggregateSignatures,
  aggregateVerify,
  verifyMultipleAggregateSignatures,
  asyncAggregateVerify,
  asyncVerifyMultipleAggregateSignatures,
};

export function verify(msg, pk, sig) {
  return bindings.aggregateVerify([msg], [pk], sig);
}

export function asyncVerify(msg, pk, sig) {
  return bindings.asyncAggregateVerify([msg], [pk], sig);
}

export function fastAggregateVerify(msg, pks, sig) {
  let key;
  try {
    // this throws for invalid key, catch and return false
    key = bindings.aggregatePublicKeys(pks);
  } catch {
    return false;
  }
  return bindings.aggregateVerify([msg], [key], sig);
}

export function asyncFastAggregateVerify(msg, pks, sig) {
  let key;
  try {
    // this throws for invalid key, catch and return false
    key = bindings.aggregatePublicKeys(pks);
  } catch {
    return false;
  }
  return bindings.asyncAggregateVerify([msg], [key], sig);
}

export const CoordType = {
  affine: 0,
  jacobian: 1,
};
