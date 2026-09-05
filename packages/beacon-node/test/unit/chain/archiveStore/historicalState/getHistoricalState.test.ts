import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconStateView, createStateViewFactory} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {getHistoricalState} from "../../../../../src/chain/archiveStore/historicalState/getHistoricalState.js";
import {createHistoricalStateRegenMetrics} from "../../../../../src/chain/archiveStore/historicalState/metrics.js";
import {BeaconDb} from "../../../../../src/db/index.js";
import {RegistryMetricCreator} from "../../../../../src/metrics/index.js";
import {generateCachedState} from "../../../../utils/state.js";

describe("historical state factory", () => {
  it.each([false, true])("replays archived blocks with its setup factory, native=%s", async (native) => {
    const fixture = generateCachedState();
    fixture.genesisTime = 0;
    const config = fixture.config;
    const preState = new BeaconStateView(fixture);
    const advanced = preState.processSlots(1);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = advanced.getBeaconProposer(1);
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
    const expected = preState.computeNewStateRoot({block}, {});
    block.message.stateRoot = expected.newStateRoot;
    const dir = await mkdtemp(path.join(tmpdir(), "lodestar-historical-factory-"));
    const db = new BeaconDb(config, await LevelDbController.create({name: dir}, {logger: testLogger()}));
    try {
      await db.stateArchive.put(0, fixture);
      await db.blockArchive.add(block);
      const factory = createStateViewFactory(config, pubkeyCache, {native});
      const serialize = native
        ? undefined
        : vi.spyOn(ssz.phase0.SignedBeaconBlock, "serialize").mockImplementation(() => {
            throw new Error("TypeScript historical replay must not serialize blocks");
          });
      try {
        const result = await getHistoricalState(1, db, factory);
        expect(result).toEqual(expected.postState.serialize());
        expect(await getHistoricalState(0, db, factory)).toEqual(fixture.serialize());
      } finally {
        serialize?.mockRestore();
      }
    } finally {
      await db.close();
      await rm(dir, {recursive: true, force: true});
    }
  });

  it("exports historical request metrics without TypeScript STF metrics in native mode", async () => {
    const registry = new RegistryMetricCreator();
    const metrics = createHistoricalStateRegenMetrics(registry, false);
    metrics.regenRequestCount.inc();
    const text = await registry.metrics();
    expect(text).toContain("lodestar_historical_state_request_count 1");
    expect(text).not.toContain("lodestar_historical_state_stfn_");
  });
});
