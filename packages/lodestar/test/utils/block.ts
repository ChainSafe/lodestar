import {BeaconBlock} from "@chainsafe/eth2.0-types";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants";


export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    parentRoot: Buffer.alloc(32),
    stateRoot: ZERO_HASH,
    body: {
      randaoReveal: Buffer.alloc(96),
      eth1Data: {
        depositRoot: Buffer.alloc(32),
        blockHash: Buffer.alloc(32),
        depositCount: 0,
      },
      graffiti: Buffer.alloc(32),
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
    },
    signature: EMPTY_SIGNATURE,
  };
}
