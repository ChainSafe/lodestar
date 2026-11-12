import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {verifyBlocksSignatures} from "../../../../src/chain/blocks/verifyBlocksSignatures.js";
import {IBlsVerifier} from "../../../../src/chain/bls/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

vi.mock("@lodestar/state-transition", async (importActual) => ({
  ...(await importActual<typeof import("@lodestar/state-transition")>()),
  getBlockSignatureSets: () => [],
}));

const unhandled = vi.fn();
beforeEach(() => {
  process.on("unhandledRejection", unhandled);
});
afterEach(() => {
  process.off("unhandledRejection", unhandled);
  unhandled.mockReset();
});

it("handles a verification that rejects while later blocks are still being submitted", async () => {
  const failure = new Error("verifier closed");
  let calls = 0;
  // Not a vi.fn: mocks observe the promises they return, which would mark the rejection as handled
  const verifySignatureSets: IBlsVerifier["verifySignatureSets"] = () => {
    calls++;
    return Promise.reject(failure);
  };
  // More than 8 blocks, so the submission loop yields to the event loop before attaching handlers
  const blocks = Array.from({length: 9}, () => ssz.phase0.SignedBeaconBlock.defaultValue());
  await expect(
    verifyBlocksSignatures(
      createBeaconConfig(defaultConfig, new Uint8Array(32)),
      {verifySignatureSets} as Partial<IBlsVerifier> as IBlsVerifier,
      getMockedLogger(),
      null,
      {forkName: "phase0"} as IBeaconStateView,
      blocks,
      blocks.map(() => []),
      {}
    )
  ).rejects.toBe(failure);
  // unhandledRejection is emitted after the microtask queue drains
  await new Promise((resolve) => setImmediate(resolve));
  expect(calls).toBe(9);
  expect(unhandled).not.toHaveBeenCalled();
});
