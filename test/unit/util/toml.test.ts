import {generateTomlConfig, validateConfig} from "../../../src/util/toml";
import {BeaconNodeOptions, IBeaconNodeOptions} from "../../../src/node/options";
import {expect} from "chai";

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

  it('should validate given toml config', function () {

    const validated = validateConfig(
      {
        db: {
          name: "test-db",
          randomConfig: "blem"
        },
        chain: {
          name: "notValid"
        }
      },
      BeaconNodeOptions
    );
    expect(validated.db.name).to.be.equal("test-db");
    expect(validated.db.randomConfig).to.be.undefined;
    expect(validated.chain.name).to.be.undefined;
  });

});
