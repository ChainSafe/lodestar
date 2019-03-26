import BN from "bn.js";

import {
  BeaconBlock,
} from "../../src/types";


export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    parentRoot: Buffer.alloc(32),
    stateRoot: Buffer.alloc(32),
    randaoReveal: Buffer.alloc(96),
    eth1Data: {
      depositRoot: Buffer.alloc(32),
      blockHash: Buffer.alloc(32),
    },
    signature: Buffer.alloc(96),
    body: {
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
      transfers: [],
    },
  }
}
