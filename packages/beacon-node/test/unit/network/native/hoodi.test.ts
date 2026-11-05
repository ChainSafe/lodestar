import {generateKeyPair} from "@libp2p/crypto/keys";
import {expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {genesisData, networksChainConfig} from "@lodestar/config/networks";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {createNativeConfig} from "../../../../src/network/core/native/config.js";
import {defaultNetworkOptions} from "../../../../src/network/options.js";
import {createSettlingNetwork} from "../../../utils/nativeSettlingNetwork.js";

it("starts on Hoodi before its scheduled Gloas fork", async () => {
  const key = await generateKeyPair("secp256k1");
  const scheduled = createBeaconConfig(networksChainConfig.hoodi, fromHex(genesisData.hoodi.genesisValidatorsRoot));
  const {application} = createNativeConfig(
    {...defaultNetworkOptions, tcp: false, localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"]},
    scheduled,
    key,
    Math.floor(Date.now() / 1000) - 120_000 * SLOTS_PER_EPOCH * (scheduled.SLOT_DURATION_MS / 1000),
    ssz.fulu.Status.defaultValue(),
    scheduled.CUSTODY_REQUIREMENT,
    3_000_000
  );
  const network = createSettlingNetwork(application);
  try {
    expect((await network.getIdentity()).metadata.custodyGroupCount).toBe(BigInt(scheduled.CUSTODY_REQUIREMENT));
  } finally {
    application.identitySecretKey.fill(0);
    await network.close();
  }
});
