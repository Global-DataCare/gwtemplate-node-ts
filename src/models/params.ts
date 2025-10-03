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

export type ParameterType = 'number' | 'date' | 'string' | 'token' | 'reference' | 'composite' | 'quantity' | 'uri' | 'period';
/**
 * Represents a base interface for all types of parameters.
 */
export interface ParameterBase extends ClaimInteroperable {
    /**
     * Key name of the parameter (e.g., '@type' for the resource type or 'vaccine-code').
     */
    name: string;
    /**
     * The value of the parameter. Can be either a string or a number.
     * Derived interfaces may specify more precise types.
     */
    value: any;
    /**
     * Indicates if the parameter can exist only once in an array of parameters.
     * If true, the parameter is unique. If false or omitted, the parameter can appear multiple times
     * (e.g., several 'identifier' parameters).
     */
    unique?: boolean;
}
/**
 * Represents a common interface for all types of parameters.
 */
export interface ParameterData extends ParameterBase {
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
