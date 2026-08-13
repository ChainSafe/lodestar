import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ephemeryChainConfig} from "@lodestar/config/networks";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getClient} from "../../../../src/beacon/client/lightclient.js";
import {Endpoints, getDefinitions} from "../../../../src/beacon/routes/lightclient.js";
import {getRoutes} from "../../../../src/beacon/server/lightclient.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/lightclient.js";

describe("beacon / lightclient", () => {
  runGenericServerTest<Endpoints>(
    createChainForkConfig({...defaultChainConfig, ELECTRA_FORK_EPOCH: 0}),
    getClient,
    getRoutes,
    testData
  );

  it("uses the runtime beacon config for ephemery lightclient serialization", () => {
    const genesisValidatorsRoot = Buffer.alloc(32, 1);
    const config = createBeaconConfig({...ephemeryChainConfig, ELECTRA_FORK_EPOCH: 0}, genesisValidatorsRoot);
    const definitions = getDefinitions(config);
    const update = ssz.electra.LightClientUpdate.defaultValue();
    update.attestedHeader.beacon.slot = SLOTS_PER_EPOCH;

    const serialized = definitions.getLightClientUpdatesByRange.resp.data.serialize([update], {
      versions: [ForkName.electra],
    });
    const forkDigest = ssz.ForkDigest.deserialize(serialized.subarray(8, 12));

    expect(Buffer.from(forkDigest)).toEqual(
      Buffer.from(config.forkBoundary2ForkDigest(config.getForkBoundaryAtEpoch(1)))
    );
  });
});
