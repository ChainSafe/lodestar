import {peerIdFromString} from "@libp2p/peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {base58btc} from "multiformats/bases/base58";
import {IpEndpoint} from "@chainsafe/lodestar-z/network";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

export function nativePeerId(peer: string): Uint8Array {
  if (typeof peer !== "string" || peer.length > 128)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "peer ID"});
  return peerIdFromString(peer).toMultihash().bytes;
}

export function hostPeerId(peer: Uint8Array): string {
  return peerIdFromString(base58btc.encode(peer).slice(1)).toString();
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
