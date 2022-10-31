import {Uint8ArrayList} from "uint8arraylist";
import {fromHexString} from "@chainsafe/ssz";
import {altair, phase0, ssz} from "@lodestar/types";
import {RequestOrIncomingResponseBody, RequestOrResponseType} from "../../../../../../src/network/reqresp/types.js";

// This test data generated with code from 'master' at Jan 1st 2021
// commit: ea3ffab1ffb8093b61a8ebfa4b4432c604c10819

export interface ISszSnappyTestData<T extends RequestOrIncomingResponseBody> {
  id: string;
  type: RequestOrResponseType;
  body: T;
  /** chunks expected in an async compress version of snappy stream */
  asyncChunks: Buffer[];
  /** chunks expected in a sync compress version of snappy stream  */
  chunks: Uint8ArrayList[];
}

export const sszSnappyPing: ISszSnappyTestData<phase0.Ping> = {
  id: "Ping type",
  type: ssz.phase0.Ping,
  body: BigInt(1),
  asyncChunks: [
    "0x08", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x010c00000175de410100000000000000", // snappy frames content
  ].map(fromHexString) as Buffer[],
  chunks: ["0x08", "0xff060000734e61507059010c00000175de410100000000000000"].map(
    (s) => new Uint8ArrayList(fromHexString(s))
  ),
};

export const sszSnappyStatus: ISszSnappyTestData<phase0.Status> = {
  id: "Status type",
  type: ssz.phase0.Status,
  body: {
    forkDigest: Buffer.alloc(4, 0xda),
    finalizedRoot: Buffer.alloc(32, 0xda),
    finalizedEpoch: 9,
    headRoot: Buffer.alloc(32, 0xda),
    headSlot: 9,
  },
  asyncChunks: [
    "0x54", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x001b0000097802c15400da8a010004090009017e2b001c0900000000000000",
  ].map(fromHexString) as Buffer[],
  chunks: ["0x54", "0xff060000734e61507059001b0000097802c15400da8a010004090009017e2b001c0900000000000000"].map(
    (s) => new Uint8ArrayList(fromHexString(s))
  ),
};

export const sszSnappySignedBeaconBlockPhase0: ISszSnappyTestData<phase0.SignedBeaconBlock> = {
  id: "SignedBeaconBlock type",
  type: ssz.phase0.SignedBeaconBlock,
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
        proposerSlashings: [],
        attesterSlashings: [],
        attestations: [],
        deposits: [],
        voluntaryExits: [],
      },
    },
    signature: Buffer.alloc(96, 0xda),
  },
  asyncChunks: [
    "0x9403",
    "0xff060000734e61507059",
    "0x00340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map(fromHexString) as Buffer[],
  chunks: [
    "0x9403",
    "0xff060000734e6150705900340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map((s) => new Uint8ArrayList(fromHexString(s))),
};

export const sszSnappySignedBeaconBlockAltair: ISszSnappyTestData<altair.SignedBeaconBlock> = {
  id: "SignedBeaconBlock type",
  type: ssz.phase0.SignedBeaconBlock,
  body: {
    ...sszSnappySignedBeaconBlockPhase0.body,
    message: {
      ...sszSnappySignedBeaconBlockPhase0.body.message,
      slot: 90009,
      body: {
        ...sszSnappySignedBeaconBlockPhase0.body.message.body,
        syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
      },
    },
  },
  asyncChunks: [
    "0xf803", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x003f0000ee14ab0df8031064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c400100003e0400fe01008e0100",
  ].map(fromHexString) as Buffer[],
  chunks: [
    "0xf803",
    "0xff060000734e61507059003f0000ee14ab0df8031064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c400100003e0400fe01008e0100",
  ].map((s) => new Uint8ArrayList(fromHexString(s))),
};
