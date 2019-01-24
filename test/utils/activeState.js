class ActiveState {
    static get fields(){
        return [
            ['pendingAttestations', [AttestationRecord]],
            ['recentBlockHashes', ['bytes32']]

        ];
    }

    constructor(){
        this.pendingAttestations = [];
        this.recentBlockHashes = [];
    }
}

class AttestationRecord {
    static get fields(){
        return [
            ['attesterBitfield', 'bytes'],
            ['shardId', 'int32'],
            ['slotId', 'int32'],
        ]
    }

    constructor(slotId, shardId, attesterBitfield) {
        this.slotId = slotId || 0;
        this.shardId = shardId || 0;
        this.attesterBitfield = attesterBitfield || Buffer.from([]);
    }
}

exports.ActiveState = ActiveState;
exports.AttestationRecord = AttestationRecord;
