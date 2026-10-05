import {peerIdFromString} from "@libp2p/peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {ENR} from "@chainsafe/enr";
import {IpEndpoint} from "@chainsafe/lodestar-z/network";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

export type NativePeerAddress = {peerId: string; addresses: IpEndpoint[]};

export function parseNativePeerAddress(address: string): NativePeerAddress {
  if (typeof address !== "string" || address.length > 404)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "direct peer address length"});
  if (address.startsWith("enr:")) {
    const enr = ENR.decodeTxt(address);
    const id = enr.peerId.toString();
    const addresses = [enr.getLocationMultiaddr("quic4"), enr.getLocationMultiaddr("quic6")]
      .filter((address) => address !== undefined)
      .map((address) => parseNativeEndpoint(address.toString(), true));
    if (!addresses.length)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "direct peer has no QUIC address",
      });
    return {peerId: id, addresses};
  }
  const encoded = address.split("/p2p/")[1];
  if (!encoded)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "direct peer identity"});
  const id = peerIdFromString(encoded).toString();
  return {peerId: id, addresses: [parseNativeEndpoint(address, true, id)]};
}

export function parseNativeEndpoint(address: string, quic: boolean, peer?: string): IpEndpoint {
  if (typeof address !== "string" || address.length > 256)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "multiaddr length"});
  const components = multiaddr(address).getComponents();
  const [ip, udp, transport, identity] = components;
  const expected = quic ? (identity ? 4 : 3) : 2;
  if (
    components.length !== expected ||
    (ip?.name !== "ip4" && ip?.name !== "ip6") ||
    udp?.name !== "udp" ||
    (quic && transport?.name !== "quic-v1") ||
    (identity && (identity.name !== "p2p" || identity.value !== peer)) ||
    !ip.value ||
    !udp.value
  ) {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.CONFIGURATION,
      resource: `Unsupported native address ${address}`,
    });
  }
  return {
    family: ip.name === "ip4" ? 4 : 6,
    address: multiaddr(`/${ip.name}/${ip.value}`).bytes.slice(1),
    port: nativeInteger(Number(udp.value), "UDP port", 65535),
  };
}

export function nativeMultiaddr(endpoint: IpEndpoint): string {
  const ip = new Uint8Array(1 + endpoint.address.length);
  ip[0] = endpoint.family === 4 ? 4 : 41;
  ip.set(endpoint.address, 1);
  return `${multiaddr(ip)}/udp/${endpoint.port}/quic-v1`;
}
