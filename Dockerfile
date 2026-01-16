# Stage 1: Builder
# This stage installs all dependencies, including devDependencies,
# and builds the TypeScript source code into JavaScript.
FROM node:22-alpine AS builder

# Define build argument for NPM_TOKEN
ARG NPM_TOKEN

# Set the working directory
WORKDIR /usr/src/gwtemplate-node-ts

# Copy local file-based dependencies into the build context.
COPY gdc-common-utils-ts /usr/src/gdc-common-utils-ts
COPY gdc-sdk-client-ts /usr/src/gdc-sdk-client-ts

# Copy package.json and package-lock.json
COPY gwtemplate-node-ts/package*.json ./

# Install all dependencies (including devDependencies needed for building)
RUN npm install

# Copy the source code
COPY gwtemplate-node-ts ./

# Build the TypeScript code
# Fail fast on type errors before emitting build output.
RUN npm run type-check
ENV EXTRA_TS_PATCH_DIRS=/usr/src/gdc-common-utils-ts/src,/usr/src/gdc-sdk-client-ts/src
RUN npm run build

# Stage 2: Production
# This stage creates the final, lean image for production.
FROM node:22-alpine

WORKDIR /usr/src/gwtemplate-node-ts

# Copy package.json and package-lock.json
COPY gwtemplate-node-ts/package*.json ./

# Copy local file-based dependencies into the runtime image.
COPY --from=builder /usr/src/gdc-common-utils-ts /usr/src/gdc-common-utils-ts
COPY --from=builder /usr/src/gdc-sdk-client-ts /usr/src/gdc-sdk-client-ts

# Install ONLY production dependencies
RUN npm install --omit=dev

# Copy the compiled code from the builder stage
COPY --from=builder /usr/src/gwtemplate-node-ts/build ./build

# Copy the swagger configuration file, which is required at runtime
COPY --from=builder /usr/src/gwtemplate-node-ts/swagger.config.cjs ./

# Copy the pre-generated swagger specification
COPY --from=builder /usr/src/gwtemplate-node-ts/swagger-spec.json ./

# Copy runtime scripts (used by the start command)
COPY --from=builder /usr/src/gwtemplate-node-ts/scripts ./scripts



# Expose the port the app runs on (assuming 3000, can be configured via .env)
EXPOSE 3000

# --- DEBUGGING STEP ---
# List the contents of the final working directory to verify that all files were copied correctly.
RUN ls -la

# The command to run the application
CMD [ "npm", "start" ]
