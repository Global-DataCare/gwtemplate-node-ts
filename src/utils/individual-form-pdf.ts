import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

/** Flat map of PDF form field names to raw values extracted from the individual onboarding PDF. */
export type IndividualFormPdfFieldMap = Record<string, string | boolean | undefined | null>;

/** Normalizes unknown input into a trimmed string, or an empty string when not present. */
function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Interprets common PDF checkbox/string variants as booleans. */
function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on' || normalized === 'checked';
}

/** Lowercases and trims an email-like field, returning `undefined` when empty. */
function normalizeEmail(value: unknown): string | undefined {
  const email = normalizeText(value).toLowerCase();
  return email || undefined;
}

/** Trims a phone-like field, returning `undefined` when empty. */
function normalizePhone(value: unknown): string | undefined {
  const phone = normalizeText(value);
  return phone || undefined;
}

/** Filters placeholder values from the gender selector while preserving the original value. */
function normalizeGender(value: unknown): string | undefined {
  const raw = normalizeText(value);
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === '(seleccionar)' || normalized === 'seleccionar' || normalized === 'select') return undefined;
  return raw;
}

/** Returns the first non-empty string from the candidate list. */
function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return undefined;
}

/** Normalizes DN keys so `serialNumber`, `SERIALNUMBER`, and spaced variants collapse to one key. */
function normalizeDnKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Parses an RFC2253-like distinguished name into a key/value map. */
function parseDistinguishedName(dn: string): Record<string, string> {
  const output: Record<string, string> = {};
  const trimmed = normalizeText(dn);
  if (!trimmed) return output;

  const tokens = trimmed
    .split(/(?<!\\),/)
    .map((token) => token.trim())
    .filter(Boolean);

  let lastKey: string | undefined;
  for (const token of tokens) {
    const separator = token.indexOf('=');
    if (separator <= 0) {
      if (lastKey && output[lastKey]) {
        output[lastKey] = `${output[lastKey]}, ${token.trim()}`;
      }
      continue;
    }
    const key = normalizeDnKey(token.slice(0, separator));
    const value = token.slice(separator + 1).trim().replace(/\\,/g, ',').replace(/\\\\/g, '\\');
    if (!key || !value) continue;
    if (!(key in output)) output[key] = value;
    lastKey = key;
  }

  return output;
}

/**
 * Builds normalized `org.schema` claims from an individual onboarding PDF plus the signer certificate subject.
 *
 * `Organization.owner.identifier.value` always comes from the signer certificate `SERIALNUMBER`.
 *
 * @throws When the PDF does not provide the required alternate name or any contact channel.
 */
export function buildClaimsFromIndividualFormPdf(
  fields: IndividualFormPdfFieldMap,
  signerSubjectDn: string,
): Record<string, string> {
  const subjectDn = parseDistinguishedName(signerSubjectDn);
  const selfDeclared = normalizeBoolean(fields.self);
  const mainAlternateName = firstDefined(normalizeText(fields.alternateName));
  const subjectAlternateName = firstDefined(normalizeText(fields.subjectAlternateName));
  const mainEmail = normalizeEmail(fields.email);
  const subjectEmail = normalizeEmail(fields.subjectEmail);
  const mainPhone = normalizePhone(fields.phone);
  const subjectPhone = normalizePhone(fields.subjectPhone);
  const hasExplicitSubjectFields = Boolean(subjectAlternateName || subjectEmail || subjectPhone);
  const useSubjectValues = !selfDeclared && hasExplicitSubjectFields;

  const organizationAlternateName = firstDefined(
    useSubjectValues ? subjectAlternateName : undefined,
    mainAlternateName,
    subjectAlternateName,
  );
  if (!organizationAlternateName) {
    throw new Error('Individual PDF form requires alternateName or subjectAlternateName.');
  }

  const resolvedEmail = useSubjectValues
    ? firstDefined(subjectEmail, !subjectPhone ? mainEmail : undefined)
    : firstDefined(mainEmail, subjectEmail);
  const resolvedTelephone = useSubjectValues
    ? firstDefined(subjectPhone, !subjectEmail ? mainPhone : undefined)
    : firstDefined(mainPhone, subjectPhone);
  if (!resolvedEmail && !resolvedTelephone) {
    throw new Error('Individual PDF form requires email/subjectEmail or phone/subjectPhone.');
  }

  const givenName = firstDefined(subjectDn.GN, subjectDn.GIVENNAME);
  const familyName = firstDefined(subjectDn.SN, subjectDn.SURNAME);
  const personName = [givenName, familyName].filter(Boolean).join(' ') || firstDefined(subjectDn.CN)?.split(' - ')[0]?.trim();
  const personIdentifier = firstDefined(subjectDn.SERIALNUMBER, subjectDn['OID.2.5.4.5']);
  const personAlternateName = firstDefined(mainAlternateName, organizationAlternateName);
  const gender = firstDefined(normalizeGender(fields.sexPicker), normalizeGender(fields.gender));
  const birthDate = firstDefined(normalizeText(fields.dateOfBirth));
  const country = firstDefined(subjectDn.C, subjectDn.COUNTRYNAME);

  return {
    '@context': 'org.schema',
    [ClaimsOrganizationSchemaorg.alternateName]: organizationAlternateName,
    ...(personIdentifier ? {
      [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: personIdentifier,
    } : {}),
    ...(resolvedEmail ? {
      [ClaimsOrganizationSchemaorg.ownerEmail]: resolvedEmail,
      [ClaimsPersonSchemaorg.email]: resolvedEmail,
    } : {}),
    ...(resolvedTelephone ? {
      [ClaimsOrganizationSchemaorg.ownerTelephone]: resolvedTelephone,
      [ClaimsPersonSchemaorg.telephone]: resolvedTelephone,
    } : {}),
    ...(personAlternateName ? { [ClaimsPersonSchemaorg.alternateName]: personAlternateName } : {}),
    ...(personName ? { [ClaimsPersonSchemaorg.name]: personName } : {}),
    ...(givenName ? { [ClaimsPersonSchemaorg.givenName]: givenName } : {}),
    ...(familyName ? { [ClaimsPersonSchemaorg.familyName]: familyName } : {}),
    ...(personIdentifier ? {
      [ClaimsPersonSchemaorg.identifierValue]: personIdentifier,
      [ClaimsPersonSchemaorg.identifier]: `urn:person:identifier:${personIdentifier}`,
    } : {}),
    ...(country ? { [ClaimsOrganizationSchemaorg.addressCountry]: country } : {}),
    ...(gender ? { [ClaimsPersonSchemaorg.gender]: gender } : {}),
    ...(birthDate ? { [ClaimsPersonSchemaorg.birthDate]: birthDate } : {}),
  };
}
