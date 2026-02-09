// src/app.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import cors from 'cors';

export function createApp() {
  const app = express();

  // This block enables Cross-Origin Resource Sharing (CORS) for local development.
  // It allows the frontend running on localhost:8081 to communicate with the backend.
  // This is NOT enabled in production, where the frontend and backend are expected
  // to be served from the same origin or a properly configured CDN.
  if (process.env.NODE_ENV !== 'production') {
    const corsOptions = {
      // `origin`: Specifies which domains are allowed to make requests.
      // We lock it down to the specific port of the local frontend development server.
      origin: 'http://localhost:8081',

      // `methods`: A list of HTTP methods that are allowed.
      methods: 'GET,POST,OPTIONS',

      // `allowedHeaders`: A list of HTTP headers that the client is allowed to send.
      // This is critical. The browser's preflight `OPTIONS` request will ask for permission
      // for any "non-simple" headers.
      // - `Content-Type`: Necessary because the frontend sends `application/json`.
      // - `Authorization`: Necessary for the frontend to send the Bearer token for authenticated requests.
      // - `Accept`, `X-Requested-With`: Common headers sent by HTTP clients; including them makes the API more robust.
      allowedHeaders: 'Content-Type, Authorization, Accept, X-Requested-With',

      // `exposedHeaders`: A list of headers that the server is allowed to send back and that
      // the browser should expose to the frontend JavaScript code.
      // By default, browsers hide most headers from the client for security.
      // - `Location`: CRITICAL for the async polling pattern. The server responds to a `POST` with a `202 Accepted`
      //   and this header contains the URL the client must poll for the result.
      // - `Retry-After`: Sent with a `202 Accepted` to suggest how long the client should wait before polling.
      exposedHeaders: 'Location, Retry-After',
    };
    app.use(cors(corsOptions));
  }

  app.use(express.json({
    type: ['application/json', 'application/fhir+json', 'application/didcomm-plaintext+json'],
  }));

  return app;
}

export default createApp;
