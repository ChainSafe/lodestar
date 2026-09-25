import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {fulu} from "@lodestar/types";
import {BlockInputColumns, BlockInputSource} from "../../../src/chain/blocks/blockInput/index.js";
import {BlockTrace} from "../../../src/chain/blockTrace/index.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {HttpRequestTimes} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {IExecutionEngine} from "../../../src/execution/index.js";
import {DataColumnEngineResult, getDataColumnSidecarsFromExecution} from "../../../src/util/execution.js";
import {ClockStopped} from "../../mocks/clock.js";
import {config, generateBlockWithColumnSidecars, slots} from "../../utils/blocksAndData.js";

describe("getDataColumnSidecarsFromExecution / block trace", () => {
  const slot = slots.fulu;

  /** Runs one getBlobs call whose engine stamps its transport times and answers `respond()` */
  async function run(respond: (blobs: fulu.BlobAndProofV2[]) => fulu.BlobAndProofV2[] | null) {
    const {block, blobs, columnSidecars, rootHex} = generateBlockWithColumnSidecars({
      forkName: ForkName.fulu,
      slot,
      returnBlobs: true,
    });
    if (blobs === undefined) throw Error("Missing generated blobs");
    const blobAndProofs = blobs.map((blob, row) => ({blob, proofs: columnSidecars.map((c) => c.kzgProofs[row])}));
    const input = BlockInputColumns.createFromBlock({
      forkName: ForkName.fulu,
      block,
      blockRootHex: rootHex,
      source: BlockInputSource.gossip,
      seenTimestampSec: Date.now() / 1000,
      daOutOfRange: false,
      sampledColumns: [0, 1, 2, 3],
      custodyColumns: [0, 1],
    });
    const trace = new BlockTrace(config, new ClockStopped(slot), null);
    trace.observeDataAvailable(input);
    const executionEngine = {
      getBlobs: async (_fork: ForkName, _hashes: Uint8Array[], _buffers?: Uint8Array[], times?: HttpRequestTimes) => {
        if (times) times.sent = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (times) times.received = performance.now();
        return respond(blobAndProofs);
      },
    } as unknown as IExecutionEngine;

    const result = await getDataColumnSidecarsFromExecution(
      config,
      executionEngine,
      new ChainEventEmitter(),
      input,
      null,
      undefined,
      trace
    );
    const {milestoneNames, slots: traced} = trace.getSnapshot();
    const root = traced[0].roots[0];
    const milestones = Object.fromEntries(milestoneNames.map((name, i) => [name, root.milestones[i]]));
    return {result, root, milestones};
  }

  it("records a null response with its request's transport times", async () => {
    const {result, root, milestones} = await run(() => null);
    expect(result).toBe(DataColumnEngineResult.NullResponse);
    expect(root.getBlobsResult).toBe("null");
    expect(root.dataAvailableVia).toBeNull();
    const {getblobs_request, getblobs_dispatch, getblobs_receipt, getblobs_response} = milestones;
    expect([getblobs_request, getblobs_dispatch, getblobs_receipt, getblobs_response]).not.toContain(null);
    expect((getblobs_receipt as number) - (getblobs_dispatch as number)).toBeGreaterThanOrEqual(5);
    expect(getblobs_response).toBeGreaterThanOrEqual(getblobs_receipt as number);
    expect(milestones.getblobs_usable).toBeNull();
  });

  it("records a full response and when its sidecars could satisfy availability", async () => {
    const {result, root, milestones} = await run((blobs) => blobs);
    expect(result).toBe(DataColumnEngineResult.SuccessResolved);
    expect(root.getBlobsResult).toBe("full");
    expect(milestones.getblobs_usable).toBeGreaterThanOrEqual(milestones.getblobs_response as number);
    expect(milestones.data_available).toBeGreaterThanOrEqual(milestones.getblobs_usable as number);
    expect(root.dataAvailableVia).toEqual({source: BlockInputSource.engine, reconstructable: false});
  });
});
