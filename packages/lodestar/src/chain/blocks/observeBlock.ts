import {SeenAttesters} from "../seenCache";

// TODO abstract out the Seen* caches into an abstract abstract data structure
// that all the caches can extend since they share similar structure.
export class ObservedProposers extends SeenAttesters {}
export class ObservedAttesters extends SeenAttesters {}
