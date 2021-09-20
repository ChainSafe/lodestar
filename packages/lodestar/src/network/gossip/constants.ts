/**
 * @module network/gossip
 */

import {GossipEncoding} from "./interface";

export const GOSSIP_MSGID_LENGTH = 20;

/**
 * 4-byte domain for gossip message-id isolation of *valid* snappy messages
 */
export const MESSAGE_DOMAIN_VALID_SNAPPY = Buffer.from("01000000", "hex");

/**
 * 4-byte domain for gossip message-id isolation of *invalid* snappy messages
 */
export const MESSAGE_DOMAIN_INVALID_SNAPPY = Buffer.from("00000000", "hex");

export const DEFAULT_ENCODING = GossipEncoding.ssz_snappy;
