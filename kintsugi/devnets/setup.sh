#!/bin/bash
# set -e

source parse-args.sh
source ./devnet3.vars

currentDir=$(pwd)
setupConfigUrl=https://github.com/parithosh/consensus-deployment-ansible.git

configGitDir=$CONFIG_GIT_DIR

gethImage=$GETH_IMAGE
nethermindImage=$NETHERMIND_IMAGE

if [ ! -n "$dataDir" ] || [ ! -n "$devnetVars" ] || ([ "$elClient" != "geth" ] && [ "$elClient" != "nethermind" ]) 
then
  echo "usage: ./setup.sh --dataDir <data dir> --elClient <geth | nethermind> --devetVars <devnet vars file> [--dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\"]"
  echo "example: ./setup.sh --dataDir devnet3data --elClient nethermind --devnetVars ./devnet3.vars --dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\""
  exit;
fi


mkdir $dataDir && mkdir $dataDir/lodestar && mkdir $dataDir/$elClient && cd $dataDir && git init && git remote add -f origin $setupConfigUrl && git config core.sparseCheckout true && echo "$configGitDir/*" >> .git/info/sparse-checkout && git pull --depth=1 origin master && cd $currentDir

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

if [ "$elClient" == "geth" ]
then
  echo "gethImage: $GETH_IMAGE"
  echo "Client geth not supported, please try another, exiting ..."
  exit;
elif [ "$elClient" == "nethermind" ] 
then
  echo "nethermindImage: $NETHERMIND_IMAGE"
  elName="$DEVNET_NAME-nethermind"
  elCmd="$dockerCmd --rm --name $elName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/nethermind:/data $NETHERMIND_IMAGE --datadir /data  --Init.ChainSpecPath=/config/nethermind_genesis.json $NETHERMIND_EXTRA_ARGS"
fi

run_cmd "$elCmd"
elPid=$!
echo "elPid= $elPid"


echo "lodestarImage: $LODESTAR_IMAGE"
bootEnr=$(cat $dataDir/$configGitDir/bootstrap_nodes.txt)
clName="$DEVNET_NAME-lodestar"
clCmd="$dockerCmd --rm --name $clName --network host -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/lodestar:/data $LODESTAR_IMAGE beacon --rootDir /data --paramsFile /config/config.yaml --genesisStateFile /config/genesis.ssz --network.discv5.bootEnrs $bootEnr --network.connectToDiscv5Bootnodes --network.discv5.enabled true --eth1.enabled true --eth1.disableEth1DepositDataTracker true $LODESTAR_EXTRA_ARGS"

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
