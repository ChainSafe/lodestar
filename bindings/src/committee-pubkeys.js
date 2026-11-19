import bindings from "./bindings.js";

const native = bindings.committeePubkeys;

export const COMMITTEE_PUBKEYS_MAX_ENTRIES = native.MAX_ENTRIES;

export const computeCommitteePubkeys = native.compute;
export const releaseCommitteePubkeys = native.release;
export const committeePubkeysCount = native.size;
