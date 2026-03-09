import {generateKeyPair} from "@libp2p/crypto/keys";
import {multiaddr} from "@multiformats/multiaddr";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {ssz} from "@lodestar/types";
import {ENRKey, getENRForkID} from "../../../../src/network/metadata.js";
import {ENRRelevance, enrRelevance} from "../../../../src/network/discv5/utils.js";
import {config} from "../../../utils/config.js";
import {ClockStatic} from "../../../utils/clock.js";

describe("network / discv5 / enrRelevance", () => {
  const clock = new ClockStatic(0);

  async function createEnr(opts: {tcp?: boolean; quic?: boolean; eth2?: boolean}): Promise<SignableENR> {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);

    if (opts.tcp) {
      enr.setLocationMultiaddr(multiaddr("/ip4/192.168.1.1/tcp/9000"));
    }
    if (opts.quic) {
      enr.setLocationMultiaddr(multiaddr("/ip4/192.168.1.1/udp/9001/quic-v1"));
    }
    if (opts.eth2) {
      const enrForkID = getENRForkID(config, 0);
      enr.set(ENRKey.eth2, ssz.phase0.ENRForkID.serialize(enrForkID));
    }

    return enr;
  }

  it("should return no_transport for ENR without tcp or quic", async () => {
    const enr = await createEnr({eth2: true});
    expect(enrRelevance(enr, config, clock)).toBe(ENRRelevance.no_transport);
  });

  it("should return relevant for ENR with tcp only", async () => {
    const enr = await createEnr({tcp: true, eth2: true});
    expect(enrRelevance(enr, config, clock)).toBe(ENRRelevance.relevant);
  });

  it("should return relevant for ENR with quic only", async () => {
    const enr = await createEnr({quic: true, eth2: true});
    expect(enrRelevance(enr, config, clock)).toBe(ENRRelevance.relevant);
  });

  it("should return relevant for ENR with both tcp and quic", async () => {
    const enr = await createEnr({tcp: true, quic: true, eth2: true});
    expect(enrRelevance(enr, config, clock)).toBe(ENRRelevance.relevant);
  });

  it("should return no_eth2 for ENR without eth2 field", async () => {
    const enr = await createEnr({tcp: true});
    expect(enrRelevance(enr, config, clock)).toBe(ENRRelevance.no_eth2);
  });

  it("should return unknown_forkDigest for ENR with unrecognized fork digest", async () => {
    const enr = await createEnr({tcp: true});
    // Set a fake eth2 field with an unknown fork digest
    const fakeEth2 = new Uint8Array(16);
    fakeEth2.set([0xff, 0xff, 0xff, 0xff], 0);
    enr.set(ENRKey.eth2, fakeEth2);
    expect(enrRelevance(enr, config, clock)).toBe(ENRRelevance.unknown_forkDigest);
  });
});
