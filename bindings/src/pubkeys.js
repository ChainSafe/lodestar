import bindings from "./bindings.js";

const native = bindings.pubkeys;

/** @type {import("./pubkeys.d.ts").PubkeyCache} */
export const pubkeyCache = {
  get(index) {
    return native.get(index);
  },

  getOrThrow(index) {
    const pk = pubkeyCache.get(index);
    if (pk === undefined) {
      throw Error(`pubkeyCache: index ${index} not found`);
    }
    return pk;
  },

  getPubkeyBytes(index) {
    return native.getPubkeyBytes(index);
  },

  getPubkeyBytesOrThrow(index) {
     const pubkey = native.getPubkeyBytes(index);
     if (pubkey === undefined) {
       throw new Error(`pubkeyCache: index ${index} not found`);
     }

     return pubkey;
   },

  aggregate(indices) {
    if (indices.length === 1) return pubkeyCache.getOrThrow(indices[0]);
    return native.aggregate(indices);
  },

  getIndex(pubkey) {
    return native.getIndex(pubkey);
  },

  append(index, pubkey) {
    native.append(index, pubkey);
  },

  syncPubkeys(validators) {
    native.syncPubkeys(validators);
  },

  get size() {
    return native.size();
  },

  get capacity() {
    return native.capacity();
  },

  load(filepath, maxCapacity) {
    native.load(filepath, maxCapacity);
  },

  reset() {
    native.reset();
  },

  save(filepath) {
    native.save(filepath);
  },

  ensureCapacity(capacity) {
    native.ensureCapacity(capacity);
  },
};
