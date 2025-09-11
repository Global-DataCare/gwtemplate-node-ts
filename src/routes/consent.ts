// src/routes/consent.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { getConsentRepository } from '../database/repositories';
import { verifyIdToken, Provider } from '../auth/verifyIdToken';

const router = express.Router();
const consentRepo = getConsentRepository();

router.post('/consent', async (req, res) => {
  const { idToken, provider, sector, serviceUrl } = req.body;

  try {
    if (!['google', 'apple'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    const { uid, email } = await verifyIdToken(provider as Provider, idToken);

    if (!uid || !email) {
      return res.status(400).json({ error: 'Unable to extract identity' });
    }

    await consentRepo.saveConsent({
      uid,
      userEmail: email,
      sector,
      serviceUrl,
      timestamp: Date.now(),
    });

    res.status(200).json({ message: 'Consent saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Invalid or expired ID token' });
  }
});

export default router;
