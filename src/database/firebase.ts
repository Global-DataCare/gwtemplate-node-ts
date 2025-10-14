// src/database/firebase.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import admin from 'firebase-admin';

export function initializeFirestoreDb(projectId: string, clientEmail: string, privateKey: string): FirebaseFirestore.Firestore {
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase credentials for initialization');
  }

  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  }, 'firestore-' + new Date().getTime()); 

  return app.firestore();
}

