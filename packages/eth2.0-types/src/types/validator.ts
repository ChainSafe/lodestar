/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module types
 */

import {BLSPubkey, Shard, Slot, uint64, number64} from "./primitive";
import {Validator} from "./misc";

export interface ValidatorDuty {
  // The validator's public key, uniquely identifying them
  validatorPubkey: BLSPubkey;
  // The index of the validator in the committee
  committeeIndex: number64;
  // The slot at which the validator must attest
  attestationSlot: Slot;
  // The shard in which the validator must attest
  attestationShard: Shard;
  // The slot in which a validator must propose a block, this field can be Null
  blockProposalSlot: Slot;
}

export interface SyncingStatus {
  // The block at which syncing started (will only be reset, after the sync reached his head)
  startingBlock: uint64;
  // Current Block
  currentBlock: uint64;
  // The estimated highest block, or current target block number
  highestBlock: uint64;
}

export interface Registry<T, T1> extends Array<T> {
  // find index in array from a field
  findIndexByRegistry?: (field: T1) => number;
}
// T: the type to index
// T1: the type of field to index
interface InternalRegistry<T, T1> extends Registry<T, T1> {
  registry?: Map<T1, number>;
}

export function getRegistry<T, T1>(items: T[], getField: (item: T) => T1): Registry<T, T1> {
  const internalRegistry: InternalRegistry<T, T1> = items;
  // index for the first time
  const tmp = new Map<T1, number>();
  internalRegistry.forEach((value: T, index: number) => tmp.set(getField(value), index));
  internalRegistry.registry = tmp;
  internalRegistry.findIndexByRegistry = (field: T1) => internalRegistry.registry.get(field);

  // on the fly index
  const handler: ProxyHandler<InternalRegistry<T, T1>> = {
    get: (target: InternalRegistry<T, T1>, p: PropertyKey) => {
      if (p.toString() === "registry") {
        throw new Error("Cannot access registry property directly");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = target as any;
      return obj[p.toString()];
    },
    set: (target: InternalRegistry<T, T1>, p: PropertyKey, receiver) => {
      if(Number(p.toString()) || p.toString() === "0") {
        const oldValue = target[Number(p)];
        // make sure we haven't just update the old value
        // like in the case of splice method
        if (oldValue && target.registry.get(getField(oldValue)) == Number(p)) {
          target.registry.delete(getField(oldValue));
        }
        target.registry.set(getField(receiver), Number(p));
        target[Number(p)] = receiver;
        return true;
      } else if (p.toString() === "length") {
        target["length"] = receiver; 
        return true;
      }
      return false;
    }
  };

  return new Proxy<InternalRegistry<T, T1>>(internalRegistry, handler);
}

// Map uses === to compare key so to search for public key so we should base on hex, not BLSPublickey
export type ValidatorRegistry = Registry<Validator, string>;

export const getValidatorRegistry = (validators: Validator[]): ValidatorRegistry => {
  const getPublicKey = (validator: Validator): string => validator.pubkey.toString("hex");
  return getRegistry(validators, getPublicKey);
};