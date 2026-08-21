/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const ORG_KEY_INDEX = "org~key";
const ALLOWED_STATUS = new Set(["active", "suspended", "revoked", "expired"]);
const CRYPTOGRAPHIC_KEY_ASSET_LABEL = "CryptographicKey";

module.exports = {
  ALLOWED_STATUS,
  CRYPTOGRAPHIC_KEY_ASSET_LABEL,
  ORG_KEY_INDEX,
};
