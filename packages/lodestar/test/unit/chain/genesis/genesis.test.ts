import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {initBLS, Keypair, PrivateKey} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import {DepositData, ValidatorIndex} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {interopKeypair} from "@chainsafe/lodestar-validator/lib";
import {AbortController} from "abort-controller";
import {IDepositEvent, IEth1Provider, IEth1BlockHeader} from "../../../../src/eth1";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis";
import {ErrorAborted} from "../../../../src/util/errors";

chai.use(chaiAsPromised);

describe("genesis builder", function () {
  const schlesiConfig = Object.assign({}, {params: config.params}, config);
  schlesiConfig.params = Object.assign({}, config.params, {
    MIN_GENESIS_TIME: 1587755000,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 4,
    MIN_GENESIS_DELAY: 3600,
  });

  before(async function f() {
    try {
      await initBLS();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(e);
    }
  });

  function generateGenesisBuilderMockData(): {
    events: IDepositEvent[];
    keypairs: Keypair[];
    blocks: IEth1BlockHeader[];
  } {
    const events: IDepositEvent[] = [];
    const keypairs: Keypair[] = [];
    const blocks: IEth1BlockHeader[] = [];

    for (let i = 0; i < schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT; i++) {
      const keypair = new Keypair(PrivateKey.fromBytes(interopKeypair(i).privkey));
      const event: IDepositEvent = {depositData: generateDeposit(i, keypair), index: i, blockNumber: i};
      keypairs.push(keypair);
      events.push(event);
      // All blocks satisfy MIN_GENESIS_TIME, so genesis will happen when the min validator count is reached
      blocks.push({
        blockNumber: i,
        blockHash: Buffer.alloc(32, 0),
        timestamp: schlesiConfig.params.MIN_GENESIS_TIME + i,
      });
    }

    return {events, keypairs, blocks};
  }

  it("should build genesis state", async () => {
    const {blocks, events} = generateGenesisBuilderMockData();

    const eth1Provider: IEth1Provider = {
      deployBlock: events[0].blockNumber,
      getBlockNumber: async () => 2000,
      getBlock: async (number) => blocks[number],
      getDepositEvents: async (fromBlock, toBlock) =>
        events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= (toBlock || fromBlock)),
      validateContract: async () => {
        return;
      },
    };

    const genesisBuilder = new GenesisBuilder(schlesiConfig, {
      eth1Provider,
      logger: new WinstonLogger(),
      MAX_BLOCKS_PER_POLL: 1,
    });

    const {state} = await genesisBuilder.waitForGenesis();

    expect(state.validators.length).to.be.equal(schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT);
    expect(toHexString(state.eth1Data.blockHash)).to.be.equal(
      toHexString(blocks[schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT - 1].blockHash)
    );
  });

  it("should abort building genesis state", async () => {
    const {blocks, events} = generateGenesisBuilderMockData();
    const controller = new AbortController();

    const eth1Provider: IEth1Provider = {
      deployBlock: events[0].blockNumber,
      getBlockNumber: async () => 2000,
      getBlock: async (number) => blocks[number],
      getDepositEvents: async (fromBlock, toBlock) => {
        controller.abort();
        return events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= (toBlock || fromBlock));
      },
      validateContract: async () => {
        return;
      },
    };

    const genesisBuilder = new GenesisBuilder(schlesiConfig, {
      eth1Provider,
      logger: new WinstonLogger(),
      signal: controller.signal,
      MAX_BLOCKS_PER_POLL: 1,
    });

    await expect(genesisBuilder.waitForGenesis()).to.rejectedWith(ErrorAborted);
  });
});

function generateDeposit(index: ValidatorIndex, keypair: Keypair): DepositData {
  const domain = computeDomain(config, DomainType.DEPOSIT);
  const depositMessage = {
    pubkey: keypair.publicKey.toBytesCompressed(),
    withdrawalCredentials: Buffer.alloc(32, index),
    amount: BigInt(32) * BigInt("1000000000000000000"),
  };
  const signingRoot = computeSigningRoot(config, config.types.DepositMessage, depositMessage, domain);
  const signature = keypair.privateKey.signMessage(signingRoot);
  return {...depositMessage, signature: signature.toBytesCompressed()};
}
