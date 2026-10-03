import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadImportError, importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {PayloadError, PayloadErrorCode} from "../../../../src/chain/blocks/payloadError.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("payload import error context", () => {
  it("attaches the facade input to a payload error returned by the engine", async () => {
    const chain = getMockedBeaconChain();
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: toRootHex(blockRoot),
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.byRange,
      seenTimestampSec: 0,
    });
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = blockRoot;
    envelope.message.payload.slotNumber = 1;
    payloadInput.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.byRange, seenTimestampSec: 0});
    const error = new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
    chain.beaconEngine.verifyExecutionPayloadEnvelope = vi.fn().mockRejectedValue(error);
    chain.executionEngine.notifyNewPayload = vi.fn<typeof chain.executionEngine.notifyNewPayload>().mockResolvedValue({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(new Uint8Array(32)),
      validationError: null,
    });

    const importing = importExecutionPayload.call(chain, payloadInput, DataAvailabilityStatus.Available);
    await expect(importing).rejects.toBeInstanceOf(PayloadImportError);
    await expect(importing).rejects.toMatchObject({payloadInput, type: error.type, message: error.message});
    expect("payloadInput" in error).toBe(false);
  });
});
