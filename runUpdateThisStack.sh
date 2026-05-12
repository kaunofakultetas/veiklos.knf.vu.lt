#!/bin/bash

mkdir -p ./_DATA/postgres
mkdir -p ./_DATA/uploads
mkdir -p ./_DATA/keycloak-db



sudo docker-compose down
sudo docker-compose up -d --build
