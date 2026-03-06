import {describe, expect, it, vi} from "vitest";
import {phase0} from "@lodestar/types";
import {INetwork} from "../../../../src/network/interface.js";
import {requestByRange} from "../../../../src/sync/utils/downloadByRange.js";

describe("requestByRange", () => {
  it("waits for all in-flight requests to settle before rethrowing", async () => {
    let blobRequestSettled = false;

    const network = {
      sendBeaconBlocksByRange: vi.fn().mockRejectedValue(new Error("boom")),
      sendBlobSidecarsByRange: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              blobRequestSettled = true;
              resolve([]);
            }, 25);
          })
      ),
    } as unknown as INetwork;

    const requestPromise = requestByRange({
      network,
      peerIdStr: "peer-id",
      blocksRequest: {startSlot: 0, count: 1, step: 1} as phase0.BeaconBlocksByRangeRequest,
      blobsRequest: {startSlot: 0, count: 1},
    });

    await expect(requestPromise).rejects.toThrow("boom");
    expect(blobRequestSettled).toBe(true);
  });
});
