// src/__tests__/unit/utils/offer.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { generateLicenseOffer } from '../../../utils/offer';
import { ClaimsOfferSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

describe('generateLicenseOffer', () => {
  const hostDid = 'did:web:host.example.com';
  const jurisdiction = 'es';
  const sector = 'health-care';
  const allowedPaymentMethods = ['Stripe', 'PayPal'];

  it('should generate a free "Tier XS" offer for 5 or fewer employees', () => {
    // Act
    const offerClaims = generateLicenseOffer(5, hostDid, jurisdiction, sector, allowedPaymentMethods);

    // Assert
    expect(offerClaims[ClaimsOfferSchemaorg.itemOfferedName]).toBe('License Tier XS');
    expect(offerClaims[ClaimsOfferSchemaorg.price]).toBe('0.00');
    expect(offerClaims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(5);
    expect(offerClaims[ClaimsOfferSchemaorg.identifier]).toContain('urn:cds:es:v1:health-care:product:org.schema:Offer:');
    expect(offerClaims[ClaimsOfferSchemaorg.serialNumber].split(',')).toHaveLength(5);
  });

  it('should generate a "Tier S" offer for 20 or fewer employees', () => {
    // Act
    const offerClaims = generateLicenseOffer(20, hostDid, jurisdiction, sector, allowedPaymentMethods);

    // Assert
    expect(offerClaims[ClaimsOfferSchemaorg.itemOfferedName]).toBe('License Tier S');
    expect(offerClaims[ClaimsOfferSchemaorg.price]).toBe('49.99');
    expect(offerClaims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(20);
    expect(offerClaims[ClaimsOfferSchemaorg.serialNumber].split(',')).toHaveLength(20);
  });

  it('should generate a "Tier M" offer for more than 20 employees', () => {
    // Act
    const offerClaims = generateLicenseOffer(21, hostDid, jurisdiction, sector, allowedPaymentMethods);

    // Assert
    expect(offerClaims[ClaimsOfferSchemaorg.itemOfferedName]).toBe('License Tier M');
    expect(offerClaims[ClaimsOfferSchemaorg.price]).toBe('99.99');
    expect(offerClaims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(21);
    expect(offerClaims[ClaimsOfferSchemaorg.serialNumber].split(',')).toHaveLength(21);
  });

  it('should include all required offer claims', () => {
    // Act
    const offerClaims = generateLicenseOffer(1, hostDid, jurisdiction, sector, allowedPaymentMethods);

    // Assert
    // NOTE: these claims are "flat" keys that contain dots (e.g., `org.schema.Offer.price`),
    // so we assert via bracket access instead of `toHaveProperty()` (which treats dots as path separators).
    expect(offerClaims[ClaimsOfferSchemaorg.acceptedPaymentMethod]).toBeDefined();
    expect(offerClaims[ClaimsOfferSchemaorg.category]).toBe(sector);
    expect(offerClaims[ClaimsOfferSchemaorg.checkoutPageURLTemplate]).toBeDefined();
    expect(offerClaims[ClaimsOfferSchemaorg.eligibleCustomerType]).toBeDefined();
    expect(offerClaims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
    expect(offerClaims[ClaimsOfferSchemaorg.offeredBy]).toBe(hostDid);
    expect(offerClaims[ClaimsOfferSchemaorg.priceCurrency]).toBeDefined();
    expect(offerClaims[ClaimsOfferSchemaorg.serialNumber]).toBeDefined();
  });
});
