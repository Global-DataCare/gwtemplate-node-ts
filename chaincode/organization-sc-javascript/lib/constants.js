/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const ALLOWED_STATUS = new Set(["active", "suspended", "revoked"]);
const EVIDENCE_PREFIX = "evidence";
const ORGANIZATION_ASSET_LABEL = "Organization";

module.exports = {
  ALLOWED_STATUS,
  EVIDENCE_PREFIX,
  ORGANIZATION_ASSET_LABEL,
};
