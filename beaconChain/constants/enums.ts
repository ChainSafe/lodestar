//Lodestar Chain
//Copyright (C) 2018 ChainSafe Systems

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// https://github.com/ethereum/eth2.0-specs/blob/master/specs/core/0_beacon-chain.md#constants

enum ValidatorStatusCodes {
  PENDING_ACTIVATION = 0,
  ACTIVE = 1,
  ACTIVE_PENDING_EXIT = 2,
  EXITED_WITHOUT_PENALTY = 3,
  EXITED_WITH_PENALTY = 4,
}

enum ValidatorRegistryDeltaFlags {
  ACTIVATION = 0,
  EXIT = 1,
}

enum SignatureDomains {
  DOMAIN_DEPOSIT = 0,
  DOMAIN_ATTESTATION = 1,
  DOMAIN_PROPOSAL = 2,
  DOMAIN_EXIT = 3,
}

export {
  SignatureDomains,
  ValidatorRegistryDeltaFlags,
  ValidatorStatusCodes,
};
