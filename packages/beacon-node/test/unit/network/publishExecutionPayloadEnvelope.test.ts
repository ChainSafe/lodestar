import {describe, expect, it, vi} from "vitest";
import {gloas, ssz} from "@lodestar/types";
import {publishExecutionPayloadEnvelopeAndColumns} from "../../../src/network/network.js";

describe("network - publishExecutionPayloadEnvelopeAndColumns", () => {
  const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
  const sidecars = Array.from({length: 4}, (_, index) => ({
    ...ssz.gloas.DataColumnSidecar.defaultValue(),
    index,
  }));
  const noPeersError = new Error("PublishError.NoPeersSubscribedToTopic");

  function getNetwork(failedColumns: number[] = []) {
    return {
      publishExecutionPayloadEnvelope: vi.fn().mockResolvedValue(1),
      publishDataColumnSidecar: vi.fn(async (sidecar: gloas.DataColumnSidecar) => {
        if (failedColumns.includes(sidecar.index)) throw noPeersError;
        return {sentPeers: 1, alreadyPublished: false};
      }),
    };
  }

  it("publishes the envelope first, then its data columns", async () => {
    const network = getNetwork();

    await expect(publishExecutionPayloadEnvelopeAndColumns(network, envelope, sidecars)).resolves.toEqual({
      envelopeError: null,
      columnErrors: new Map(),
    });

    expect(network.publishExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith(envelope);
    expect(network.publishDataColumnSidecar.mock.calls.map(([sidecar]) => sidecar.index)).toEqual([0, 1, 2, 3]);
    expect(network.publishExecutionPayloadEnvelope.mock.invocationCallOrder[0]).toBeLessThan(
      network.publishDataColumnSidecar.mock.invocationCallOrder[0]
    );
  });

  it("reports a data column that fails without failing the envelope or the other data columns", async () => {
    const network = getNetwork([2]);

    await expect(publishExecutionPayloadEnvelopeAndColumns(network, envelope, sidecars)).resolves.toEqual({
      envelopeError: null,
      columnErrors: new Map([[2, noPeersError]]),
    });

    expect(network.publishDataColumnSidecar).toHaveBeenCalledTimes(sidecars.length);
  });

  it("reports an envelope that fails without failing its data columns", async () => {
    const network = getNetwork();
    network.publishExecutionPayloadEnvelope.mockRejectedValue(noPeersError);

    await expect(publishExecutionPayloadEnvelopeAndColumns(network, envelope, sidecars)).resolves.toEqual({
      envelopeError: noPeersError,
      columnErrors: new Map(),
    });

    expect(network.publishDataColumnSidecar).toHaveBeenCalledTimes(sidecars.length);
  });

  it("reports a publish that throws synchronously as failed", async () => {
    const network = getNetwork();
    network.publishExecutionPayloadEnvelope.mockImplementation(() => {
      throw noPeersError;
    });

    await expect(publishExecutionPayloadEnvelopeAndColumns(network, envelope, [])).resolves.toEqual({
      envelopeError: noPeersError,
      columnErrors: new Map(),
    });
  });

  it("publishes only data columns if there is no envelope to publish", async () => {
    const network = getNetwork([0]);

    await expect(publishExecutionPayloadEnvelopeAndColumns(network, null, sidecars.slice(0, 2))).resolves.toEqual({
      envelopeError: null,
      columnErrors: new Map([[0, noPeersError]]),
    });

    expect(network.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(network.publishDataColumnSidecar).toHaveBeenCalledTimes(2);
  });
});
