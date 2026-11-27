import bindings from "./bindings.js";

const native = bindings.shuffle;

export const innerShuffleList = native.innerShuffleList;
export const unshuffleList = native.unshuffleList;
export const computeProposerIndex = native.computeProposerIndex;
export const computeSyncCommitteeIndices = native.computeSyncCommitteeIndices;
export const computePtcIndices = native.computePtcIndices;
export const computePtcIndicesForEpoch = native.computePtcIndicesForEpoch;
export const computePtcIndicesInto = native.computePtcIndicesInto;
export const computePtcIndicesForEpochInto = native.computePtcIndicesForEpochInto;
