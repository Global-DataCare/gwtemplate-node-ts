// src/config.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Centralized configuration module.
 * Reads environment variables and provides them to the application.
 */

// Helper function to build the base URL dynamically
function buildApiBaseUrl(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const protocol = nodeEnv === 'production' ? 'https' : 'http';
  const hostname = process.env.API_HOSTNAME || 'localhost';
  const port = parseInt(process.env.PORT || '3000', 10);

  // Omit standard ports from the URL
  if ((protocol === 'http' && port === 80) || (protocol === 'https' && port === 443)) {
    return `${protocol}://${hostname}`;
  }

  return `${protocol}://${hostname}:${port}`;
}


export const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    apiHostname: process.env.API_HOSTNAME || 'localhost',
    apiBaseUrl: buildApiBaseUrl(),
    
    // Defines the primary database and storage provider.
    // Options: 'mem', 'mongodb', 'firestore'
    dbProvider: process.env.DB_PROVIDER || 'mem',

    // Defines the provider for the job queue.
    // Options: 'mem', 'redis', 'rabbitmq'
    queueProvider: process.env.QUEUE_PROVIDER || 'mem',

    // --- Provider-Specific Settings ---

    mongo: {
        uri: process.env.MONGO_URI,
        dbName: process.env.MONGO_DB_NAME || 'antifraudgw',
    },
  
    firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Ensure newlines are correctly parsed from the environment variable
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
  
    googleClientId: process.env.GOOGLE_CLIENT_ID,
};
