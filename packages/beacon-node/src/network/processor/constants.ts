/**
 * Max distinct peers tracked per unknown block/payload root.
 * Normally we have 8 mesh peers per topic, and multi topics may point to the same root.
 * Having 32 peers per root seems enough to search for missing blocks/payloads.
 **/
export const MAX_PEERS_PER_ROOT = 32;
