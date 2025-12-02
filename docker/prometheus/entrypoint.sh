#!/bin/sh
sed -i 's/#BEACON_URL/'"$BEACON_URL"'/' /etc/prometheus/prometheus.yml
sed -i 's/#VC_URL/'"$VC_URL"'/' /etc/prometheus/prometheus.yml
cat /etc/prometheus/prometheus.yml
exec /bin/prometheus $*
