import crypto from "crypto";
import {List} from "@chainsafe/ssz";
import {
  BeaconBlock,
  SignedBeaconBlock,
  ProposerSlashing,
  AttesterSlashing,
  Deposit,
  SignedVoluntaryExit,
  Attestation
} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants";


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
      proposerSlashings: [] as ProposerSlashing[] as List<ProposerSlashing>,
      attesterSlashings: [] as AttesterSlashing[] as List<AttesterSlashing>,
      attestations: [] as Attestation[] as List<Attestation>,
      deposits: [] as Deposit[] as List<Deposit>,
      voluntaryExits: [] as SignedVoluntaryExit[] as  List<SignedVoluntaryExit>,
    },
  };
}

export function generateEmptySignedBlock(): SignedBeaconBlock {
  return {
    message: generateEmptyBlock(),
    signature: Buffer.alloc(96),
  };
}

