import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {NativeStateViewError, NativeStateViewErrorCode} from "@lodestar/state-transition";
import {getHistoricalState} from "../../../../src/chain/archiveStore/historicalState/getHistoricalState.js";
import {type IBeaconDb} from "../../../../src/db/index.js";

describe("getHistoricalState", () => {
  it("fails before touching the database when nativeStateView is enabled", async () => {
    const stateArchive = {
      binaries: vi.fn(async () => []),
    } satisfies Pick<IBeaconDb["stateArchive"], "binaries">;
    const blockArchive = {
      valuesStream: vi.fn(async function* () {}),
    } satisfies Pick<IBeaconDb["blockArchive"], "valuesStream">;
    const db = {stateArchive, blockArchive} as unknown as IBeaconDb;
    const config = createBeaconConfig(chainConfig, new Uint8Array(32));

    const error = await getHistoricalState(1, config, db, true).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NativeStateViewError);
    if (!(error instanceof NativeStateViewError)) {
      return;
    }

    expect(error.type).toEqual({
      code: NativeStateViewErrorCode.NOT_IMPLEMENTED,
      context: "historical state regeneration",
    });
    expect(stateArchive.binaries).not.toHaveBeenCalled();
    expect(blockArchive.valuesStream).not.toHaveBeenCalled();
  });
});
