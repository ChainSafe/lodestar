/* eslint-disable @typescript-eslint/naming-convention */
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {SecretKey, PublicKey} from "@chainsafe/bls";
import {DOMAIN_DEPOSIT} from "@chainsafe/lodestar-params";
import {config} from "@chainsafe/lodestar-config/minimal";
import {
  computeDomain,
  computeSigningRoot,
  interopSecretKey,
  ZERO_HASH,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ValidatorIndex, phase0, ssz} from "@chainsafe/lodestar-types";
import {ErrorAborted} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {AbortController} from "abort-controller";
import {IEth1Provider} from "../../../../src/eth1";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis";
import {testLogger} from "../../../utils/logger";

chai.use(chaiAsPromised);

describe("genesis builder", function () {
  const logger = testLogger();
  const schlesiConfig = Object.assign({}, config, {
    MIN_GENESIS_TIME: 1587755000,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 4,
    MIN_GENESIS_DELAY: 3600,
  });

  function generateGenesisBuilderMockData(): {
    events: phase0.DepositEvent[];
    blocks: phase0.Eth1Block[];
  } {
    const events: phase0.DepositEvent[] = [];
    const blocks: phase0.Eth1Block[] = [];

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
        blockNumber: i,
        blockHash: Buffer.alloc(32, 0),
        timestamp: schlesiConfig.MIN_GENESIS_TIME + i,
      });
    }

    return {events, blocks};
  }

  it("should build genesis state", async () => {
    const {blocks, events} = generateGenesisBuilderMockData();

    const eth1Provider: IEth1Provider = {
      deployBlock: events[0].blockNumber,
      getBlockNumber: async () => 2000,
      getBlockByNumber: async (number) => blocks[number],
      getBlocksByNumber: async (fromBlock, toBlock) =>
        blocks.filter((b) => b.blockNumber >= fromBlock && b.blockNumber <= toBlock),
      getDepositEvents: async (fromBlock, toBlock) =>
        events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock),
      validateContract: async () => {
        return;
      },
    };

    const genesisBuilder = new GenesisBuilder({
      config: schlesiConfig,
      eth1Provider,
      logger,
      maxBlocksPerPoll: 1,
    });

    const {state} = await genesisBuilder.waitForGenesis();

    expect(state.validators.length).to.be.equal(schlesiConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT);
    expect(toHexString(state.eth1Data.blockHash)).to.be.equal(
      toHexString(blocks[schlesiConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT - 1].blockHash)
    );
  });

  it("should abort building genesis state", async () => {
    const {blocks, events} = generateGenesisBuilderMockData();
    const controller = new AbortController();

    const eth1Provider: IEth1Provider = {
      deployBlock: events[0].blockNumber,
      getBlockNumber: async () => 2000,
      getBlockByNumber: async (number) => blocks[number],
      getBlocksByNumber: async (fromBlock, toBlock) =>
        blocks.filter((b) => b.blockNumber >= fromBlock && b.blockNumber <= toBlock),
      getDepositEvents: async (fromBlock, toBlock) => {
        controller.abort();
        return events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
      },
      validateContract: async () => {
        return;
      },
    };

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
    amount: BigInt(32) * BigInt("1000000000000000000"),
  };
  const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
  const signature = secretKey.sign(signingRoot);
  return {...depositMessage, signature: signature.toBytes()};
}
