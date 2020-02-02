// Type definitions for libp2p-mplex 0.8.0
// Project: https://github.com/libp2p/js-libp2p-mplex
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare namespace LibP2pMplex {
  type Muxer = {};
}

declare interface LibP2pMplex {
  (conn: any, isListener: boolean): LibP2pMplex.Muxer;

  dialer (conn: any): LibP2pMplex.Muxer;
  listener (conn: any): LibP2pMplex.Muxer;

  muticodec: string;
}

declare module 'libp2p-mplex' {
const mplex: LibP2pMplex;

export default mplex;
}
