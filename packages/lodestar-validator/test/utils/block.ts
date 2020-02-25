import { BeaconBlock } from "@chainsafe/eth2.0-types";
import crypto from "crypto";
import { ZERO_HASH } from "@chainsafe/eth2.0-state-transition";

export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    parentRoot: crypto.randomBytes(32),
    stateRoot: ZERO_HASH,
    body: {
      randaoReveal: Buffer.alloc(96),
      eth1Data: {
        depositRoot: crypto.randomBytes(32),
        blockHash: crypto.randomBytes(32),
        depositCount: 0,
      },
      graffiti: crypto.randomBytes(32),
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
    },
  };
}