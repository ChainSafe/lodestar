import {describe, it, expect} from "vitest";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/index.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";

const MOCK_ROOT_HEX = "0x" + "aa".repeat(32);
const MOCK_BLOCK_HASH = "0x" + "bb".repeat(32);

describe("PayloadEnvelopeInput - addPayloadEnvelope", () => {
  function createMockBlock() {
    return {
      message: {
        slot: 1,
        proposerIndex: 1,
        body: {
          signedExecutionPayloadBid: {
            message: {
              blobKzgCommitments: [],
              blockHash: "0xabc",
              builderIndex: 1,
            },
          },
        },
      },
    } as any;
  }

  function createMockEnvelope(blockHash = MOCK_BLOCK_HASH) {
    return {
      message: {
        beaconBlockRoot: Buffer.from(MOCK_ROOT_HEX.slice(2), "hex"),
        payload: {
          blockHash,
        },
      },
    } as any;
  }

  function createInput() {
    return PayloadEnvelopeInput.createFromBlock({
      blockRootHex: MOCK_ROOT_HEX,
      block: createMockBlock(),
      sampledColumns: [],
      custodyColumns: [],
      timeCreatedSec: 1,
      logger: undefined,
    });
  }

  it("should set payload on first call", () => {
    const input = createInput();
    const envelope = createMockEnvelope();

    input.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 1,
    });

    expect(input.hasPayloadEnvelope()).toBe(true);
  });

  it("should NOT throw on duplicate payload (race condition fix)", () => {
    const input = createInput();
    const envelope = createMockEnvelope();

    input.addPayloadEnvelope({
      envelope,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 1,
    });

    expect(() =>
      input.addPayloadEnvelope({
        envelope,
        source: PayloadEnvelopeInputSource.api,
        seenTimestampSec: 2,
      })
    ).not.toThrow();
  });

  it("should NOT throw on conflicting payload", () => {
    const input = createInput();

    const envelope1 = createMockEnvelope(MOCK_BLOCK_HASH);
    const envelope2 = createMockEnvelope("0x" + "cc".repeat(32));9

    input.addPayloadEnvelope({
      envelope: envelope1,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 1,
    });

    expect(() =>
      input.addPayloadEnvelope({
        envelope: envelope2,
        source: PayloadEnvelopeInputSource.api,
        seenTimestampSec: 2,
      })
    ).not.toThrow();
  });
});