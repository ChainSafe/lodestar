import bindings from "./bindings.js";

const blsVerifier = bindings.blsVerifier;

/** @type {typeof import("./bls-verifier.d.ts").BLS_VERIFIER_SET_TYPE} */
export const BLS_VERIFIER_SET_TYPE = blsVerifier.SetType;

export const BLS_VERIFIER_MAX_BATCH_SIZE = blsVerifier.MAX_BATCH_SIZE;
export const BLS_VERIFIER_MAX_SAME_MESSAGE_BATCH_SIZE = blsVerifier.MAX_SAME_MESSAGE_BATCH_SIZE;

export const verifySignatureSets = blsVerifier.verifySignatureSets;
export const verifySignatureSetsSameMessage = blsVerifier.verifySignatureSetsSameMessage;
