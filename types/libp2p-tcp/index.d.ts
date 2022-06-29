// Type definitions for libp2p-tcp 0.12.0
// Project: https://github.com/libp2p/js-libp2p-tcp
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare module "libp2p-tcp" {
  const tcp: import("libp2p-interfaces/src/transport/types").TransportFactory<any, any>;
  export default tcp;
}
