#!/bin/bash
# set -e

source parse-args.sh
source "./fixed.vars"
source $devnetVars

currentDir=$(pwd)
setupConfigUrl=https://github.com/eth-clients/merge-testnets.git

configGitDir=$CONFIG_GIT_DIR

gethImage=$GETH_IMAGE
nethermindImage=$NETHERMIND_IMAGE

if [ ! -n "$dataDir" ] || [ ! -n "$devnetVars" ] || ([ "$elClient" != "geth" ] && [ "$elClient" != "nethermind" ] && [ "$elClient" != "ethereumjs" ] && [ "$elClient" != "besu" ]) 
then
  echo "usage: ./setup.sh --dataDir <data dir> --elClient <geth | nethermind | ethereumjs | besu> --devetVars <devnet vars file> [--dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\"]"
  echo "example: ./setup.sh --dataDir kiln-data --elClient nethermind --devnetVars ./kiln.vars --dockerWithSudo --withTerminal \"gnome-terminal --disable-factory --\""
  echo "Note: if running on macOS where gnome-terminal is not available, remove the gnome-terminal related flags."
  echo "example: ./setup.sh --dataDir kiln-data --elClient geth --devnetVars ./kiln.vars"
  exit;
fi


mkdir $dataDir && mkdir $dataDir/lodestar && mkdir $dataDir/geth && mkdir $dataDir/nethermind && mkdir $dataDir/ethereumjs && mkdir $dataDir/besu

if [ -n "$configGitDir" ]
then
  if [ ! -n "$(ls -A $dataDir/$configGitDir)" ]
  then
    cd $dataDir && git init && git remote add -f origin $setupConfigUrl && git config core.sparseCheckout true && echo "$configGitDir/*" >> .git/info/sparse-checkout && git pull --depth=1 origin main && cd $currentDir
  fi;

  if [ ! -n "$(ls -A $dataDir/$configGitDir)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/genesis.json)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/genesis.ssz)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/nethermind_genesis.json)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/el_bootnode.txt)" ] || [ ! -n "$(ls -A $dataDir/$configGitDir/bootstrap_nodes.txt)" ]
  then
    echo "Configuration directory not setup properly, remove the data directory and run again."
    echo "exiting ..."
    exit;
  else 
    echo "Configuration discovered!"
  fi;

  # Load the required variables from the config dir
  bootNode=$(cat $dataDir/$configGitDir/el_bootnode.txt)
  bootNode=($bootNode)
  bootNodeWithSpace=$(IFS=" " ; echo "${bootNode[*]}")
  bootNode=$(IFS=, ; echo "${bootNode[*]}")

  bootEnr=$(cat $dataDir/$configGitDir/bootstrap_nodes.txt)
  bootEnr=($bootEnr)
  bootEnr=$(IFS=" " ; echo "${bootEnr[*]}")

  depositContractDeployBlock=$(cat $dataDir/$configGitDir/deposit_contract_block.txt)

else
  echo "No configuration specified, assuming the configuration baked in the images and args appropriately set to use it!"
fi;


