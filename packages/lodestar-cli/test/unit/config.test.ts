import {IBeaconNodeOptions} from "@chainsafe/lodestar/src/node/options";
import {expect} from "chai";
import { BeaconNodeOptions } from "../../src/lodestar/node/options";
import {validateConfig} from "../../src/lodestar/util/config";

describe('configuration', function () {

  it('should validate given toml config', function () {

    const validated = validateConfig<Partial<IBeaconNodeOptions>>(
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
    // @ts-ignore
    expect(validated.db.randomConfig).to.be.undefined;
    expect(validated.chain.name).to.be.undefined;
  });

});
