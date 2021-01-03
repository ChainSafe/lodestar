import {config} from "@chainsafe/lodestar-config/minimal";
import {List} from "@chainsafe/ssz";
import {
  Ping,
  SignedBeaconBlock,
  Status,
  ProposerSlashing,
  AttesterSlashing,
  Attestation,
  Deposit,
  SignedVoluntaryExit,
} from "@chainsafe/lodestar-types";
import {RequestOrResponseBody, RequestOrResponseType} from "../../../../../../src/network";

interface ISszSnappyTestData<T extends RequestOrResponseBody> {
  type: RequestOrResponseType;
  body: T;
  chunks: string[];
}

export const sszSnappyPing: ISszSnappyTestData<Ping> = {
  type: config.types.Ping,
  body: BigInt(1),
  chunks: [
    "0x08", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x010c00000175de410100000000000000", // snappy frames content
  ],
};

export const sszSnappyStatus: ISszSnappyTestData<Status> = {
  type: config.types.Status,
  body: {
    forkDigest: Buffer.alloc(4, 0xda),
    finalizedRoot: Buffer.alloc(32, 0xda),
    finalizedEpoch: 9,
    headRoot: Buffer.alloc(32, 0xda),
    headSlot: 9,
  },
  chunks: [],
};

export const sszSnappySignedBlock: ISszSnappyTestData<SignedBeaconBlock> = {
  type: config.types.Status,
  body: {
    message: {
      slot: 9,
      proposerIndex: 9,
      parentRoot: Buffer.alloc(32, 0xda),
      stateRoot: Buffer.alloc(32, 0xda),
      body: {
        randaoReveal: Buffer.alloc(96, 0xda),
        eth1Data: {
          depositRoot: Buffer.alloc(32, 0xda),
          blockHash: Buffer.alloc(32, 0xda),
          depositCount: 9,
        },
        graffiti: Buffer.alloc(32, 0xda),
        proposerSlashings: ([] as ProposerSlashing[]) as List<ProposerSlashing>,
        attesterSlashings: ([] as AttesterSlashing[]) as List<AttesterSlashing>,
        attestations: ([] as Attestation[]) as List<Attestation>,
        deposits: ([] as Deposit[]) as List<Deposit>,
        voluntaryExits: listOf<SignedVoluntaryExit>(10, {
          message: {
            epoch: 9,
            validatorIndex: 9,
          },
          signature: Buffer.alloc(96, 0xda),
        }),
      },
    },
    signature: Buffer.alloc(96, 0xda),
  },
  chunks: [],
};

function listOf<T>(num: number, item: T): List<T> {
  return Array(num).fill(item);
}
