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

pragma solidity ^0.4.23;

contract ValidatorRegistration {

  event Deposit(bytes32 _pubkey, uint256 _withdrawal_shard_id, address _withdrawal_address, bytes32 _randao_commitment);

  mapping(bytes32 => bool) public used_pubkeys;

  function deposit(
    bytes32 _pubkey,
    uint256 _withdrawal_shard_id,
    address _withdrawal_address,
    bytes32 _randao_commitment
    ) public payable {
      require(msg.value == 32 ether);
      require(!used_pubkeys[_pubkey]);

      used_pubkeys[_pubkey] = true;

      emit Deposit(_pubkey, _withdrawal_shard_id, _withdrawal_address, _randao_commitment);
  }

}
