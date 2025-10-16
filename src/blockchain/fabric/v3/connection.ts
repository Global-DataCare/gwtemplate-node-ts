// src/blockchain/fabric/v3/connection.ts

import env from 'env-var';

export const EnvConnectionOldPrefix = 'HLF_CONNECTION_PROFILE'; // deprecate
export const EnvConnectionPemPrefix = 'HLF_CONNECTION_PEM';
export const EnvPublicPemPrefix = 'HLF_CERTIFICATE';
export const EnvPrivatePemPrefix = 'HLF_PRIVATE_KEY';
export const EnvPeerPrefix = 'HLF_CONNECTION_PEER';

export function getConnectionTlsCertPemByMspId(mspId: string): string {
  const envVariableName = `${EnvConnectionPemPrefix}_${mspId}`;
  console.log(
    `---> getConnectionTlsCertPemByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );
  const resultString = env.get(envVariableName).asString();

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The PEM certificate for TLS connection "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString;
}

export function getConnectionPeerByMspId(mspId: string): string {
  const envVariableName = `${EnvPeerPrefix}_${mspId}`;
  console.log(
    `---> getConnectionPeerByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );

  const resultString = env.get(envVariableName).asString();
  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The peer connection "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString;
}

export function getPublicCertByMspId(mspId: string): string {
  const envVariableName = `${EnvPublicPemPrefix}_${mspId}`;
  console.log(
    `---> getPublicCertByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );
  const resultString = env.get(envVariableName).asString();

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The public PEM certificate "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString;
}

export function getPrivatePemKeyByMspId(mspId: string): string {
  const envVariableName = `${EnvPrivatePemPrefix}_${mspId}`;
  console.log(
    `---> getPrivatePemKeyByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );
  const resultString = env.get(envVariableName).asString();

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The private PEM key "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString;
}

export function getConnectionProfileOldByMspId(
  mspId: string
): Record<string, unknown> {
  const envVariableName = `${EnvConnectionOldPrefix}_${mspId}`;
  console.log(
    `---> getConnectionProfileByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );
  const connectionProfile = env.get(envVariableName).asString();

  if (!connectionProfile) {
    throw new Error(
      `!!! connection profile "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return JSON.parse(connectionProfile) as Record<string, unknown>;
}
