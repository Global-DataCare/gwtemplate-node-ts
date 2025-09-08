// src/database/mongo.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { MongoClient, Db } from 'mongodb';
import { config } from '../config';

let dbInstance: Db | null = null;

export async function getMongoDb(): Promise<Db> {
  if (!dbInstance && config.dbProvider === 'mongodb') {
    if (!config.mongo.uri) throw new Error('Missing MONGO_URI in environment');

    const client = new MongoClient(config.mongo.uri);
    await client.connect();
    dbInstance = client.db(config.mongo.dbName);
  }

  return dbInstance!;
}