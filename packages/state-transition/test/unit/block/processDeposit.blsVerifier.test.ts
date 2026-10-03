import {beforeEach, describe, expect, it, vi} from "vitest";
import {BLS_VERIFIER_SET_TYPE, type BlsSignatureSet} from "@chainsafe/lodestar-z/bls-verifier";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";

const verifySignatureSetsMock = vi.hoisted(() => vi.fn<(sets: BlsSignatureSet[]) => boolean>());

vi.mock("@chainsafe/lodestar-z/bls-verifier", () => ({
  BLS_VERIFIER_MAX_BATCH_SIZE: 256,
  BLS_VERIFIER_SET_TYPE: {indexed: 0, aggregate: 1, single: 2},
  verifySignatureSets: verifySignatureSetsMock,
}));

import {verifyDepositSignatures} from "../../../src/block/processDeposit.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";

const config = createBeaconConfig(getConfig(ForkName.fulu), Buffer.alloc(32));

describe("verifyDepositSignatures Lodestar-Z verifier routing", () => {
  beforeEach(() => {
    verifySignatureSetsMock.mockReset();
  });

  it("routes deposit bytes through verifySignatureSets", () => {
    const [deposit] = generateBuilderPendingDeposits(config, 1, 4000);
    verifySignatureSetsMock.mockReturnValue(true);

    expect(verifyDepositSignatures(config, [deposit])).toEqual([true]);
    expect(verifySignatureSetsMock).toHaveBeenCalledWith([
      {
        type: BLS_VERIFIER_SET_TYPE.single,
        pubkey: deposit.pubkey,
        message: expect.any(Uint8Array),
        signature: deposit.signature,
      },
    ]);
  });

  it("falls back to individual verifier calls when a chunk is invalid", () => {
    const deposits = generateBuilderPendingDeposits(config, 2, 5000);
    verifySignatureSetsMock.mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(verifyDepositSignatures(config, deposits)).toEqual([true, false]);
    expect(verifySignatureSetsMock.mock.calls.map(([sets]) => sets.length)).toEqual([2, 1, 1]);
  });

  it("keeps verifier calls within the native batch limit", () => {
    const deposits = generateBuilderPendingDeposits(config, 257, 6000);
    verifySignatureSetsMock.mockReturnValue(true);

    expect(verifyDepositSignatures(config, deposits)).toEqual(new Array<boolean>(257).fill(true));
    expect(verifySignatureSetsMock.mock.calls.map(([sets]) => sets.length)).toEqual([256, 1]);
  });
});
