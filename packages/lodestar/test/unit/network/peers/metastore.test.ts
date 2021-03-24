import {Libp2pPeerMetadataStore} from "../../../../src/network/peers/metastore";
import {config} from "@chainsafe/lodestar-config/minimal";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {ReqRespEncoding} from "../../../../src/constants";
import {expect} from "chai";
import PeerId from "peer-id";
import {phase0} from "@chainsafe/lodestar-types";
import MetadataBook from "libp2p/src/peer-store/metadata-book";
import ProtoBook from "libp2p/src/peer-store/proto-book";

describe("Libp2pPeerMetadataStore", function () {
  let metabookStub: SinonStubbedInstance<MetadataBook> & MetadataBook;

  const peerId = PeerId.createFromB58String("Qma9T5YraSnpRDZqRR4krcSJabThc8nwZuJV3LercPHufi");

  beforeEach(function () {
    let stored: Buffer;
    metabookStub = {
      data: new Map<string, Map<string, Buffer>>(),
      delete: sinon.stub(),
      deleteValue: sinon.stub(),
      get: sinon.stub(),
      getValue: sinon.stub().callsFake(() => {
        return stored;
      }) as SinonStub<[PeerId, string], Buffer>,
      // @ts-ignore
      set: sinon.stub().callsFake(
        (peerId: PeerId, key: string, value: Buffer): ProtoBook => {
          stored = value;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return (metabookStub as unknown) as ProtoBook;
        }
      ) as SinonStub<[PeerId, string, Buffer], ProtoBook>,
    };
  });

  it("can store and retrieve encoding", function () {
    const store = new Libp2pPeerMetadataStore(config, metabookStub);
    const value = ReqRespEncoding.SSZ_SNAPPY;
    store.encoding.set(peerId, value);
    const result = store.encoding.get(peerId);

    expect(result).to.be.equal(value);
  });

  it("can store and retrieve status", function () {
    const store = new Libp2pPeerMetadataStore(config, metabookStub);
    const value: phase0.Status = {
      finalizedEpoch: 1,
      finalizedRoot: Buffer.alloc(32, 1),
      forkDigest: Buffer.alloc(4),
      headRoot: Buffer.alloc(32, 2),
      headSlot: 10,
    };
    store.status.set(peerId, value);
    const result = store.status.get(peerId);

    expect(config.types.phase0.Status.equals(result as phase0.Status, value)).to.be.true;
  });

  it("can store and retrieve metadata", function () {
    const store = new Libp2pPeerMetadataStore(config, metabookStub);
    const value: phase0.Metadata = {
      attnets: Array.from({length: 64}, () => true),
      seqNumber: BigInt(20),
    };
    store.metadata.set(peerId, value);
    const result = store.metadata.get(peerId);

    expect(config.types.phase0.Metadata.equals(result as phase0.Metadata, value)).to.be.true;
  });

  it("can store and retrieve score", function () {
    const store = new Libp2pPeerMetadataStore(config, metabookStub);
    const value = 80;
    store.rpcScore.set(peerId, value);
    const result = store.rpcScore.get(peerId);

    expect(config.types.Number64.equals(result as number, value)).to.be.true;
  });
});
