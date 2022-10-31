/* eslint-disable @typescript-eslint/naming-convention */
import {expect} from "chai";
import type {SecretKey, PublicKey} from "@chainsafe/bls/types";
import {DOMAIN_DEPOSIT, MAX_EFFECTIVE_BALANCE} from "@lodestar/params";
import {config} from "@lodestar/config/default";
import {computeDomain, computeSigningRoot, interopSecretKey, ZERO_HASH} from "@lodestar/state-transition";
import {ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {ErrorAborted} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis.js";
import {testLogger} from "../../../utils/logger.js";
import {ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {EthJsonRpcBlockRaw, IEth1Provider} from "../../../../src/eth1/interface.js";

describe("genesis builder", function () {
  const logger = testLogger();
  const schlesiConfig = Object.assign({}, config, {
    MIN_GENESIS_TIME: 1587755000,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 4,
    MIN_GENESIS_DELAY: 3600,
  });

  type MockData = {events: phase0.DepositEvent[]; blocks: EthJsonRpcBlockRaw[]};

  function generateGenesisBuilderMockData(): MockData {
    const events: phase0.DepositEvent[] = [];
    const blocks: EthJsonRpcBlockRaw[] = [];

    for (let i = 0; i < schlesiConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT; i++) {
      const secretKey = interopSecretKey(i);
      const publicKey = secretKey.toPublicKey();
      const event: phase0.DepositEvent = {
        depositData: generateDeposit(i, secretKey, publicKey),
        index: i,
        blockNumber: i,
      };
      events.push(event);
      // All blocks satisfy MIN_GENESIS_TIME, so genesis will happen when the min validator count is reached
      blocks.push({
        number: i.toString(16),
        hash: ZERO_HASH_HEX,
        timestamp: schlesiConfig.MIN_GENESIS_TIME + i.toString(16),
        // Extra un-used data for this test
        parentHash: "0x0",
        totalDifficulty: "0x0",
      });
    }

    return {events, blocks};
  }

  function getMockEth1Provider({events, blocks}: MockData, eth1Provider?: Partial<IEth1Provider>): IEth1Provider {
    return {
      deployBlock: events[0].blockNumber,
      getBlockNumber: async () => 2000,
      getBlockByNumber: async (number) => blocks[number as number],
      getBlocksByNumber: async (fromBlock, toBlock) =>
        blocks.filter((b) => parseInt(b.number) >= fromBlock && parseInt(b.number) <= toBlock),
      getBlockByHash: async () => null,
      getDepositEvents: async (fromBlock, toBlock) =>
        events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock),
      validateContract: async () => {
        return;
      },
      ...eth1Provider,
    };
  }

  it("should build genesis state", async () => {
    const mockData = generateGenesisBuilderMockData();
    const eth1Provider = getMockEth1Provider(mockData);

    const genesisBuilder = new GenesisBuilder({
      config: schlesiConfig,
      eth1Provider,
      logger,
      maxBlocksPerPoll: 1,
    });

    const {state} = await genesisBuilder.waitForGenesis();

    expect(state.validators.length).to.be.equal(schlesiConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT);
    expect(toHexString(state.eth1Data.blockHash)).to.be.equal(
      mockData.blocks[schlesiConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT - 1].hash
    );
  });

  it("should abort building genesis state", async () => {
    const mockData = generateGenesisBuilderMockData();
    const controller = new AbortController();
    const eth1Provider = getMockEth1Provider(mockData, {
      getDepositEvents: async (fromBlock, toBlock) => {
        controller.abort();
        return mockData.events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
      },
    });

    const genesisBuilder = new GenesisBuilder({
      config: schlesiConfig,
      eth1Provider,
      logger,
      signal: controller.signal,
      maxBlocksPerPoll: 1,
    });

    await expect(genesisBuilder.waitForGenesis()).to.rejectedWith(ErrorAborted);
  });
});

function generateDeposit(index: ValidatorIndex, secretKey: SecretKey, publicKey: PublicKey): phase0.DepositData {
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const depositMessage = {
    pubkey: publicKey.toBytes(),
    withdrawalCredentials: Buffer.alloc(32, index),
    amount: MAX_EFFECTIVE_BALANCE,
  };
  const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
  const signature = secretKey.sign(signingRoot);
  return {...depositMessage, signature: signature.toBytes()};
}
