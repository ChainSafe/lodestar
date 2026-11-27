import {expect, it} from "vitest";
import {type IpEndpoint, createNativeNetwork} from "../src/network.js";
import {applicationConfig, discoveryConfig, startRuntime} from "./utils/network.js";

import {host} from "./utils/network-host.js";

const ip4: IpEndpoint = {address: Uint8Array.of(127, 0, 0, 1), family: 4, port: 0};
const ip6: IpEndpoint = {address: Uint8Array.from({length: 16}, (_, i) => Number(i === 15)), family: 6, port: 0};

it.each(
  [[], [ip4, ip4], [ip6, ip6], [ip4, ip6, ip4], Array<IpEndpoint>(2)].flatMap((bind) =>
    [false, true].map((discovery) => ({bind, discovery}))
  )
)("rejects malformed listener set before startup: %j", ({bind, discovery}) => {
  const config = applicationConfig();
  if (discovery) config.discovery = {...discoveryConfig().discovery, bind};
  else config.bind = bind;
  expect(() => startRuntime(config)).toThrow("InvalidNetworkConfig");
});

it.each([ip4, ip6, [ip4], [ip6], [ip4, ip6], [ip6, ip4]].map((bind) => ({bind})))(
  "owns and reports every configured listener: %j",
  async ({bind}) => {
    const config = applicationConfig();
    config.bind = bind;
    const values = Array.isArray(bind) ? bind : [bind];
    const runtime = createNativeNetwork(config, host());
    try {
      const identity = await runtime.getIdentity();
      const expected = values.map((endpoint) => endpoint.family).sort();
      expect(identity.localEndpoints.map((endpoint) => endpoint.family)).toEqual(expected);
      for (const endpoint of identity.localEndpoints) expect(endpoint.port).toBeGreaterThan(0);
      expect(identity.localEndpoint).toEqual(identity.localEndpoints[0]);
      identity.localEndpoints[0].address.fill(255);
      expect((await runtime.getIdentity()).localEndpoints[0].address).not.toEqual(identity.localEndpoints[0].address);
    } finally {
      await runtime.close();
    }
  }
);

it("rejects advertising IPv6 through IPv4-only discovery and unwinds startup", async () => {
  const config = discoveryConfig();
  config.bind = [ip4, ip6];
  config.discovery.fixed = {...config.discovery.fixed, ip6: ip6.address, quic6: 9001};
  expect(() => startRuntime(config, () => undefined)).toThrow("InvalidAdvertisement");
});
