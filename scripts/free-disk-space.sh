#!/bin/bash

# For Github Actions - Free disk space
sudo swapoff -a
sudo rm -f /swapfile
sudo apt clean
docker rmi $(docker image ls -aq)
df -h