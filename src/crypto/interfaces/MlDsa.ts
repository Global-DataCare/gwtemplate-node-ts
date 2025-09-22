/**
 *  level 2: privateKeySize = 2528, publicKeySize = 1312, signatureSize = 2420
 *  level 3: privateKeySize = 4000, publicKeySize = 1952, signatureSize = 3293
 *  level 5: privateKeySize = 4864, publicKeySize = 2592, signatureSize = 4595
 *  @see https://openquantumsafe.org/liboqs/algorithms/sig/dilithium.html
 */
;

// Size of a packed public key: 32 + PolyT1Size*K
export const MlDsaPubKeySizeLevel2 = 1312;
export const MlDsaPubKeySizeLevel3 = 1952;
export const MlDsaPubKeySizeLevel5 = 2592;

// Size of a packed private key : 32 + 32 + 32 + polyLeqEtaSize*(l+k) + PolyT0Size*K
export const MlDsaPrivKeySizeLevel2 = 2528;
export const MlDsaPrivKeySizeLevel3 = 4000;
export const MlDsaPrivKeySizeLevel5 = 4864;

// Size of a packed signature: l*polyLeGamma1Size + omega + k + 32
export const MlDsaSignatureSizeLevel2 = 2420;
export const MlDsaSignatureSizeLevel3 = 3293;
export const MlDsaSignatureSizeLevel5 = 4595;