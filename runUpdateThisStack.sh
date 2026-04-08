#!/bin/bash

mkdir -p ./_DATA/postgres
mkdir -p ./_DATA/uploads



sudo docker-compose down
sudo docker-compose up -d --build
