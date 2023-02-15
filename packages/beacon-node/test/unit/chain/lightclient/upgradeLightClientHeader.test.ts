import {expect} from "chai";
import {ssz, capella, altair, deneb, allForks} from "@lodestar/types";
import {ForkName, ForkSeq} from "@lodestar/params";
import {createIBeaconConfig, createIChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {upgradeLightClientHeader} from "@lodestar/light-client/spec";

describe("UpgradeLightClientHeader", function () {
  let capellaLCHeader: capella.LightClientHeader;
  let altairLCHeader: altair.LightClientHeader;
  let bellatrixLCHeader: altair.LightClientHeader;
  let denebLCHeader: deneb.LightClientHeader;
  let update: allForks.LightClientHeader[];
  let testSlots: number[];

  /* eslint-disable @typescript-eslint/naming-convention */
  const chainConfig = createIChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 2,
    CAPELLA_FORK_EPOCH: 3,
    EIP4844_FORK_EPOCH: 4,
  });

  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(function () {
    altairLCHeader = ssz.altair.LightClientHeader.defaultValue();
    capellaLCHeader = ssz.capella.LightClientHeader.defaultValue();
    denebLCHeader = ssz.deneb.LightClientHeader.defaultValue();
    bellatrixLCHeader = ssz.altair.LightClientHeader.defaultValue();

    update = [altairLCHeader, altairLCHeader, bellatrixLCHeader, capellaLCHeader, denebLCHeader];
    testSlots = [0, 10, 17, 25, 33];
  });

  for (let i = ForkSeq.altair; i < Object.values(ForkName).length; i++) {
    for (let j = i + 1; j < Object.values(ForkName).length; j++) {
      it(`Successful upgrade ${ForkName[ForkSeq[i] as ForkName]}=>${
        ForkName[ForkSeq[j] as ForkName]
      }`, async function () {
        update[i].beacon.slot = testSlots[i];
        update[j].beacon.slot = testSlots[i];

        const updatedHeader = upgradeLightClientHeader(config, ForkName[ForkSeq[j] as ForkName], update[i]);
        expect(updatedHeader).to.deep.equal(
          update[j],
          `${ForkName[ForkSeq[i] as ForkName]} -> ${ForkName[ForkSeq[j] as ForkName]}`
        );
      });
    }
  }

  for (let i = ForkSeq.altair; i < Object.values(ForkName).length; i++) {
    for (let j = i; j > 0; j--) {
      it(`Throw upgrade error ${ForkName[ForkSeq[i] as ForkName]}=>${
        ForkName[ForkSeq[j] as ForkName]
      }`, async function () {
        update[i].beacon.slot = testSlots[i];
        update[j].beacon.slot = testSlots[i];

        expect(() => {
          upgradeLightClientHeader(config, ForkName[ForkSeq[j] as ForkName], update[i]);
        }).to.throw(
          `Invalid upgrade request from headerFork=${ForkName[ForkSeq[i] as ForkName]} to targetFork=${
            ForkName[ForkSeq[j] as ForkName]
          }`
        );
      });
    }
  }
});