run_cmd(){
  execCmd=$1;
  if [ -n "$detached" ]
  then
    echo "running detached: $execCmd"
    eval "$execCmd"
  else
    if [ -n "$withTerminal" ]
    then
      execCmd="$withTerminal $execCmd"
    fi;
    echo "running: $execCmd &"
    eval "$execCmd" &
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
  dockerCmd="$dockerCmd --detach --restart unless-stopped"
else
  dockerCmd="$dockerCmd --rm"
fi;

if [ -n "$withTerminal" ]
then
  dockerCmd="$dockerCmd -it" 
fi;

platform=$(uname)

if [ $platform == 'Darwin' ]
then
  elDockerNetwork=""
else
  elDockerNetwork="--network host"
fi;

if [ "$elClient" == "geth" ]
then
  echo "gethImage: $GETH_IMAGE"
  $dockerExec pull $GETH_IMAGE

  elName="$DEVNET_NAME-geth"
  if [ ! -n "$(ls -A $dataDir/geth)" ] && [ -n "$configGitDir" ]
  then 
    echo "setting up geth directory"
    $dockerExec run --rm -v $currentDir/$dataDir/$configGitDir:/config -v $currentDir/$dataDir/geth:/data $GETH_IMAGE --datadir /data init /config/genesis.json
  fi;

  elCmd="$dockerCmd --name $elName $elDockerNetwork -v $currentDir/$dataDir:/data $GETH_IMAGE $GETH_EXTRA_ARGS"
  if [ -n "$configGitDir" ]
  then
    elCmd="$elCmd --bootnodes $EXTRA_BOOTNODES$bootNode"
  fi;

elif [ "$elClient" == "nethermind" ] 
then
  echo "nethermindImage: $NETHERMIND_IMAGE"
  $dockerExec pull $NETHERMIND_IMAGE

  elName="$DEVNET_NAME-nethermind"
  elCmd="$dockerCmd --name $elName $elDockerNetwork -v $currentDir/$dataDir:/data"
  if [ -n "$configGitDir" ]
  then
    elCmd="$elCmd -v $currentDir/$dataDir/$configGitDir:/config  $NETHERMIND_IMAGE --Init.ChainSpecPath=/config/nethermind_genesis.json --Discovery.Bootnodes $EXTRA_BOOTNODES$bootNode"
  else
    elCmd="$elCmd $NETHERMIND_IMAGE"
  fi;
  elCmd="$elCmd $NETHERMIND_EXTRA_ARGS"

elif [ "$elClient" == "ethereumjs" ] 
then
  echo "ethereumjsImage: $ETHEREUMJS_IMAGE"
  $dockerExec pull $ETHEREUMJS_IMAGE

  elName="$DEVNET_NAME-ethereumjs"
  elCmd="$dockerCmd --name $elName $elDockerNetwork -v $currentDir/$dataDir:/data"
  if [ -n "$configGitDir" ]
  then
    elCmd="$elCmd -v $currentDir/$dataDir/$configGitDir:/config  $ETHEREUMJS_IMAGE --bootnodes=$EXTRA_BOOTNODES$bootNode"
  else
    elCmd="$elCmd $ETHEREUMJS_IMAGE"
  fi;
  elCmd="$elCmd --datadir /data/ethereumjs --gethGenesis /config/genesis.json --jwt-secret /data/jwtsecret $ETHEREUMJS_EXTRA_ARGS "

elif [ "$elClient" == "besu" ] 
then
  echo "besuImage: $BESU_IMAGE"
  $dockerExec pull $BESU_IMAGE

  elName="$DEVNET_NAME-besu"
  elCmd="$dockerCmd --name $elName $elDockerNetwork -v $currentDir/$dataDir:/data"
  if [ -n "$configGitDir" ]
  then
    elCmd="$elCmd -v $currentDir/$dataDir/$configGitDir:/config  $BESU_IMAGE --genesis-file=/config/besu_genesis.json --bootnodes=$EXTRA_BOOTNODES$bootNode"
  else
    elCmd="$elCmd $BESU_IMAGE"
  fi;
  elCmd="$elCmd $BESU_IMAGE --data-path=/data --engine-jwt-secret=/data/jwtsecret $BESU_EXTRA_ARGS"
fi

echo "lodestarImage: $LODESTAR_IMAGE"
$dockerExec pull $LODESTAR_IMAGE

if [ $platform == 'Darwin' ]
then
  clDockerNetwork="--net=container:$elName"
else
  clDockerNetwork="--network host"
fi

clName="$DEVNET_NAME-lodestar"
clCmd="$dockerCmd --name $clName $clDockerNetwork -v $currentDir/$dataDir:/data"
# mount and use config
if [ -n "$configGitDir" ]
then
  clCmd="$clCmd -v $currentDir/$dataDir/$configGitDir:/config $LODESTAR_IMAGE beacon --paramsFile /config/config.yaml --genesisStateFile /config/genesis.ssz --eth1.depositContractDeployBlock $depositContractDeployBlock --bootnodesFile /config/boot_enr.yaml"
else
  clCmd="$clCmd $LODESTAR_IMAGE beacon"
fi;
clCmd="$clCmd $LODESTAR_EXTRA_ARGS"

valName="$DEVNET_NAME-validator"
valCmd="$dockerCmd --name $valName $clDockerNetwork -v $currentDir/$dataDir:/data"
# mount and use config
if [ -n "$configGitDir" ]
then
  valCmd="$valCmd -v $currentDir/$dataDir/$configGitDir:/config $LODESTAR_IMAGE validator --paramsFile /config/config.yaml"
else
  valCmd="$valCmd $LODESTAR_IMAGE validator"
fi;
valCmd="$valCmd $LODESTAR_VALIDATOR_ARGS"

echo -n $JWT_SECRET > $dataDir/jwtsecret
run_cmd "$elCmd"
elPid=$!
echo "elPid= $elPid"
terminalInfo="elPid= $elPid for $elName"

if [ $platform == 'Darwin' ]
then
   # hack to allow network stack of EL to be up before starting the CL on macOs. Waiting on pid does not work
   sleep 5
fi

run_cmd "$clCmd"
clPid=$!
echo "clPid= $clPid"
terminalInfo="$terminalInfo, clPid= $clPid for $clName"

if [ -n "$withValidator" ]
then 
  run_cmd "$valCmd"
  valPid=$!
  echo "valPid= $valPid"
  terminalInfo="$terminalInfo, valPid= $valPid for $elName"
else 
   # hack to assign clPid to valPid for joint wait later
   valPid=$clPid
fi;

cleanup() {
  echo "cleaning up"
  $dockerExec rm $elName -f
  $dockerExec rm $clName -f
  $dockerExec rm $valName -f
  elPid=null
  clPid=null
  valPid=null
}

trap "echo exit signal recived;cleanup" SIGINT SIGTERM

if [ ! -n "$detached" ] && [ -n "$elPid" ] && [ -n "$clPid" ] && ([ ! -n "$withValidator" ] || [ -n "$valPid" ] )
then 
	echo "launched terminals for $terminalInfo"
	echo "you can watch observe the client logs at the respective terminals"
	echo "use ctl + c on any of these (including this) terminals to stop the process"
	echo "waiting ..."
	if [ $platform == 'Darwin' ]
	then # macOs ships with an old version of bash with wait that does not have the -n flag
	  wait $elPid
	  wait $clPid
    wait $valPid
	else
	  wait -n  $elPid $clPid $valPid 
	fi
  echo "one of the el or cl process exited, stopping and cleanup"
	cleanup
fi;

# if its not detached and is here, it means one of the processes exited/didn't launch
if [ ! -n "$detached" ] && [ -n "$elPid$clPid$valPid" ]
then
	echo "one of the processes didn't launch properly"
	cleanup
fi;

if [ -n "$detached" ]
then  
  echo "launched detached containers: $terminalInfo"
else 
  echo "exiting ..."
fi;
