import bindings from "./bindings.js";

const blst = bindings.blst;

export const PublicKey = blst.PublicKey;
export const SecretKey = blst.SecretKey;
export const Signature = blst.Signature;

export const verify = blst.verify;
export const aggregateVerify = blst.aggregateVerify;
export const fastAggregateVerify = blst.fastAggregateVerify;
export const verifyMultipleAggregateSignatures = blst.verifyMultipleAggregateSignatures;
export const aggregateSignatures = blst.aggregateSignatures;
export const aggregatePublicKeys = blst.aggregatePublicKeys;
export const aggregateSerializedPublicKeys = blst.aggregateSerializedPublicKeys;
