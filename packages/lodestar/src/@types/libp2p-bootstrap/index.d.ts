// Type definitions for libp2p-railing 0.9.1
// Project: https://github.com/libp2p/js-libp2p-bootstrap
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="multiaddr"/>
/// <reference types="peer-info"/>

declare namespace LibP2pBootstrap {
  type Options = {
    list: Array<string | Multiaddr.Multiaddr>,
    interval?: number
  };

  type Events = 'peer';
}

declare class LibP2pBootstrap {
  constructor (options: LibP2pBootstrap.Options);

  on (event: LibP2pBootstrap.Events, cb: (peerInfo: PeerInfo) => any): this;
}

declare module 'libp2p-bootstrap' {
export default LibP2pBootstrap;
}