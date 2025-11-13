docker build --build-arg NPM_TOKEN=$(grep NPM_TOKEN .env.local | cut -d '=' -f2) -t gwtemplate .

