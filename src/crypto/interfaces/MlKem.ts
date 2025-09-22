
export const paramsSymBytes = 32;

export const paramsPolyBytes = 384;
export const paramsPolyvecBytesK512 = 2 * paramsPolyBytes;
export const paramsPolyvecBytesK768 = 3 * paramsPolyBytes;
export const paramsPolyvecBytesK1024 = 4 * paramsPolyBytes;

/** Kyber512PKBytes is a constant representing the byte length of public keys in Kyber-512 */
export const Kyber512PKBytes = paramsPolyvecBytesK512 + paramsSymBytes;

/** Kyber768PKBytes is a constant representing the byte length of public keys in Kyber-768 */
export const Kyber768PKBytes = paramsPolyvecBytesK768 + paramsSymBytes;

/** Kyber1024PKBytes is a constant representing the byte length of public keys in Kyber-1024 */
export const Kyber1024PKBytes = paramsPolyvecBytesK1024 + paramsSymBytes;
