#!/bin/bash

# -d: Run the container in detached mode (in the background)
# --env-file ./.env.example: Load environment variables from the example file
# -p 8080:3000: Map port 8080 on the host to port 3000 in the container
# --name gwtemplate: Give the running container a convenient name
docker run -d --env-file ./.env.example -p 8080:3000 --name gwtemplate gwtemplate
