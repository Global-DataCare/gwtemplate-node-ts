export const exampleOffering = {
  id: 'tracker', type: 'Product', attributes: {
    category: 'devices', name: 'Example tracker', description: 'A monitoring device',
    manufacturer: { id: 'designer', name: 'Device designer' },
    offers: [{ id: 'offer-es', seller: { id: 'seller', name: 'Retail seller' }, eligibleRegions: [{ country: 'ES', regions: [] }],
      deliveryCountries: ['ES'], operationCountries: [], supportCountries: [], url: 'https://seller.example/product' }],
  },
};
