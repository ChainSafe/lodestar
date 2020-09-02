import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {Eth1EventsBlock, EthersEth1Notifier, IDepositEvent} from "../../../../src/eth1";
import {ethers} from "ethers";
import pushable from "it-pushable";
import {interopKeypair} from "@chainsafe/lodestar-validator/lib";
import {initBLS, Keypair, PrivateKey} from "@chainsafe/bls";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import {DepositData, ValidatorIndex} from "@chainsafe/lodestar-types";
import {GenesisBuilder} from "../../../../src/chain/genesis/genesis";
import {StubbedBeaconDb} from "../../../utils/stub";
import {expect} from "chai";
import {toHexString} from "@chainsafe/ssz";
import {silentLogger} from "../../../utils/logger";

describe("genesis builder", function () {
  const schlesiConfig = Object.assign({}, {params: config.params}, config);
  schlesiConfig.params = Object.assign({}, config.params, {
    MIN_GENESIS_TIME: 1587755000,
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: 4,
    MIN_GENESIS_DELAY: 3600,
  });
  const sandbox = sinon.createSandbox();
  let genesisBuilder: GenesisBuilder;
  let eth1Stub: SinonStubbedInstance<EthersEth1Notifier>;
  let dbStub: StubbedBeaconDb;
  const events: IDepositEvent[] = [];
  const keypairs: Keypair[] = [];

  before(async function f() {
    try {
      await initBLS();
    } catch (e) {
      console.log(e);
    }
  });

  beforeEach(() => {
    for (let i = 0; i < schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT; i++) {
      keypairs.push(new Keypair(PrivateKey.fromBytes(interopKeypair(i).privkey)));
      const event = {...generateDeposit(i), index: i, blockNumber: i};
      events.push(event);
    }

    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);
    dbStub = new StubbedBeaconDb(sandbox);
    genesisBuilder = new GenesisBuilder(schlesiConfig, {
      eth1: eth1Stub,
      db: dbStub,
      logger: silentLogger,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should build genesis state", async () => {
    const eth1Source = pushable<Eth1EventsBlock>();
    eth1Stub.getEth1BlockAndDepositEventsSource.resolves(eth1Source);

    const statePromise = genesisBuilder.waitForGenesis();
    // push 2 first events at the same time first
    eth1Source.push({events: [events[0], events[1]]});
    for (let i = 2; i < schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT - 1; i++) {
      eth1Source.push({events: [events[i]]});
    }
    const lastEventIndex = schlesiConfig.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT - 1;
    const block = {
      number: lastEventIndex,
      timestamp: Math.floor(Date.now() / 1000),
      hash: "0x54b9f905f15634d966690bd362381cfd7a28362d683f8d1616aa478b575152f8",
    } as ethers.providers.Block;
    eth1Source.push({events: [events[lastEventIndex]], block});

    const state = await statePromise;
    expect(state.validators.length).to.be.equal(4);

    expect(toHexString(state.eth1Data.blockHash)).to.be.equal(
      "0x54b9f905f15634d966690bd362381cfd7a28362d683f8d1616aa478b575152f8"
    );
  });

  function generateDeposit(index: ValidatorIndex): DepositData {
    const domain = computeDomain(config, DomainType.DEPOSIT);
    const depositMessage = {
      pubkey: keypairs[index].publicKey.toBytesCompressed(),
      withdrawalCredentials: Buffer.alloc(32, index),
      amount: BigInt(32 * 1000000000000000000),
    };
    const signingRoot = computeSigningRoot(config, config.types.DepositMessage, depositMessage, domain);
    const signature = keypairs[index].privateKey.signMessage(signingRoot);
    return {...depositMessage, signature: signature.toBytesCompressed()};
  }
});
