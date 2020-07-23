rm -rf .altona3
echo "Removed a.altona3"
./bin/lodestar beacon init --root-dir .altona3
echo "created altona3"
cp .altona3/beacon/enr.json .altona/beacon
echo "copied enr.json"
cp .altona3/beacon/peer-id.json .altona/beacon
echo "copied peer-id.json"
echo "done"
