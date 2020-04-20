import { BeaconBlock } from "@chainsafe/lodestar-types";
import crypto from "crypto";
import { ZERO_HASH } from "@chainsafe/lodestar-beacon-state-transition";

export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    proposerIndex: 0,
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
