// Type definitions for libp2p-mdns 0.12.0
// Project: https://github.com/libp2p/js-libp2p-mdns
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

// import PeerDiscovery from 'libp2p-interfaces/src/peer-discovery/types';
// import { Multiaddr } from 'multiaddr';

// type PeerInfo = {
//   id: import("peer-id");
//   multiaddrs: Multiaddr[];
// };

// declare namespace LibP2pMdns {
//   type Options = {
//     broadcast?: boolean,
//     interval?: number,
//     peerInfo: PeerInfo,
//     port?: number,
//     serviceTag?: string
//   };

//   type Events = 'peer';
// }

// declare class LibP2pMdns extends PeerDiscovery {
//   constructor (options: LibP2pMdns.Options);

//   on (event: LibP2pMdns.Events, cb: (peerInfo: PeerInfo) => any): this;
// }

// declare module 'libp2p-mdns' {
//   export default LibP2pMdns;
// }

declare module "libp2p-mdns" {
  import {PeerDiscoveryFactory} from "libp2p-interfaces/src/peer-discovery/types";

  const mdns: PeerDiscoveryFactory;
  export default mdns;
}
