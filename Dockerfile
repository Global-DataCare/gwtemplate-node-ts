# Stage 1: Builder
# This stage installs all dependencies, including devDependencies,
# and builds the TypeScript source code into JavaScript.
FROM node:22-alpine AS builder

# Define build argument for NPM_TOKEN
ARG NPM_TOKEN

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies needed for building)
RUN npm install

# Copy the source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Stage 2: Production
# This stage creates the final, lean image for production.
FROM node:22-alpine

WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install ONLY production dependencies
RUN npm install --omit=dev

# Copy the compiled code from the builder stage
COPY --from=builder /usr/src/app/build ./build

# Copy the swagger configuration file, which is required at runtime
COPY --from=builder /usr/src/app/swagger.config.js ./

# Copy the pre-generated swagger specification
COPY --from=builder /usr/src/app/swagger-spec.json ./



# Expose the port the app runs on (assuming 3000, can be configured via .env)
EXPOSE 3000

# --- DEBUGGING STEP ---
# List the contents of the final working directory to verify that all files were copied correctly.
RUN ls -la

# The command to run the application
CMD [ "npm", "start" ]

