import {generateKeyPair} from "@libp2p/crypto/keys";
import {multiaddr} from "@multiformats/multiaddr";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {getDiscv5Multiaddrs} from "../../../../src/network/libp2p/index.js";

describe("network / libp2p / getDiscv5Multiaddrs", () => {
  async function createEnrTxt(opts: {tcp?: boolean; quic?: boolean}): Promise<string> {
    const privateKey = await generateKeyPair("secp256k1");
    const enr = SignableENR.createFromPrivateKey(privateKey);
    if (opts.tcp) {
      enr.setLocationMultiaddr(multiaddr("/ip4/10.0.0.1/tcp/9000"));
    }
    if (opts.quic) {
      enr.setLocationMultiaddr(multiaddr("/ip4/10.0.0.1/udp/9001/quic-v1"));
    }
    return enr.encodeTxt();
  }

  it("should prefer quic multiaddr over tcp when quic is enabled", async () => {
    const enrTxt = await createEnrTxt({tcp: true, quic: true});
    const result = await getDiscv5Multiaddrs([enrTxt], true);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/quic-v1");
    expect(result[0]).not.toContain("/tcp/");
  });

  it("should prefer quic by default when available", async () => {
    const enrTxt = await createEnrTxt({tcp: true, quic: true});
    const result = await getDiscv5Multiaddrs([enrTxt]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/quic-v1");
    expect(result[0]).not.toContain("/tcp/");
  });

  it("should return tcp when quic is explicitly disabled", async () => {
    const enrTxt = await createEnrTxt({tcp: true, quic: true});
    const result = await getDiscv5Multiaddrs([enrTxt], false);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/tcp/");
    expect(result[0]).not.toContain("/quic-v1");
  });

  it("should skip ENRs with no transport at all", async () => {
    const enrTxt = await createEnrTxt({});
    const result = await getDiscv5Multiaddrs([enrTxt]);
    expect(result).toHaveLength(0);
  });

  it("should return quic-only ENR when quic is enabled", async () => {
    const enrTxt = await createEnrTxt({quic: true});
    const result = await getDiscv5Multiaddrs([enrTxt], true);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/quic-v1");
  });
});
