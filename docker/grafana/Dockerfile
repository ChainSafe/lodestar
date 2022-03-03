# Same version as our ansible deployments, to minimize the diff in the dashboard on export
FROM grafana/grafana:8.4.2

COPY provisioning/ /etc/grafana/provisioning/
COPY provisioning/dashboards/*.json /provisioning/dashboards/
COPY grafana.ini /etc/grafana.ini

# Modified datasource to work with a network_mode: host
ARG DATASOURCE_FILE=./datasource.yml
COPY ${DATASOURCE_FILE} /etc/grafana/provisioning/datasources/datasource.yml

# Set GF_SECURITY_ADMIN_PASSWORD=your-password to the root .env file
ARG GF_SECURITY_ADMIN_PASSWORD
ENV GF_SECURITY_ADMIN_USER=admin \
  GF_SECURITY_ADMIN_PASSWORD=${GF_SECURITY_ADMIN_PASSWORD}

CMD [ \
  "--homepath=/usr/share/grafana", \
  "--config=/etc/grafana.ini", \
  "--packaging=docker", \
  "cfg:default.paths.data=/var/lib/grafana", \
  "cfg:default.log.mode=console", \
  "cfg:default.log.level=error" \
  ]