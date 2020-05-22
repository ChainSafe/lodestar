import {ethers} from "ethers";
import sinon from "sinon";
import {afterEach, beforeEach, describe, it} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {EthersEth1Notifier, IEth1Notifier, IDepositEvent} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {ILogger, LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IEth1Options} from "../../../src/eth1/options";
import pipe from "it-pipe";

describe("Eth1Notifier - using goerli known deployed contract", () => {

  let eth1Notifier: IEth1Notifier;
  let provider: ethers.providers.JsonRpcProvider;
  // Use topaz deposit contract
  // start 1 block before first deposit
  const opts: IEth1Options = {
    ...defaults,
    enabled: false,
    provider: {
      url: "https://goerli.prylabs.net",
      network: 5,
    },
    depositContract: {
      ...defaults.depositContract,
      deployedAt: 2524641,
      address: "0x5cA1e00004366Ac85f492887AAab12d0e6418876",
    }
  };
  const logger: ILogger = new WinstonLogger();

  // chain can't receive eth1Data that's not qualified genesis condition so we need this test config
  const testConfig = Object.assign({}, {params: config.params}, config);
  // 1586833385 is timestamp of the contract's block
  testConfig.params = Object.assign({}, config.params,
    {MIN_GENESIS_TIME: 1586833385, MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 1, ETH1_FOLLOW_DISTANCE: 0});

  beforeEach(async function () {

    this.timeout(0);
    logger.silent = true;
    logger.level = LogLevel.verbose;
    provider = new ethers.providers.JsonRpcProvider(opts.provider.url, opts.provider.network);
    eth1Notifier = new EthersEth1Notifier(
      {...opts, providerInstance: provider},
      {
        config: testConfig,
        logger,
      });
  });

  afterEach(async () => {
    await eth1Notifier.stop();
    logger.silent = false;
  });

  it("should process deposit events in batch", async function () {
    this.timeout(0);
    // process 2 blocks, should be 1 deposit
    const targetBlockNumber = opts.depositContract.deployedAt + 10;
    provider.getBlockNumber = sinon.stub().resolves(targetBlockNumber);
    await eth1Notifier.start();
    const eth1DataStream = await eth1Notifier.getDepositEventsByBlock(true);

    await pipe(eth1DataStream, async function(source: AsyncIterable<IDepositEvent[]>) {
      for await (const events of source) {
        // there is 1 deposit at opts.depositContract.deployedAt + 1 and 1 more at deployedAt + 9
        const blockNumbers = events.map(event => event.blockNumber);
        if (blockNumbers.includes(opts.depositContract.deployedAt + 1) &&
          blockNumbers.includes(opts.depositContract.deployedAt + 9)) {
          return;
        }
      }
    });
    await eth1Notifier.foundGenesis();
  });


});
