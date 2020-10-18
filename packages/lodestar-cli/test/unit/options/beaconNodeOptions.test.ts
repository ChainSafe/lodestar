import {expect} from "chai";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {LogLevel} from "@chainsafe/lodestar-utils";
import {RecursivePartial} from "../../../src/util";
import {parseBeaconNodeArgs, IBeaconNodeArgs} from "../../../src/options/beaconNodeOptions";

describe("options / beaconNodeOptions", () => {
  it("Should parse BeaconNodeArgs", () => {
    // Cast to match the expected fully defined type
    const beaconNodeArgsPartial = {
      "api.rest.enabled": true,
      "eth1.enabled": true,
      "eth1.providerUrl": "http://my.node:8545",
      "logger.eth1.level": "debug",
      "metrics.enabled": true,
      "metrics.serverPort": 8765,
      "network.discv5.bootEnrs": ["enr:-somedata"],
      "sync.minPeers": 17,
    } as IBeaconNodeArgs;

    const expectedOptions: RecursivePartial<IBeaconNodeOptions> = {
      api: {
        rest: {
          enabled: true,
        },
      },
      eth1: {
        enabled: true,
        providerUrl: "http://my.node:8545",
      },
      logger: {
        eth1: {
          level: LogLevel.debug,
        },
      },
      metrics: {
        enabled: true,
        serverPort: 8765,
      },
      network: {
        discv5: {
          bootEnrs: ["enr:-somedata"],
        },
      },
      sync: {
        minPeers: 17,
      },
    };

    const options = parseBeaconNodeArgs(beaconNodeArgsPartial);
    const optionsWithoutUndefined = JSON.parse(JSON.stringify(options));
    expect(optionsWithoutUndefined).to.deep.equal(expectedOptions);
  });
});
