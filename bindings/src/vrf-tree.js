import bindings from "./bindings.js";

const vrfTree = bindings.vrfTree;

export const VRF_SEED_SIZE = vrfTree.SEED_SIZE;
export const VRF_TREE_DEPTH = vrfTree.DEPTH;
export const VRF_PROOF_SIZE = vrfTree.PROOF_SIZE;

export const VrfTree = vrfTree.VrfTree;

// The native method throws on a malformed argument before it returns a promise: reject instead.
const nativeBuild = VrfTree.build;
VrfTree.build = async function (...args) {
  return nativeBuild.apply(this, args);
};
