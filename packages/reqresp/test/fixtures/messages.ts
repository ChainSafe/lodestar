import {createBeaconConfig, BeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {allForks, altair, phase0, ssz} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import * as messagesDef from "../../src/protocols/index.js";
import {
  ContextBytesType,
  EncodedPayloadBytes,
  EncodedPayloadSsz,
  EncodedPayloadType,
  MixedProtocolDefinition,
  ReqRespHandler,
  TypeSerializer,
} from "../../src/types.js";
import {ZERO_HASH} from "../utils/index.js";

type MessageFixture<T> = {
  type: TypeSerializer<T>;
  sszPayload: EncodedPayloadSsz<T>;
  binaryPayload: EncodedPayloadBytes;
  chunks: Uint8Array[];
  asyncChunks: Buffer[];
};

const pingData = BigInt(1);
export const sszSnappyPing: MessageFixture<phase0.Ping> = {
  type: ssz.phase0.Ping,
  sszPayload: {
    type: EncodedPayloadType.ssz,
    data: pingData,
  },
  binaryPayload: {
    type: EncodedPayloadType.bytes,
    bytes: ssz.phase0.Ping.serialize(pingData),
    contextBytes: {
      type: ContextBytesType.Empty,
    },
  },
  chunks: ["0x08", "0xff060000734e61507059010c00000175de410100000000000000"].map(
    (s) => new Uint8Array(fromHexString(s))
  ),
  asyncChunks: [
    "0x08", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x010c00000175de410100000000000000", // snappy frames content
  ].map((d) => Buffer.from(fromHexString(d))),
};

const statusData = {
  forkDigest: Buffer.alloc(4, 0xda),
  finalizedRoot: Buffer.alloc(32, 0xda),
  finalizedEpoch: 9,
  headRoot: Buffer.alloc(32, 0xda),
  headSlot: 9,
};
export const sszSnappyStatus: MessageFixture<phase0.Status> = {
  type: ssz.phase0.Status,
  sszPayload: {
    type: EncodedPayloadType.ssz,
    data: statusData,
  },
  binaryPayload: {
    type: EncodedPayloadType.bytes,
    bytes: ssz.phase0.Status.serialize(statusData),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      fork: ForkName.altair,
    },
  },
  asyncChunks: [
    "0x54", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x001b0000097802c15400da8a010004090009017e2b001c0900000000000000",
  ].map((d) => Buffer.from(fromHexString(d))),
  chunks: ["0x54", "0xff060000734e61507059001b0000097802c15400da8a010004090009017e2b001c0900000000000000"].map(
    (s) => new Uint8Array(fromHexString(s))
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

export const sszSnappySignedBeaconBlockPhase0: MessageFixture<phase0.SignedBeaconBlock> = {
  type: ssz.phase0.SignedBeaconBlock,
  sszPayload: {
    type: EncodedPayloadType.ssz,
    data: signedBeaconBlockPhase0Data,
  },
  binaryPayload: {
    type: EncodedPayloadType.bytes,
    bytes: ssz.phase0.SignedBeaconBlock.serialize(signedBeaconBlockPhase0Data),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      fork: ForkName.phase0,
    },
  },
  asyncChunks: [
    "0x9403",
    "0xff060000734e61507059",
    "0x00340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map((d) => Buffer.from(fromHexString(d))),
  chunks: [
    "0x9403",
    "0xff060000734e6150705900340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map((s) => new Uint8Array(fromHexString(s))),
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
export const sszSnappySignedBeaconBlockAltair: MessageFixture<altair.SignedBeaconBlock> = {
  type: ssz.altair.SignedBeaconBlock,
  sszPayload: {
    type: EncodedPayloadType.ssz,
    data: signedBeaconBlockAltairData,
  },
  binaryPayload: {
    type: EncodedPayloadType.bytes,
    bytes: ssz.altair.SignedBeaconBlock.serialize(signedBeaconBlockAltairData),
    contextBytes: {
      type: ContextBytesType.ForkDigest,
      fork: ForkName.altair,
    },
  },
  asyncChunks: [
    "0xf803", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x003f0000ee14ab0df8031064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c400100003e0400fe01008e0100",
  ].map((d) => Buffer.from(fromHexString(d))),
  chunks: [
    "0xb404",
    "0xff060000734e6150705900420000bab7f8feb4041064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c7c0100003e0400fe0100fe01007e0100",
  ].map((s) => new Uint8Array(fromHexString(s))),
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
const getEmptyHandler = <T = unknown>() => async function* emptyHandler(): AsyncGenerator<T> {};

export const getAllMessages = (
  modules: {config: BeaconConfig} = {config: createBeaconConfig(chainConfig, ZERO_HASH)}
): {
  ping: MixedProtocolDefinition<phase0.Ping, phase0.Ping>;
  goodbye: MixedProtocolDefinition<phase0.Goodbye, phase0.Goodbye>;
  metadata: MixedProtocolDefinition<null, allForks.Metadata>;
  status: MixedProtocolDefinition<phase0.Status, phase0.Status>;
  blocksByRange: MixedProtocolDefinition<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>;
  blocksByRangeV2: MixedProtocolDefinition<phase0.BeaconBlocksByRangeRequest, allForks.SignedBeaconBlock>;
  blocksByRoot: MixedProtocolDefinition<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>;
  blocksByRootV2: MixedProtocolDefinition<phase0.BeaconBlocksByRootRequest, allForks.SignedBeaconBlock>;
} => ({
  ping: messagesDef.Ping(modules, getEmptyHandler()),
  goodbye: messagesDef.Goodbye(modules, getEmptyHandler()),
  metadata: messagesDef.Metadata(modules, getEmptyHandler()),
  status: messagesDef.Status(modules, getEmptyHandler() as ReqRespHandler<phase0.Status>),
  blocksByRange: messagesDef.BeaconBlocksByRange(modules, getEmptyHandler()),
  blocksByRangeV2: messagesDef.BeaconBlocksByRangeV2(modules, getEmptyHandler()),
  blocksByRoot: messagesDef.BeaconBlocksByRoot(modules, getEmptyHandler()),
  blocksByRootV2: messagesDef.BeaconBlocksByRootV2(modules, getEmptyHandler()),
});

// Set the altair fork to happen between the two precomputed SSZ snappy blocks
const slotBlockPhase0 = sszSnappySignedBeaconBlockPhase0.sszPayload.data.message.slot;
const slotBlockAltair = sszSnappySignedBeaconBlockAltair.sszPayload.data.message.slot;
if (slotBlockAltair - slotBlockPhase0 < SLOTS_PER_EPOCH) {
  throw Error("phase0 block slot must be an epoch apart from altair block slot");
}
const ALTAIR_FORK_EPOCH = Math.floor(slotBlockAltair / SLOTS_PER_EPOCH);
// eslint-disable-next-line @typescript-eslint/naming-convention
export const beaconConfig = createBeaconConfig({...chainConfig, ALTAIR_FORK_EPOCH}, ZERO_HASH);

export const messages = getAllMessages({config: beaconConfig});
