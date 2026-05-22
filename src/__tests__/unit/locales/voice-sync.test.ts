// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/locales/voice-sync.test.ts

import fs from 'fs';
import path from 'path';

describe('Voice locales synchronization', () => {
  const localesDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../locales');
  const localeFiles = [
    'en-US/voice.json',
    'es-ES/voice.json',
  ];

  function readLocaleJson(localeFile: string) {
    const filePath = path.join(localesDir, localeFile);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  it('should have all keys synchronized across all locales', () => {
    const base = readLocaleJson('en-US/voice.json');
    const baseKeys = Object.keys(base).sort();
    const errors: string[] = [];

    for (const localeFile of localeFiles) {
      const locale = localeFile.split('/')[0];
      const json = readLocaleJson(localeFile);
      const keys = Object.keys(json).sort();
      const missing = baseKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !baseKeys.includes(k));
      if (missing.length > 0 || extra.length > 0) {
        errors.push(
          `Locale ${locale} is not synchronized.\n`
            + (missing.length > 0 ? `  Missing keys: ${missing.join(', ')}\n` : '')
            + (extra.length > 0 ? `  Extra keys: ${extra.join(', ')}\n` : ''),
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(`Locale synchronization errors:\n${errors.join('\n')}`);
    }
  });
});
