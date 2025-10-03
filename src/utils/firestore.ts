export const FabricV2 = 'FabricV2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const replaceDotsWithUnderscores = (obj: any): any => {
  return Object.keys(obj).reduce((acc, key) => {
    const newKey = key.replace(/\./g, '_'); // Reemplaza '.' por '_'
    const value = obj[key];

    // Si el valor es un objeto, aplica la función recursivamente
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      acc[newKey] = replaceDotsWithUnderscores(value);
    } else {
      acc[newKey] = value;
    }

    return acc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const replaceUnderscoresWithDots = (obj: Record<string, any>): Record<string, any> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = key.replace(/_/g, '.');
    newObj[newKey] = value;
  }
  return newObj;
}

