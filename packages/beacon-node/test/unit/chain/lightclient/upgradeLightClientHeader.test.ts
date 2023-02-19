import {describe, it, expect, beforeEach} from "vitest";
import {ssz, allForks} from "@lodestar/types";
import {ForkName, ForkSeq} from "@lodestar/params";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {upgradeLightClientHeader} from "@lodestar/light-client/spec";

describe("UpgradeLightClientHeader", function () {
  let lcHeaderByFork: Record<ForkName, allForks.LightClientHeader>;
  let testSlots: Record<ForkName, number>;

  /* eslint-disable @typescript-eslint/naming-convention */
  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 2,
    CAPELLA_FORK_EPOCH: 3,
    DENEB_FORK_EPOCH: 4,
  });

  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(function () {
    lcHeaderByFork = {
      phase0: ssz.altair.LightClientHeader.defaultValue(),
      altair: ssz.altair.LightClientHeader.defaultValue(),
      capella: ssz.capella.LightClientHeader.defaultValue(),
      bellatrix: ssz.altair.LightClientHeader.defaultValue(),
      deneb: ssz.deneb.LightClientHeader.defaultValue(),
      verge: ssz.verge.LightClientHeader.defaultValue(),
    };

    testSlots = {
      phase0: 0,
      altair: 10,
      bellatrix: 17,
      capella: 25,
      deneb: 33,
      verge: 41,
    };
  });

  for (let i = ForkSeq.altair; i < Object.values(ForkName).length; i++) {
    for (let j = i + 1; j < Object.values(ForkName).length; j++) {
      const fromFork = ForkName[ForkSeq[i] as ForkName];
      const toFork = ForkName[ForkSeq[j] as ForkName];

      it(`Successful upgrade ${fromFork}=>${toFork}`, function () {
        lcHeaderByFork[fromFork].beacon.slot = testSlots[fromFork];
        lcHeaderByFork[toFork].beacon.slot = testSlots[fromFork];

        const updatedHeader = upgradeLightClientHeader(config, toFork, lcHeaderByFork[fromFork]);
        expect(updatedHeader).toEqual(lcHeaderByFork[toFork]);
      });
    }
  }

  for (let i = ForkSeq.altair; i < Object.values(ForkName).length; i++) {
    for (let j = i; j > 0; j--) {
      const fromFork = ForkName[ForkSeq[i] as ForkName];
      const toFork = ForkName[ForkSeq[j] as ForkName];

      it(`Throw upgrade error ${fromFork}=>${toFork}`, function () {
        lcHeaderByFork[fromFork].beacon.slot = testSlots[fromFork];
        lcHeaderByFork[toFork].beacon.slot = testSlots[fromFork];

        expect(() => {
          upgradeLightClientHeader(config, toFork, lcHeaderByFork[fromFork]);
        }).toThrow(`Invalid upgrade request from headerFork=${fromFork} to targetFork=${toFork}`);
      });
    }
  }
});
