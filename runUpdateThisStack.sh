#!/bin/bash


# STEP 1: Create necessary files and directories
# ==============================================
mkdir -p ./_DATA/{postgres,uploads}
mkdir -p ./_LOGS/{backend,endpoint}
mkdir -p ./_SAML
sudo chown -R 1000:1000 ./_DATA
sudo chown -R 1000:1000 ./_LOGS
sudo chown -R 1000:1000 ./_SAML




# STEP 2: Run the stack
# =====================
sudo docker network create --subnet=172.18.0.0/24 external
sudo docker-compose down
sudo docker-compose up -d --build
