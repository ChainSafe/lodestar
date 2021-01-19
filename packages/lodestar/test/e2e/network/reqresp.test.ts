import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {AbortController} from "abort-controller";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {LogLevel, sleep, WinstonLogger} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding} from "../../../src/constants";
import {BeaconMetrics} from "../../../src/metrics";
import {createPeerId, IReqRespOptions, Libp2pNetwork, NetworkEvent} from "../../../src/network";
import {GossipMessageValidator} from "../../../src/network/gossip/validator";
import {INetworkOptions} from "../../../src/network/options";
import {RequestError, RequestErrorCode} from "../../../src/network/reqresp/request";
import {silentLogger} from "../../utils/logger";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";
import {arrToSource, generateEmptySignedBlocks} from "../../unit/network/reqresp/utils";
import {generateEmptySignedBlock} from "../../utils/block";
import {expectRejectedWithLodestarError} from "../../utils/errors";

chai.use(chaiAsPromised);

describe("[network] network", function () {
  if (this.timeout() < 5000) this.timeout(5000);

  const multiaddr = "/ip4/127.0.0.1/tcp/0";
  const networkOptsDefault: INetworkOptions = {
    maxPeers: 1,
    minPeers: 1,
    bootMultiaddrs: [],
    rpcTimeout: 5000,
    connectTimeout: 5000,
    disconnectTimeout: 5000,
    localMultiaddrs: [],
  };
  const logger = new WinstonLogger({level: LogLevel.error});
  const metrics = new BeaconMetrics({enabled: true, timeout: 5000, pushGateway: false}, {logger});
  const validator = {} as GossipMessageValidator;
  const state = generateState();
  const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config});

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function createAndConnectPeers(reqRespOpts?: IReqRespOptions): Promise<[Libp2pNetwork, Libp2pNetwork]> {
    const peerIdB = await createPeerId();
    const [libP2pA, libP2pB] = await Promise.all([createNode(multiaddr), createNode(multiaddr, peerIdB)]);

    // Run tests with `DEBUG=true mocha ...` to get detailed logs of ReqResp exchanges
    const debugMode = process.env.DEBUG;
    const loggerA = debugMode ? new WinstonLogger({level: LogLevel.verbose, module: "A"}) : silentLogger;
    const loggerB = debugMode ? new WinstonLogger({level: LogLevel.verbose, module: "B"}) : silentLogger;

    const opts = {...networkOptsDefault, ...reqRespOpts};
    const netA = new Libp2pNetwork(opts, {config, libp2p: libP2pA, logger: loggerA, metrics, validator, chain});
    const netB = new Libp2pNetwork(opts, {config, libp2p: libP2pB, logger: loggerB, metrics, validator, chain});
    await Promise.all([netA.start(), netB.start()]);

    const connected = Promise.all([
      new Promise((resolve) => netA.on(NetworkEvent.peerConnect, resolve)),
      new Promise((resolve) => netB.on(NetworkEvent.peerConnect, resolve)),
    ]);
    await netA.connect(netB.peerId, netB.localMultiaddrs);
    await connected;

    afterEachCallbacks.push(async () => {
      await chain.close();
      await Promise.all([netA.stop(), netB.stop()]);
    });

    return [netA, netB];
  }

  it("should send/receive a ping message", async function () {
    const [netA, netB] = await createAndConnectPeers();

    const pingBody = BigInt(128);

    netB.reqResp.registerHandler(async function* (method, requestBody) {
      if (method === Method.Ping) {
        if (requestBody !== pingBody) throw Error(`Wrong requestBody ${requestBody} !== ${pingBody}`);
        yield pingBody;
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    const pingRes = await netA.reqResp.ping(netB.peerId, pingBody);
    expect(pingRes?.toString()).to.deep.equal(pingBody.toString(), "Wrong response body");
  });

  it("should send/receive a metadata message", async function () {
    const [netA, netB] = await createAndConnectPeers();

    const metadataBody = {
      seqNumber: netB.metadata.seqNumber,
      attnets: netB.metadata.attnets,
    };

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.Metadata) {
        yield metadataBody;
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    const metadata = await netA.reqResp.metadata(netB.peerId);
    expect(metadata).to.deep.equal(metadataBody, "Wrong response body");
  });

  it("should send/receive signed blocks", async function () {
    const [netA, netB] = await createAndConnectPeers();

    const count = 2;
    const blocks = generateEmptySignedBlocks(count);

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.BeaconBlocksByRange) {
        yield* arrToSource(blocks);
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    const returnedBlocks = await netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count});

    if (!returnedBlocks) throw Error("Returned null");
    expect(returnedBlocks).to.have.length(count, "Wrong returnedBlocks lenght");

    returnedBlocks.forEach((returnedBlock, i) => {
      expect(config.types.SignedBeaconBlock.equals(returnedBlock, blocks[i])).to.equal(
        true,
        `Wrong returnedBlock[${i}]`
      );
    });
  });

  it("should handle a server error", async function () {
    const [netA, netB] = await createAndConnectPeers();

    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";

    // eslint-disable-next-line require-yield
    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.Metadata) {
        throw Error(testErrorMessage);
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    await expectRejectedWithLodestarError(
      netA.reqResp.metadata(netB.peerId),
      new RequestError(
        {code: RequestErrorCode.SERVER_ERROR, errorMessage: testErrorMessage},
        {method: Method.Metadata, encoding: ReqRespEncoding.SSZ_SNAPPY, peer: netB.peerId.toB58String()}
      )
    );
  });

  it("should handle a server error after emitting two blocks", async function () {
    const [netA, netB] = await createAndConnectPeers();

    const testErrorMessage = "TEST_EXAMPLE_ERROR_1234";

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.BeaconBlocksByRange) {
        yield* arrToSource(generateEmptySignedBlocks(2));
        throw Error(testErrorMessage);
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 3}),
      new RequestError(
        {code: RequestErrorCode.SERVER_ERROR, errorMessage: testErrorMessage},
        {method: Method.BeaconBlocksByRange, encoding: ReqRespEncoding.SSZ_SNAPPY, peer: netB.peerId.toB58String()}
      )
    );
  });

  it("trigger a TTFB_TIMEOUT error", async function () {
    const controller = new AbortController();
    afterEachCallbacks.push(() => controller.abort());
    const TTFB_TIMEOUT = 250;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const [netA, netB] = await createAndConnectPeers({TTFB_TIMEOUT});

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.BeaconBlocksByRange) {
        // Wait for too long before sending first response chunk
        await sleep(TTFB_TIMEOUT * 10, controller.signal);
        yield generateEmptySignedBlock();
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 1}),
      new RequestError(
        {code: RequestErrorCode.TTFB_TIMEOUT},
        {method: Method.BeaconBlocksByRange, encoding: ReqRespEncoding.SSZ_SNAPPY, peer: netB.peerId.toB58String()}
      )
    );
  });

  it("trigger a RESP_TIMEOUT error", async function () {
    const controller = new AbortController();
    afterEachCallbacks.push(() => controller.abort());
    const RESP_TIMEOUT = 250;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const [netA, netB] = await createAndConnectPeers({RESP_TIMEOUT});

    netB.reqResp.registerHandler(async function* (method) {
      if (method === Method.BeaconBlocksByRange) {
        yield generateEmptySignedBlock();
        // Wait for too long before sending second response chunk
        await sleep(RESP_TIMEOUT * 5, controller.signal);
        yield generateEmptySignedBlock();
      } else {
        throw Error(`${method} not implemented`);
      }
    });

    await expectRejectedWithLodestarError(
      netA.reqResp.beaconBlocksByRange(netB.peerId, {startSlot: 0, step: 1, count: 2}),
      new RequestError(
        {code: RequestErrorCode.RESP_TIMEOUT},
        {method: Method.BeaconBlocksByRange, encoding: ReqRespEncoding.SSZ_SNAPPY, peer: netB.peerId.toB58String()}
      )
    );
  });
});
