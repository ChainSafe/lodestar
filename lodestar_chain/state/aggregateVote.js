var exports = module.exports = {};

class AggregateVote {

    var fields = {
      'shardId' : 'int16',
      'shardBlockHash' : 'bytes32',
      'notaryBitfield' : 'bytes',
      'aggregateSig': ['int256']
    };

    var defaults = {
      'shardId' : 0,
      'shardBlockHash' : 'x00'.repeat(32),
      'notaryBitfield' : '',
      'aggregateSig': [0 , 0]
    };

    /*
    * Takes in an object with the fields that need to be initialized.
    * If a field is not initialized, it will use the default as in this.defaults
    */
    constructor(var toSet) {
      for (var key in fields) {
        if(fields.hasOwnProperty(key)) {
          if(toSet.hasOwnProperty(key)) {
            this.key = toSet.key;
          } else {
            this.key = defaults.key;
          }
        }
      }
    }

    // Returns the number of aggregate signatures
    const numAggregateSig() => {
      return this.aggregateSig.length;
    }
}

exports.AggregateVote = AggregateVote;
