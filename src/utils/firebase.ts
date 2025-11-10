// src/utils/firebase.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as admin from 'firebase-admin';

let isFirebaseInitialized = false;

/**
 * Initializes the Firebase Admin SDK if it hasn't been initialized already.
 * This function is idempotent and safe to call multiple times.
 */
export function initializeFirebase(): void {
  if (isFirebaseInitialized) {
    return;
  }

  try {
    admin.initializeApp();
    isFirebaseInitialized = true;
    console.log('[FirebaseUtil] Firebase Admin SDK initialized successfully.');
  } catch (error: any) {
    // Firebase throws an error if you try to initialize an app that already exists.
    // We can safely ignore this specific error.
    if (error.code === 'app/duplicate-app') {
      isFirebaseInitialized = true;
      console.log('[FirebaseUtil] Firebase Admin SDK was already initialized.');
    } else {
      console.error('[FirebaseUtil] FATAL: Firebase Admin SDK initialization failed.', error);
      // For a real application, you might want to exit the process if Firebase is critical.
      process.exit(1);
    }
  }
}
