docker build --build-arg NPM_TOKEN=$(cat .env | grep NPM_TOKEN | cut -d '=' -f2) -t gateway-service-nodejs .
