import {generateTomlConfig} from "../../../../src/lodestar/util/toml";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/src/node/options";
import {expect} from "chai";
import { BeaconNodeOptions } from "../../../../src/lodestar/node/options";

describe('toml configuration', function () {

  it('should generate toml config from configurable fields', function () {

    const config = generateTomlConfig(
      {
        db: {
          name: "test-db"
        },
        eth1: {
          depositContract: {
            //not configurable
            abi: []
          }
        }
      },
      BeaconNodeOptions
    ) as Partial<IBeaconNodeOptions>;
    expect(config.db.name).to.be.equal("test-db");
    expect(config.eth1).to.be.undefined;
  });

});
