#!/bin/bash
# set -e

source parse-args.sh
source $devnetVars

currentDir=$(pwd)
setupConfigUrl=https://github.com/eth-clients/merge-testnets.git

configGitDir=$CONFIG_GIT_DIR

gethImage=$GETH_IMAGE
nethermindImage=$NETHERMIND_IMAGE

if [ ! -n "$dataDir" ] || [ ! -n "$devnetVars" ] || ([ "$elClient" != "geth" ] && [ "$elClient" != "nethermind" ]) 
then
  echo "usage: ./setup.sh --dataDir <data dir> --elClient <geth | nethermind> --devetVars <devnet vars file> [--dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\"]"
  echo "example: ./setup.sh --dataDir kintsugi-data --elClient nethermind --devnetVars ./kintsugi.vars --dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\""
  exit;
fi


mkdir $dataDir && mkdir $dataDir/lodestar && mkdir $dataDir/geth && mkdir $dataDir/nethermind && cd $dataDir && git init && git remote add -f origin $setupConfigUrl && git config core.sparseCheckout true && echo "$configGitDir/*" >> .git/info/sparse-checkout && git pull --depth=1 origin main && cd $currentDir

if [ ! -n "$(ls -A $dataDir/$configGitDir)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/genesis.json)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/genesis.ssz)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/nethermind_genesis.json)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/el_bootnode.txt)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/bootstrap_nodes.txt)" ]
then
  echo "Configuration directory not setup properly, remove the data directory and run again."
  echo "exiting ..."
  exit;
else 
  echo "Configuration discovered!"
fi;

run_cmd(){
  execCmd=$1;
  if [ -n "$detached" ]
  then
    echo "running: $execCmd"
    $execCmd
  else
    if [ -n "$withTerminal" ]
    then
      execCmd="$withTerminal $execCmd"
    fi;
    echo "running: $execCmd &"
    $execCmd &
  fi;
}



if [ -n "$dockerWithSudo" ]
then 
  dockerExec="sudo docker"
else 
  dockerExec="docker"
fi;
dockerCmd="$dockerExec run"

if [ -n "$detached" ]
then 
  dockerCmd="$dockerCmd --detach"
fi;

if [ -n "$withTerminal" ]
then
  dockerCmd="$dockerCmd -it" 
fi;


bootNode=$(cat $dataDir/$configGitDir/el_bootnode.txt)
if [ "$elClient" == "geth" ]
then
  echo "gethImage: $GETH_IMAGE"
  $dockerExec pull $GETH_IMAGE
  elName="$DEVNET_NAME-geth"
  if [ ! -n "$(ls -A $dataDir/geth)" ]
  then 
    echo "setting up geth directory"
    $dockerExec run --rm -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/geth:/data $GETH_IMAGE --catalyst --datadir /data init /config/genesis.json
  fi;
  elCmd="$dockerCmd --rm --name $elName --network host -v $currentDir/$dataDir/geth:/data $GETH_IMAGE --bootnodes $EXTRA_BOOTNODES$bootNode --datadir /data $GETH_EXTRA_ARGS"
elif [ "$elClient" == "nethermind" ] 
then
  echo "nethermindImage: $NETHERMIND_IMAGE"
  $dockerExec pull $NETHERMIND_IMAGE
  elName="$DEVNET_NAME-nethermind"
  elCmd="$dockerCmd --rm --name $elName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/nethermind:/data $NETHERMIND_IMAGE --datadir /data  --Init.ChainSpecPath=/config/nethermind_genesis.json $NETHERMIND_EXTRA_ARGS --Discovery.Bootnodes $EXTRA_BOOTNODES$bootNode"
fi

echo "lodestarImage: $LODESTAR_IMAGE"
$dockerExec pull $LODESTAR_IMAGE
bootEnr=$(cat $dataDir/$configGitDir/bootstrap_nodes.txt)
clName="$DEVNET_NAME-lodestar"
clCmd="$dockerCmd --rm --name $clName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/lodestar:/data $LODESTAR_IMAGE beacon --rootDir /data --paramsFile /config/config.yaml --genesisStateFile /config/genesis.ssz --network.discv5.bootEnrs $bootEnr --network.connectToDiscv5Bootnodes --network.discv5.enabled true --eth1.enabled true --eth1.disableEth1DepositDataTracker true $LODESTAR_EXTRA_ARGS"


run_cmd "$elCmd"
elPid=$!
echo "elPid= $elPid"


run_cmd "$clCmd"
clPid=$!
echo "clPid= $clPid"

cleanup() {
  echo "cleaning up"
  $dockerExec rm $elName -f
  $dockerExec rm $clName -f
  elPid=null
  clPid=null
}

trap "echo exit signal recived;cleanup" SIGINT SIGTERM

if [ ! -n "$detached" ] && [ -n "$elPid" ] && [ -n "$clPid" ] 
then 
	echo "launched two terminals for el and cl clients with elPid: $elPid clPid: $clPid"
	echo "you can watch observe the client logs at the respective terminals"
	echo "use ctl + c on any of these three (including this) terminals to stop the process"
	echo "waiting ..."
	wait -n $elPid $clPid
  echo "one of the el or cl process exited, stopping and cleanup"
	cleanup
fi;

if [ ! -n "$detached" ] && [ -n "$elPid$clPid" ]
then
	echo "one of the el or cl processes didn't launch properly"
	cleanup
fi;

if [ -n "$detached" ]
then 
  echo "launched detached docker containers: $elName, $clName"
else 
  echo "exiting ..."
fi;
