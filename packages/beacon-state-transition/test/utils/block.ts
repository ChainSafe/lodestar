import crypto from "node:crypto";
import {phase0} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../src/constants/index.js";

export function generateEmptyBlock(): phase0.BeaconBlock {
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
      proposerSlashings: [] as phase0.ProposerSlashing[],
      attesterSlashings: [] as phase0.AttesterSlashing[],
      attestations: [] as phase0.Attestation[],
      deposits: [] as phase0.Deposit[],
      voluntaryExits: [] as phase0.SignedVoluntaryExit[],
    },
  };
}

export function generateEmptySignedBlock(): phase0.SignedBeaconBlock {
  return {
    message: generateEmptyBlock(),
    signature: Buffer.alloc(96),
  };
}
