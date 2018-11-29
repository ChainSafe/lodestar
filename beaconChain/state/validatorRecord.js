var exports = module.exports = {};

class ValidatorRecord {
    var fields = {
      // The validator's public key
      'pubkey': 'int256',
      // What shard the validator's balance will be sent to after withdrawal
      'withdrawal_shard': 'int16',
      // And what address
      'withdrawal_address': 'address',
      // The validator's current RANDAO beacon commitment
      'randao_commitment': 'bytes32',
      // Slot the RANDAO commitment was last changed
      'randao_last_change': 'uint64',
      // Balance
      'balance': 'uint64',
      // Status code
      'status': 'uint8',
      // Slot when validator exited ( or 0)
      'exit_slot': 'uint64'
    };

    var defaults = {};

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
    constructor(var toSet) {
      for(var key in fields) {
        if(fields.hasOwnProperty(key)){
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }
    }
}

exports.ValidatorRecord = ValidatorRecord;
