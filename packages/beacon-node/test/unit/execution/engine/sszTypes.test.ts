import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {
  ForkchoiceUpdateGloas,
  ForkchoiceUpdateResponse,
  PayloadStatus,
  PayloadStatusCode,
  engineSszTypes,
  executionForkName,
} from "../../../../src/execution/engine/sszTypes.js";

describe("execution / engine / sszTypes", () => {
  const hash = fromHex("0x1111111111111111111111111111111111111111111111111111111111111111");

  describe("PayloadStatus", () => {
    // Worked byte examples from execution-apis refactor-ssz.md
    it("encodes VALID without error as 41 bytes", () => {
      const bytes = PayloadStatus.serialize({
        status: PayloadStatusCode.VALID,
        latestValidHash: [hash],
        validationError: [],
      });

      expect(bytes.length).toBe(41);
      expect(toHex(bytes)).toBe(`0x00${"09000000"}${"29000000"}${toHex(hash).slice(2)}`);
      expect(PayloadStatus.deserialize(bytes)).toEqual({
        status: PayloadStatusCode.VALID,
        latestValidHash: [hash],
        validationError: [],
      });
    });

    it("encodes INVALID with error as nested optional string", () => {
      const error = new TextEncoder().encode("bad state root");
      const bytes = PayloadStatus.serialize({
        status: PayloadStatusCode.INVALID,
        latestValidHash: [],
        validationError: [error],
      });

      expect(bytes.length).toBe(27);
      expect(toHex(bytes)).toBe(`0x01${"09000000"}${"09000000"}${"04000000"}${toHex(error).slice(2)}`);
      expect(new TextDecoder().decode(PayloadStatus.deserialize(bytes).validationError[0])).toBe("bad state root");
    });
  });

  describe("ForkchoiceUpdateResponse", () => {
    it("round trips with and without payload id", () => {
      const payloadId = fromHex("0x0000000000000001");
      const withId = {
        payloadStatus: {status: PayloadStatusCode.VALID, latestValidHash: [hash], validationError: []},
        payloadId: [payloadId],
      };
      const withoutId = {...withId, payloadId: []};

      expect(ForkchoiceUpdateResponse.deserialize(ForkchoiceUpdateResponse.serialize(withId))).toEqual(withId);
      expect(ForkchoiceUpdateResponse.deserialize(ForkchoiceUpdateResponse.serialize(withoutId))).toEqual(withoutId);
    });
  });

  describe("per fork containers", () => {
    for (const [fork, types] of Object.entries(engineSszTypes)) {
      it(`${fork} round trips default values`, () => {
        for (const [name, type] of Object.entries(types)) {
          const value = type.defaultValue();
          expect(type.deserialize(type.serialize(value)), `${fork} ${name}`).toEqual(value);
        }
      });
    }

    it("encodes absent gloas payload attributes and custody columns as empty lists", () => {
      const bytes = ForkchoiceUpdateGloas.serialize({
        forkchoiceState: {headBlockHash: hash, safeBlockHash: hash, finalizedBlockHash: hash},
        payloadAttributes: [],
        custodyColumns: [],
      });
      // 3 hashes + 2 offsets, no variable data
      expect(bytes.length).toBe(32 * 3 + 4 * 2);
    });

    it("embeds the consensus execution payload types", () => {
      const payload = ssz.gloas.ExecutionPayload.defaultValue();
      payload.blockNumber = 7;
      const envelope = engineSszTypes[ForkName.gloas].ExecutionPayloadEnvelope.serialize({
        payload,
        parentBeaconBlockRoot: hash,
        executionRequests: [],
      });
      expect(engineSszTypes[ForkName.gloas].ExecutionPayloadEnvelope.deserialize(envelope).payload.blockNumber).toBe(7);
    });
  });

  it("maps consensus forks to execution fork names", () => {
    expect(executionForkName).toEqual({
      bellatrix: "paris",
      capella: "shanghai",
      deneb: "cancun",
      electra: "prague",
      fulu: "osaka",
      gloas: "amsterdam",
      heze: null,
    });
  });
});
