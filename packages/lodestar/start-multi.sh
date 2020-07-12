nodes=$1
TOTAL_VALIDATORS=$2
range=$3
WWW=$4
BASE_URL=""

# Split the configuration into an array
VALIDATOR_ARRAY=(${range//,/ })
VALIDATOR_ARRAY_LENGTH=${#VALIDATOR_ARRAY[@]}

# Check for LAN
if [[ $WWW = "true" ]]; then
    echo "Using BASE_URL 0.0.0.0"
    BASE_URL="0.0.0.0"
else
    echo "Using BASE_URL 127.0.0.1"
    BASE_URL="127.0.0.1"
fi


# Sum the validator configuration
v_count=0
for i in "${VALIDATOR_ARRAY[@]}"; do 
    v_count=$[$v_count+$i]
done

# Check that the sum of validator configuration is equal to total number of validators
if [ $TOTAL_VALIDATORS -ne $v_count ]; then
    echo "Total validator count not equal to set! Total:" $TOTAL_VALIDATORS "Set:" $v_count
    exit
fi

# Ensure that the length of the validator configuration 
if [ $nodes -ne $VALIDATOR_ARRAY_LENGTH ]; then
    echo "Invalid validator set suppplied! Nodes:" $nodes "Validator Set:" $VALIDATOR_ARRAY_LENGTH 
    exit
fi

# Set gensis start time
START_TIME=$(date +%s)
BASE_PORT=3060

# The new-session needs to be created externally
tmux new-session -d -s interop "yarn cli interop -p minimal --db l0 -q $START_TIME,$TOTAL_VALIDATORS --multiaddrs /ip4/127.0.0.1/tcp/${BASE_PORT}0 -v ${VALIDATOR_ARRAY[0]} -r";
for (( i=1; i<$nodes; i++ )) do
    tmux split-window -v -t interop "yarn cli interop -p minimal --db l$i -q $START_TIME,$TOTAL_VALIDATORS --multiaddrs /ip4/127.0.0.1/tcp/$BASE_PORT$i -v ${VALIDATOR_ARRAY[$i-1]},${VALIDATOR_ARRAY[$i]} -r"
done

# Change the layout
tmux select-layout -t interop tiled

tmux attach -t interop 
