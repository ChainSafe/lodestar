import {attestationsCountAssertion} from "./attestationCountAssertion.js";
import {attestationParticipationAssertion} from "./attestationParticipationAssertion.js";
import {connectedPeerCountAssertion} from "./connectedPeerCountAssertion.js";
import {finalizedAssertion} from "./finalizedAssertion.js";
import {headAssertion} from "./headAssertion.js";
import {inclusionDelayAssertion} from "./inclusionDelayAssertion.js";
import {missedBlocksAssertion} from "./missedBlocksAssertion.js";
import {syncCommitteeParticipation} from "./syncCommitteeParticipation.js";

export const defaultAssertions = [
  inclusionDelayAssertion,
  attestationsCountAssertion,
  attestationParticipationAssertion,
  connectedPeerCountAssertion,
  finalizedAssertion,
  headAssertion,
  missedBlocksAssertion,
  syncCommitteeParticipation,
];
