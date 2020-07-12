#!/bin/bash

<<COMMENT
	Used by Whiteblock for simulated network testing.

	Based upon:
	https://github.com/whiteblock/dockerfiles/blob/a31b412d32d0384de12aa8392e43bac32837b6bc/ethereum/interop-example/launch/start.sh

	Here's an example script used for testing:

	./whiteblock_start.sh \
		--identity=55c7fc76505ddeb6cf750b1f9f43d6d12c1a53b77ada018a390d7592a7f36dbck \
		--peers=/ip4/192.168.0.1/tcp/9000 \
		--validator-keys=/tmp/keygen_10_validators.yaml \
		--gen-state=/tmp/genesis.ssz \
		--port=9008

	The example script was run in the target/release directory of lighthouse.
	The following change was made to this script:

		YAML_KEY_FILE="/tmp/keygen_10_validators.yaml"
COMMENT

# Flags
IDENTITY=""
PEERS=""
YAML_KEY_FILE="/tmp/keygen_10_validators.yaml"
GEN_STATE=""
PORT="8000"

# Constants
BEACON_LOG_FILE="/tmp/beacon.log"
VALIDATOR_LOG_FILE="/tmp/validator.log"

usage() {
    echo "--identity=<hex prepresentation of the priv key for libp2p>"
    echo "--peers=<peer>"
    echo "--validator-keys=<path to /launch/keys.yaml>"
    echo "--gen-state=<path to /launch/state.ssz>"
    echo "--port=<port>"
}

while [ "$1" != "" ];
do
    PARAM=`echo $1 | awk -F= '{print $1}'`
    VALUE=`echo $1 | sed 's/^[^=]*=//g'`

    case $PARAM in
        --identity)
            IDENTITY=$VALUE
            ;;
        --peers)
            [ ! -z "$PEERS" ] && PEERS+=","
	    PEERS+="$VALUE"
            ;;
        --validator-keys)
            VALIDATOR_KEYS=$VALUE
            ;;
        --gen-state)
            GEN_STATE=$VALUE
            ;;
        --port)
            PORT=$VALUE
            ;;
        --help)
            usage
            exit
            ;;
        *)
            echo "ERROR: unknown parameter \"$PARAM\""
            usage
            exit 1
            ;;
    esac
    shift
done

# wrap hex strings in quotes
REAL_VALIDATOR_KEYS=/tmp/keys.yaml
sed 's/0x/\"0x/g' $VALIDATOR_KEYS | sed 's/$/"/g' > $REAL_VALIDATOR_KEYS

yarn cli \
 	interop \
	-p minimal \
	--db l1 \
	-r \
	--multiaddrs /ip4/0.0.0.0/tcp/$PORT \
    --bootnodes $PEERS \
	--peer-id $IDENTITY \
	 -q $GEN_STATE \
	--validators-from-yaml-key-file $REAL_VALIDATOR_KEYS >> /tmp/beacon.log

trap 'trap - SIGTERM && kill 0' SIGINT SIGTERM EXIT

