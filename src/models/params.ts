// File: src/models/params.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Represents a interoperable claim for all specifications.
 */
export interface ClaimInteroperable {
    /**
     * Key name of the interoperable claim in reverse-DNS (e.g., 'org.hl7.fhir.immunization.vaccine-code').
     */
    name: string;
    /**
     * The value of the claim. Can be either a string or a number.
     * Derived interfaces may specify more precise types.
     */
    value: any;
}

/**
 * Represents a single, named piece of data within an entity's configuration,
 * aligning with the structure of a Parameter in the FHIR Parameters resource.
 *
 * This structure is used to store secondary or multi-value attributes (like
 * multiple emails or official identifiers) in their original, readable format.
 * The entire collection of these attributes is considered private and is always
 * stored within an encrypted parent configuration object.
 *
 * @see {@link https://hl7.org/fhir/parameters.html}
 */
export interface ParamAttribute extends ClaimInteroperable {
  /**
   * The name of the parameter, which often corresponds to a key in the
   * 'indexed' attributes dictionary of the parent configuration.
   *
   * @example 'NNES' (for a Spanish DNI, unique=true)
   * @example 'email' (unique=falsez)
   */
  name: string;

  /**
   * The original value of the parameter. Can be either a string or a number.
   * This corresponds to a simplified `value[x]` (e.g., `valueString`) in a FHIR Parameter.
   */
  value: string | number | undefined;

  /**
   * A custom flag to indicate whether this attribute's value is expected to
   * be unique across all entities of the same type. This is used for
   * server-side validation logic and is not part of the FHIR standard.
   * @default false
   */
  unique?: boolean;
}

export type ParameterType = 'number' | 'date' | 'string' | 'token' | 'reference' | 'composite' | 'quantity' | 'uri' | 'period';

/**
 * Represents a common interface for all types of parameters.
 */
export interface ParameterData extends ParamAttribute {
    /**
     * Defines the type of parameter.
     */
    type: ParameterType | string;
    /**
     * (Optional) Coding system (e.g., SNOMED, LOINC...).
     */
    system?: string;
    /**
     * (Optional) Unit of measurement (e.g., ml, mg...).
     */
    unit?: string;
    /**
     * (Optional) Indicates if the date is a Period (e.g., FHIR effectivePeriod or FHIR onsetPeriod).
     */
    period?: boolean;
    /**
     * (Optional) The end date of a FHIR Period.
     */
    end?: string;
    /**
     * (Optional) Prefix for dates and quantities for comparisons (e.g., eq, gt, lt, ...).
     */
    prefix?: string;
    /**
     * (Optional) International display derived from a FHIR Coding within a CodeableConcept.
     */
    intDisplay?: string;
    /**
     * (Optional) Localized text derived from a FHIR CodeableConcept.
     */
    localizedText?: string;
    /**
     * (Optional) A hint or tooltip to guide users in a UI setting.
     */
    hint?: string;
    /**
     * (Optional) A list of select options for UI dropdowns or similar components.
     */
    optionsList?: any[];
    /**
     * (Optional) Resources to which this parameter is applicable.
     */
    appliesTo?: string[];
}

export interface StringSearchParameter extends ParameterData {
    type: 'string';
    value: string;
}
export interface NumberSearchParameter extends ParameterData {
    value: number;
}
export interface DateSearchParameter extends ParameterData {
    value: string;
    end?: string;
    period?: boolean;
}
export interface TokenSearchParameter extends ParameterData {
    type: 'token';
    value: string;
    system: string;
}
export interface ReferenceSearchParameter extends ParameterData {
    type: 'reference';
    reference: string;
}
export interface CompositeSearchParameter extends ParameterData {
    type: 'composite';
    components: ParameterData[];
}
export interface QuantitySearchParameter extends ParameterData {
    type: 'quantity';
    value: number;
    system: string;
    unit: string;
}
export interface URISearchParameter extends ParameterData {
    type: 'uri';
    value: string;
}
export type FHIRSearchParameter = NumberSearchParameter | DateSearchParameter | StringSearchParameter | TokenSearchParameter | ReferenceSearchParameter | CompositeSearchParameter | QuantitySearchParameter | URISearchParameter;
