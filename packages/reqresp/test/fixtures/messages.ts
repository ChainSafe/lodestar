import {fromHexString} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ResponseIncoming, TypeSizes} from "../../src/types.js";
import {ZERO_HASH} from "../utils/index.js";

type MessageFixture = {
  type: TypeSizes;
  binaryPayload: ResponseIncoming;
  chunks: Uint8Array[];
  asyncChunks: Uint8Array[];
};

const phase0Metadata = ssz.phase0.Metadata.fromJson({
  seq_number: "9",
  attnets: "0x0000000000000000",
});

export const sszSnappyPhase0Metadata: MessageFixture = {
  type: ssz.phase0.Metadata,
  binaryPayload: {
    data: ssz.phase0.Metadata.serialize(phase0Metadata),
    fork: ForkName.phase0,
    protocolVersion: 1,
  },
  chunks: ["0x10", "0xff060000734e61507059011400000b5ee91209000000000000000000000000000000"].map((s) =>
    fromHexString(s)
  ),
  asyncChunks: [
    "0x10", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x011400000b5ee91209000000000000000000000000000000", // snappy frames content
  ].map((d) => fromHexString(d)),
};

const altairMetadata = ssz.altair.Metadata.fromJson({
  seq_number: "8",
  attnets: "0x0000000000000000",
  syncnets: "0x00",
});

export const sszSnappyAltairMetadata: MessageFixture = {
  type: ssz.altair.Metadata,
  binaryPayload: {
    data: ssz.altair.Metadata.serialize(altairMetadata),
    fork: ForkName.phase0,
    protocolVersion: 2,
  },
  chunks: ["0x11", "0xff060000734e6150705901150000ff4669fc0800000000000000000000000000000000"].map(
    (s) => new Uint8Array(fromHexString(s))
  ),
  asyncChunks: [
    "0x11", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x01150000ff4669fc0800000000000000000000000000000000", // snappy frames content
  ].map((d) => Buffer.from(fromHexString(d))),
};

const pingData = BigInt(1);
export const sszSnappyPing: MessageFixture = {
  type: ssz.phase0.Ping,
  binaryPayload: {
    data: ssz.phase0.Ping.serialize(pingData),
    fork: ForkName.phase0,
    protocolVersion: 1,
  },
  chunks: ["0x08", "0xff060000734e61507059010c00000175de410100000000000000"].map((s) => fromHexString(s)),
  asyncChunks: [
    "0x08", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x010c00000175de410100000000000000", // snappy frames content
  ].map((d) => fromHexString(d)),
};

const statusData = {
  forkDigest: Buffer.alloc(4, 0xda),
  finalizedRoot: Buffer.alloc(32, 0xda),
  finalizedEpoch: 9,
  headRoot: Buffer.alloc(32, 0xda),
  headSlot: 9,
};
export const sszSnappyStatus: MessageFixture = {
  type: ssz.phase0.Status,
  binaryPayload: {
    data: ssz.phase0.Status.serialize(statusData),
    fork: ForkName.phase0,
    protocolVersion: 1,
  },
  asyncChunks: [
    "0x54", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x001b0000097802c15400da8a010004090009017e2b001c0900000000000000",
  ].map((d) => fromHexString(d)),
  chunks: ["0x54", "0xff060000734e61507059001b0000097802c15400da8a010004090009017e2b001c0900000000000000"].map((s) =>
    fromHexString(s)
  ),
};

const signedBeaconBlockPhase0Data = {
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
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
    },
  },
  signature: Buffer.alloc(96, 0xda),
};

export const sszSnappySignedBeaconBlockPhase0: MessageFixture = {
  type: ssz.phase0.SignedBeaconBlock,
  binaryPayload: {
    data: ssz.phase0.SignedBeaconBlock.serialize(signedBeaconBlockPhase0Data),
    fork: ForkName.phase0,
    protocolVersion: 2,
  },
  asyncChunks: [
    "0x9403",
    "0xff060000734e61507059",
    "0x00340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map((d) => fromHexString(d)),
  chunks: [
    "0x9403",
    "0xff060000734e6150705900340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map((s) => fromHexString(s)),
};

const signedBeaconBlockAltairData = {
  ...signedBeaconBlockPhase0Data,
  message: {
    ...signedBeaconBlockPhase0Data.message,
    slot: 90009,
    body: {
      ...signedBeaconBlockPhase0Data.message.body,
      syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
    },
  },
};
export const sszSnappySignedBeaconBlockAltair: MessageFixture = {
  type: ssz.altair.SignedBeaconBlock,
  binaryPayload: {
    data: ssz.altair.SignedBeaconBlock.serialize(signedBeaconBlockAltairData),
    fork: ForkName.altair,
    protocolVersion: 2,
  },
  asyncChunks: [
    "0xf803", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x003f0000ee14ab0df8031064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c400100003e0400fe01008e0100",
  ].map((d) => fromHexString(d)),
  chunks: [
    "0xb404",
    "0xff060000734e6150705900420000bab7f8feb4041064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c7c0100003e0400fe0100fe01007e0100",
  ].map((s) => fromHexString(s)),
};

// Set the altair fork to happen between the two precomputed SSZ snappy blocks
const slotBlockPhase0 = signedBeaconBlockPhase0Data.message.slot;
const slotBlockAltair = signedBeaconBlockAltairData.message.slot;
if (slotBlockAltair - slotBlockPhase0 < SLOTS_PER_EPOCH) {
  throw Error("phase0 block slot must be an epoch apart from altair block slot");
}
const ALTAIR_FORK_EPOCH = Math.floor(slotBlockAltair / SLOTS_PER_EPOCH);
export const beaconConfig = createBeaconConfig({...chainConfig, ALTAIR_FORK_EPOCH}, ZERO_HASH);

export const getEmptyHandler = <T = unknown>() => async function* emptyHandler(): AsyncGenerator<T> {};
