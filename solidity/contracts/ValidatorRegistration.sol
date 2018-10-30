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
