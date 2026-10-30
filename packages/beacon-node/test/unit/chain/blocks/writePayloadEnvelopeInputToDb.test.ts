import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {writePayloadEnvelopeInputToDb} from "../../../../src/chain/blocks/writePayloadEnvelopeInputToDb.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("facade payload column persistence", () => {
  it("waits for reconstructed columns and never writes the envelope", async () => {
    const chain = getMockedBeaconChain();
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    const input = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 0,
      daOutOfRange: false,
    });
    const reconstructed = defer<gloas.DataColumnSidecar[]>();
    vi.spyOn(input, "hasComputedAllData").mockReturnValue(false);
    vi.spyOn(input, "waitForComputedAllData").mockReturnValue(reconstructed.promise);
    const putColumns = vi.fn().mockResolvedValue(undefined);
    const putEnvelope = vi.fn();
    Object.defineProperty(chain, "db", {
      value: {
        dataColumns: {putManyBinary: putColumns},
        executionPayloadEnvelope: {putBinary: putEnvelope, add: putEnvelope},
      },
    });
    Object.defineProperty(chain, "custodyConfig", {value: {custodyColumns: []}});
    const writing = writePayloadEnvelopeInputToDb.call(chain, input);
    expect(putColumns).not.toHaveBeenCalled();
    expect(putEnvelope).not.toHaveBeenCalled();
    reconstructed.resolve([]);
    await writing;
    expect(putColumns).toHaveBeenCalledExactlyOnceWith({slot: 0, blockRoot: blockRootHex}, []);
    expect(putEnvelope).not.toHaveBeenCalled();
  });
});
