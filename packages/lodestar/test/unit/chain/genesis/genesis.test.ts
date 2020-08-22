import {expect} from "chai";
import sinon from "sinon";
import {initBLS, Keypair, PrivateKey} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import {DepositData, ValidatorIndex} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {interopKeypair} from "@chainsafe/lodestar-validator/lib";
import {StubbedBeaconDb} from "../../../utils/stub";
import {IDepositEvent, IEth1Provider, IEth1Block} from "../../../../src/eth1";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis";

describe("genesis builder", function () {
  const schlesiConfig = Object.assign({}, {params: config.params}, config);
  schlesiConfig.params = Object.assign({}, config.params, {
    MIN_GENESIS_TIME: 1587755000,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 4,
    MIN_GENESIS_DELAY: 3600,
  });
  const sandbox = sinon.createSandbox();

  before(async function f() {
    try {
      await initBLS();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(e);
    }
  });

  it("should build genesis state", async () => {
    const events: IDepositEvent[] = [];
    const keypairs: Keypair[] = [];
    const blocks: IEth1Block[] = [];

    for (let i = 0; i < schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT; i++) {
      const keypair = new Keypair(PrivateKey.fromBytes(interopKeypair(i).privkey));
      const event = {...generateDeposit(i, keypair), index: i, blockNumber: i};
      keypairs.push(keypair);
      events.push(event);
      // All blocks satisfy MIN_GENESIS_TIME, so genesis will happen when the min validator count is reached
      blocks.push({
        number: i,
        timestamp: schlesiConfig.params.MIN_GENESIS_TIME + i,
        hash: `0x${String(i).padStart(64, "0")}`,
      });
    }

    const mockEth1Provider: IEth1Provider = {
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
      db: new StubbedBeaconDb(sandbox),
      eth1Provider: mockEth1Provider,
      logger: new WinstonLogger(),
    });

    const state = await genesisBuilder.waitForGenesis();

    expect(state.validators.length).to.be.equal(schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT);
    expect(toHexString(state.eth1Data.blockHash)).to.be.equal(
      blocks[schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT - 1].hash
    );
  });
});

function generateDeposit(index: ValidatorIndex, keypair: Keypair): DepositData {
  const domain = computeDomain(config, DomainType.DEPOSIT);
  const depositMessage = {
    pubkey: keypair.publicKey.toBytesCompressed(),
    withdrawalCredentials: Buffer.alloc(32, index),
    amount: BigInt(32 * 1000000000000000000),
  };
  const signingRoot = computeSigningRoot(config, config.types.DepositMessage, depositMessage, domain);
  const signature = keypair.privateKey.signMessage(signingRoot);
  return {...depositMessage, signature: signature.toBytesCompressed()};
}
