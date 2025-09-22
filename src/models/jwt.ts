// src/models/jwt.ts

import { JwsDetachedSignParts } from "./jws";

export interface JwtCompactParts extends JwsDetachedSignParts {
  payload: string,
}

export interface DataCompactJWT {
  protected: object, // header protected by the signature (compact does not have unprotected header but JSON JWT does)
  payload: object,
  signature?: Uint8Array,
}
