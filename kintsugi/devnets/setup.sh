#!/bin/bash
set -e

source parse-args.sh
source ./devnet3.vars

currentDir=$(pwd)
setupConfigUrl=https://github.com/parithosh/consensus-deployment-ansible.git

configGitDir=$CONFIG_GIT_DIR

gethImage=$GETH_IMAGE
nethermindImage=$NETHERMIND_IMAGE
lodestarImage=$LODESTAR_IMAGE

if [ ! -n "$dataDir" ] || [ ! -n "$devnetVars" ] || ([ "$elClient" != "geth" ] && [ "$elClient" != "nethermind" ]) 
then
  echo "usage: ./setup.sh --dataDir <data dir> --elClient <geth | nethermind> --devetVars <devnet vars file> --dockerWithSudo (if your docker comands require sudo)"
  echo "example: ./setup.sh --dataDir devnet3data --elClient nethermind --devnetVars ./devnet3.vars"
  exit;
fi

if [ -n "$dockerWithSudo" ]
then 
  dockerCmd="sudo docker"
else 
  dockerCmd="docker"
fi;

mkdir $dataDir && mkdir $dataDir/lodestar && mkdir $dataDir/$elClient && cd $dataDir && git init && git remote add -f origin $setupConfigUrl && git config core.sparseCheckout true && echo "$configGitDir/*" >> .git/info/sparse-checkout && git pull --depth=1 origin master && cd $currentDir


bootEnr=$(cat $dataDir/$configGitDir/bootstrap_nodes.txt)


if [ "$elClient" == "geth" ]
then
  echo "gethImage: $gethImage"  
elif [ "$elClient" == "nethermind" ] 
then
  echo "nethermindImage: $nethermindImage"
  elName="$DEVNET_NAME-nethermind"
  elCmd="$dockerCmd run --rm --name $elName -it --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/nethermind:/data $nethermindImage --datadir /data --config kintsugi  --Init.ChainSpecPath=/config/nethermind_genesis.json $NETHERMIND_EXTRA_ARGS"
fi

echo "lodestarImage: $lodestarImage"

echo "running: $elCmd"
gnome-terminal --disable-factory -- $elCmd &
elPid=$!

echo "elPid= $elPid"



clName="$DEVNET_NAME-lodestar"
clCmd="$dockerCmd run --rm --name $clName -it --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/lodestar:/data $lodestarImage beacon --rootDir /data --paramsFile /config/config.yaml --genesisStateFile /config/genesis.ssz --network.discv5.bootEnrs $bootEnr --network.connectToDiscv5Bootnodes --network.discv5.enabled true --eth1.enabled true --eth1.disableEth1DepositDataTracker true $LODESTAR_EXTRA_ARGS"

echo "running: $clCmd"
gnome-terminal --disable-factory -- $clCmd &
clPid=$!

echo "clPid= $clPid"

cleanup() {
  echo "cleaning up"
  $dockerCmd rm $elName -f
  $dockerCmd rm $clName -f
  elPid=null
  clPid=null
  # Our cleanup code goes here
}

trap "echo exit signal recived;cleanup" SIGINT SIGTERM

if [ -n "$elPid" ] && [ -n "$clPid" ] 
then 
	echo "launched two terminals for el and cl clients with elPid: $elPid clPid: $clPid"
	echo "you can watch observe the client logs at the respective terminals"
	echo "use ctl + c on any of these three (including this) terminals to stop the process"
	echo "waiting ..."
	wait -n $elPid $clPid
	cleanup
fi;

if [ -n "$elPid$clPid" ]
then
	echo "one of the el or cl process exited, stopping and cleanup"
	cleanup
fi;
