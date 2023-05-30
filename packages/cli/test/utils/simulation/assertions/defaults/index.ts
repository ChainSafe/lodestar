import {attestationsCountAssertion} from "./attestation_count_assertion.js";
import {attestationParticipationAssertion} from "./attestation_participation_assertion.js";
import {connectedPeerCountAssertion} from "./connected_peer_count_assertion.js";
import {finalizedAssertion} from "./finalized_assertion.js";
import {headAssertion} from "./head_assertion.js";
import {inclusionDelayAssertion} from "./inclusion_delay_assertion.js";
import {missedBlocksAssertion} from "./missed_blocks_assertion.js";
import {syncCommitteeParticipationAssertion} from "./sync_committee_participation_assertion.js";

export const defaultAssertions = [
  inclusionDelayAssertion,
  attestationsCountAssertion,
  attestationParticipationAssertion,
  connectedPeerCountAssertion,
  finalizedAssertion,
  headAssertion,
  missedBlocksAssertion,
  syncCommitteeParticipationAssertion,
];
