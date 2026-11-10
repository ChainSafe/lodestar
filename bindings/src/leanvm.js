import bindings from "./bindings.js";

const leanvm = bindings.leanvm;

export const LEANVM_AVAILABLE = leanvm.isAvailable();

export const XMSS_SEED_SIZE = leanvm.SEED_SIZE;
export const XMSS_MESSAGE_SIZE = leanvm.MESSAGE_SIZE;
export const XMSS_PUBLIC_KEY_SIZE = leanvm.PUBLIC_KEY_SIZE;
export const XMSS_SIGNATURE_SIZE = leanvm.SIGNATURE_SIZE;
export const XMSS_CLAIM_SIZE = leanvm.CLAIM_SIZE;
export const XMSS_SIGNED_SIZE = leanvm.SIGNED_SIZE;
export const XMSS_AGGREGATE_MAX_CHILDREN = leanvm.MAX_RECURSIONS;
export const XMSS_AGGREGATE_MAX_CLAIMS = leanvm.MAX_KEYS;
export const XMSS_AGGREGATE_MIN_LOG_INV_RATE = leanvm.MIN_LOG_INV_RATE;
export const XMSS_AGGREGATE_MAX_LOG_INV_RATE = leanvm.MAX_LOG_INV_RATE;

export const XmssSecretKey = leanvm.XmssSecretKey;

// The native methods throw on a malformed argument before they return a promise: reject instead.
for (const target of [XmssSecretKey, XmssSecretKey.prototype]) {
  for (const name of target === XmssSecretKey ? ["generate", "fromSeed"] : ["prepare", "sign"]) {
    const native = target[name];
    target[name] = async function (...args) {
      return native.apply(this, args);
    };
  }
}

export const verifyXmssSignature = leanvm.verify;

/** @type {typeof import("./leanvm.d.ts").setupXmssAggregation} */
export async function setupXmssAggregation() {
  return leanvm.setup();
}

/** @type {typeof import("./leanvm.d.ts").aggregateXmssSignatures} */
export async function aggregateXmssSignatures(children, signed, logInvRate, declare) {
  return leanvm.aggregate(children, signed, declare, logInvRate);
}

/** @type {typeof import("./leanvm.d.ts").verifyXmssAggregate} */
export async function verifyXmssAggregate(proof, claims) {
  return leanvm.verifyAggregate(proof, claims);
}
