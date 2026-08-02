import {describe, expect, it} from "vitest";
import {LightClientServerError, LightClientServerErrorCode, RespStatus} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {onLightClientUpdatesByRange} from "../../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";

// A light client server that has no update for any period: every lookup misses.
function createChain(): IBeaconChain {
  return {
    lightClientServer: {
      getUpdate: async (_period: number) => {
        // getUpdate performs async DB I/O in production; yield to keep the mock realistic.
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw new LightClientServerError(
          {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
          "no update available"
        );
      },
    },
  } as unknown as IBeaconChain;
}

describe("onLightClientUpdatesByRange", () => {
  it("rejects an out-of-range startPeriod with INVALID_REQUEST", async () => {
    await expect(
      Array.fromAsync(onLightClientUpdatesByRange({startPeriod: 2 ** 53, count: 2}, createChain()))
    ).rejects.toMatchObject({status: RespStatus.INVALID_REQUEST});
  });

  it("terminates for a startPeriod at the safe-integer boundary", async () => {
    // Number.MAX_SAFE_INTEGER passes the safe-integer guard; iterating the range must still resolve.
    const responses = await Array.fromAsync(
      onLightClientUpdatesByRange({startPeriod: Number.MAX_SAFE_INTEGER, count: 3}, createChain())
    );
    expect(responses).toEqual([]);
  });

  it("returns without error for a normal startPeriod when no updates are available", async () => {
    const responses = await Array.fromAsync(onLightClientUpdatesByRange({startPeriod: 5, count: 2}, createChain()));
    expect(responses).toEqual([]);
  });
});
