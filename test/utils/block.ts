import BN from "bn.js";

import {
  BeaconBlock,
} from "../../src/types";


export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    previousBlockRoot: Buffer.alloc(32),
    stateRoot: Buffer.alloc(32),
    body: {
      randaoReveal: Buffer.alloc(96),
      eth1Data: {
        depositRoot: Buffer.alloc(32),
        blockHash: Buffer.alloc(32),
        depositCount: 0,
      },
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
      transfers: [],
    },
    signature: Buffer.alloc(96),
  }
}
