var exports = module.exports = {};

class PartialCrossLinkRecord {
    var fields = {
      // What shard is the crosslink being made for
      'shardId' : 'int16',
      // Hash of the block
      'shardBlockHash' : 'bytes32',
      // Which of the elligible voters are voting for it (as a bitfield)
      'voterBitfield' : 'bytes'
    };

    var defaults = {};

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
    contrusctor(var toSet) {
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

exports.PartialCrossLinkRecord = PartialCrossLinkRecord;
