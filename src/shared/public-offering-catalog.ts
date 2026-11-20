/** Public exchange projection only. Admission, authorization and private evidence are never catalogue fields. */
export type PublicOfferingParty = Readonly<{id: string; name: string}>
export type PublicOfferingTerritory = Readonly<{country: string; regions: readonly string[]}>
export type PublicSubscriptionPlan = Readonly<{
  name: string
  description?: string
  features: readonly string[]
  currency: string
  monthly?: string
  annually?: string
}>
export type PublicTerritorialOffer = Readonly<{
  id: string
  seller: PublicOfferingParty
  eligibleRegions: readonly PublicOfferingTerritory[]
  deliveryCountries: readonly string[]
  operationCountries: readonly string[]
  supportCountries: readonly string[]
  url?: string
  plans?: readonly PublicSubscriptionPlan[]
}>
export type PublicOffering = Readonly<{
  id: string
  type: 'Product' | 'Service' | 'SoftwareApplication'
  category: string
  sector: string
  name: string
  description: string
  publisher: PublicOfferingParty
  manufacturer?: PublicOfferingParty
  demo: boolean
  brand?: Readonly<{name: string; logoUrl?: string}>
  images?: readonly string[]
  url?: string
  offers: readonly PublicTerritorialOffer[]
}>
export type PublicOfferingPublicationScope = Readonly<Pick<PublicOffering, 'publisher' | 'sector' | 'demo'>>
export type PublicOfferingDraftType = Extract<PublicOffering['type'], 'Product' | 'Service'>
export type PublicOfferingDraftResource = Readonly<{
  id: string
  type: PublicOfferingDraftType
  attributes: Readonly<Record<string, unknown>>
}>
export type PublicOfferingDraftDocument = Readonly<{
  jsonapi: Readonly<{version: '1.1'}>
  data: readonly PublicOfferingDraftResource[]
}>

/** JSON:API resource identity within one publisher's catalogue. */
export function publicOfferingResourceKey(offering: Pick<PublicOffering, 'type' | 'id'>): string {
  return `${offering.type}/${offering.id}`
}

export function publicOfferingMediaClaimKeys(type: 'Product' | 'Service') {
  const prefix = `org.schema.${type}`
  return {images:`${prefix}.image.contentUrl`, brand:`${prefix}.brand.name`, logo:`${prefix}.brand.logo.contentUrl`,
    plans:`${prefix}.additionalProperty.subscriptionPlans`}
}

const invalid = (): never => {throw new TypeError('public_offering_catalog_invalid')}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return invalid()
  return value.trim()
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 1000) return invalid()
  return value
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid()
}
function country(value: unknown): string {
  const code = text(value).toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return invalid()
  return code
}
function countryList(value: unknown): readonly string[] {
  return Object.freeze([...new Set(array(value).map(country))])
}
function url(value: unknown): string {
  const result = text(value)
  const parsed = new URL(result)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return invalid()
  return result
}
function party(value: unknown): PublicOfferingParty {
  const item = record(value)
  keys(item, ['id', 'name'])
  return Object.freeze({id: text(item.id), name: text(item.name)})
}
function territory(value: unknown): PublicOfferingTerritory {
  const item = record(value), code = country(item.country)
  keys(item, ['country', 'regions'])
  const regions = array(item.regions).map(value => {
    const region = text(value).toUpperCase()
    if (!new RegExp(`^${code}-[A-Z0-9]{1,3}$`).test(region)) return invalid()
    return region
  })
  return Object.freeze({country: code, regions: Object.freeze([...new Set(regions)])})
}
function offer(value: unknown): PublicTerritorialOffer {
  const item = record(value)
  keys(item, ['id', 'seller', 'eligibleRegions', 'deliveryCountries', 'operationCountries', 'supportCountries', 'url', 'plans'])
  const eligibleRegions = array(item.eligibleRegions).map(territory)
  if (!eligibleRegions.length) return invalid()
  return Object.freeze({id: text(item.id), seller: party(item.seller), eligibleRegions: Object.freeze(eligibleRegions),
    deliveryCountries: countryList(item.deliveryCountries), operationCountries: countryList(item.operationCountries), supportCountries: countryList(item.supportCountries),
    ...(item.url === undefined ? {} : {url: url(item.url)}),
    ...(item.plans === undefined ? {} : {plans: readPublicSubscriptionPlans(item.plans)}),
  })
}

export function readPublicSubscriptionPlans(value: unknown): readonly PublicSubscriptionPlan[] {
  const plans = array(value)
  if (plans.length > 12) return invalid()
  return Object.freeze(plans.map(value => {
    const plan = record(value)
    keys(plan, ['name', 'description', 'features', 'currency', 'monthly', 'annually'])
    const currency = text(plan.currency)
    if (!/^[A-Z]{3}$/.test(currency)) return invalid()
    const amount = (value: unknown) => {
      const price = text(value)
      if (!/^\d{1,8}(\.\d{1,4})?$/.test(price)) return invalid()
      return price
    }
    return Object.freeze({name: text(plan.name), currency, features: Object.freeze(array(plan.features).map(text)),
      ...(plan.description === undefined ? {} : {description: text(plan.description)}),
      ...(plan.monthly === undefined ? {} : {monthly: amount(plan.monthly)}),
      ...(plan.annually === undefined ? {} : {annually: amount(plan.annually)}),
    })
  }))
}
function uniqueIds(items: readonly {id: string}[]): void {
  if (new Set(items.map(item => item.id)).size !== items.length) invalid()
}

/** Strict allowlist prevents an operator accidentally publishing signatures, emails, grants or private evidence. */
export function readPublicOfferingCatalog(value: unknown): readonly PublicOffering[] {
  const items = array(value).map(value => {
    const item = record(value)
    keys(item, ['id', 'type', 'category', 'sector', 'name', 'description', 'publisher', 'manufacturer', 'demo', 'url', 'offers', 'brand', 'images'])
    if (item.type !== 'Product' && item.type !== 'Service' && item.type !== 'SoftwareApplication') return invalid()
    if (typeof item.demo !== 'boolean') return invalid()
    if (item.manufacturer !== undefined && item.type !== 'Product') return invalid()
    const offers = array(item.offers).map(offer)
    uniqueIds(offers)
    const media = readPublicOfferingMedia(item)
    return Object.freeze({id: text(item.id), type: item.type, category: text(item.category), sector: text(item.sector), name: text(item.name),
      description: text(item.description), publisher: party(item.publisher), demo: item.demo,
      ...(item.manufacturer === undefined ? {} : {manufacturer: party(item.manufacturer)}),
      ...(item.url === undefined ? {} : {url: url(item.url)}), ...media, offers: Object.freeze(offers),
    })
  })
  if (new Set(items.map(item => JSON.stringify([item.publisher.id, publicOfferingResourceKey(item)]))).size !== items.length) return invalid()
  return Object.freeze(items)
}

export function readPublicOfferingMedia(value: unknown): Pick<PublicOffering, 'brand' | 'images'> {
  const item = record(value)
  const media: {brand?: NonNullable<PublicOffering['brand']>; images?: readonly string[]} = {}
  if (item.brand !== undefined) {
    const brand = record(item.brand)
    keys(brand, ['name', 'logoUrl'])
    media.brand = Object.freeze({name: text(brand.name), ...(brand.logoUrl === undefined ? {} : {logoUrl: url(brand.logoUrl)})})
  }
  if (item.images !== undefined) {
    const images = array(item.images)
    if (images.length > 8) return invalid()
    media.images = Object.freeze([...new Set(images.map(url))])
  }
  return Object.freeze(media)
}

/** Demo operator overrides for an explicitly selected animal product. */

function offeringDocumentEntry(entry: unknown): Record<string, unknown> {
  const resource = record(entry)
  keys(resource, ['id', 'type', 'attributes'])
  const attributes = record(resource.attributes)
  if ('id' in attributes || 'type' in attributes) return invalid()
  return {...attributes, id:resource.id, type:resource.type}
}

function submissionEntries(document: unknown): readonly unknown[] {
  const input = record(document)
  keys(input, ['data', 'jsonapi'])
  if (input.jsonapi !== undefined) {
    const jsonapi = record(input.jsonapi)
    keys(jsonapi, ['version'])
    if (jsonapi.version !== '1.0' && jsonapi.version !== '1.1') return invalid()
  }
  const entries = Array.isArray(input.data) ? array(input.data) : [input.data]
  if (!entries.length) return invalid()
  return entries
}

function entriesOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? array(value) : [value]
}

function draftParty(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return {name:value}
  const {'@type':kind,'@id':schemaId,id,name,...rest} = record(value)
  keys(rest,[])
  if (kind !== undefined && kind !== 'Organization' && kind !== 'Person' || schemaId !== undefined && id !== undefined && schemaId !== id) return invalid()
  return {...(schemaId !== undefined || id !== undefined ? {id:id ?? schemaId}:{}),...(name === undefined?{}:{name})}
}

function draftTerritories(value: unknown): readonly PublicOfferingTerritory[] {
  const territories = new Map<string, string[]>()
  for (const territoryValue of entriesOf(value)) {
    const territory = typeof territoryValue === 'string' ? {identifier:territoryValue} : record(territoryValue)
    keys(territory,['@type','identifier'])
    const kind = territory['@type']
    if (kind !== undefined && kind !== 'Country' && kind !== 'AdministrativeArea') return invalid()
    const identifier = text(territory.identifier).toUpperCase()
    if (!/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/u.test(identifier)) return invalid()
    const code = identifier.slice(0,2)
    const regions = territories.get(code)
    if (identifier === code) territories.set(code,[])
    else if (!regions || regions.length) territories.set(code,[...new Set([...(regions??[]),identifier])])
  }
  return [...territories].map(([country,regions])=>({country,regions}))
}

function draftPlans(value: unknown): readonly PublicSubscriptionPlan[] {
  const plans = new Map<string, PublicSubscriptionPlan>()
  for (const priceValue of entriesOf(value)) {
    const {'@type':kind,name,price,priceCurrency,billingIncrement,unitCode,...rest} = record(priceValue)
    keys(rest,[])
    if (kind !== undefined && kind !== 'UnitPriceSpecification' || billingIncrement !== undefined && billingIncrement !== 1) return invalid()
    const period = unitCode === 'MON' ? 'monthly' : unitCode === 'ANN' ? 'annually' : invalid()
    const planName = text(name), currency = text(priceCurrency), key = JSON.stringify([planName,currency])
    const amount = text(typeof price === 'number' && Number.isFinite(price) ? String(price) : price)
    const current = plans.get(key) ?? {name:planName,currency,features:[]}
    if (current[period] !== undefined && current[period] !== amount) return invalid()
    plans.set(key,{...current,[period]:amount})
  }
  return readPublicSubscriptionPlans([...plans.values()])
}

function draftOffer(value: unknown, itemId: string, index: number): Record<string, unknown> {
  const {'@type':kind,'@id':schemaId,id,itemOffered,seller,eligibleRegion,eligibleRegions,priceSpecification,plans,...fields} = record(value)
  keys(fields,['deliveryCountries','operationCountries','supportCountries','url'])
  if (kind !== undefined && kind !== 'Offer' || schemaId !== undefined && id !== undefined && schemaId !== id) return invalid()
  if (itemOffered !== undefined) {
    const link=record(itemOffered)
    keys(link,['@id'])
    if (link['@id'] !== itemId) return invalid()
  }
  if (eligibleRegion !== undefined && eligibleRegions !== undefined || priceSpecification !== undefined && plans !== undefined) return invalid()
  return {id:id ?? schemaId ?? `${itemId}-offer-${index+1}`,deliveryCountries:[],operationCountries:[],supportCountries:[],...fields,
    ...(seller === undefined ? {} : {seller:draftParty(seller)}),
    ...(eligibleRegion !== undefined ? {eligibleRegions:draftTerritories(eligibleRegion)} : eligibleRegions === undefined ? {} : {eligibleRegions}),
    ...(priceSpecification !== undefined ? {plans:draftPlans(priceSpecification)} : plans === undefined ? {} : {plans})}
}

/** Imports a reviewable batch. The publication validator still checks every completed resource against its host scope. */
export function readPublicOfferingDraftDocument(document: unknown, createId?: () => string): PublicOfferingDraftDocument {
  const data = submissionEntries(document).map((entry): PublicOfferingDraftResource => {
    const input = record(entry)
    keys(input, ['id', 'type', 'attributes'])
    if (typeof input.type !== 'string') return invalid()
    const type = input.type.replace(/^https?:\/\/schema\.org\//u, '')
    if (type !== 'Product' && type !== 'Service') return invalid()
    const {'@context':context,'@type':schemaType,'@id':schemaId,image,images,brand,manufacturer,offers,...attributes} = record(input.attributes)
    if (context !== undefined && context !== 'https://schema.org' || schemaType !== undefined && schemaType !== type
      || schemaId !== undefined && input.id !== undefined && schemaId !== input.id) return invalid()
    const declaredId = input.id === undefined ? schemaId : input.id
    const id = text(declaredId === undefined ? createId?.() : declaredId)
    keys(attributes, ['name', 'description', 'category', 'url', 'publisher', 'sector', 'demo'])
    for (const key of ['name', 'description', 'category', 'url'] as const) {
      if (attributes[key] !== undefined && typeof attributes[key] !== 'string') return invalid()
    }
    if (image !== undefined && images !== undefined) return invalid()
    const photoValue = image === undefined ? images : image
    if (photoValue !== undefined) {
      const photos = typeof photoValue === 'string' ? [photoValue] : array(photoValue)
      if (photos.length > 8 || photos.some(photo => typeof photo !== 'string')) return invalid()
      attributes.images = [...photos]
    }
    if (typeof brand === 'string') attributes.brand = {name:brand}
    else if (brand !== undefined) {
      const {'@type':kind,logo,logoUrl,...fields} = record(brand)
      keys(fields,['name'])
      if (kind !== undefined && kind !== 'Brand' || logo !== undefined && logoUrl !== undefined) return invalid()
      attributes.brand = {...fields,...(logo !== undefined || logoUrl !== undefined ? {logoUrl:logoUrl??logo}:{})}
    }
    if (manufacturer !== undefined) attributes.manufacturer = draftParty(manufacturer)
    if (offers !== undefined) attributes.offers = entriesOf(offers).map((resource,index)=>draftOffer(resource,id,index))
    return {id, type, attributes}
  })
  if (data.some(resource => resource.type !== data[0]?.type)) throw new TypeError('public_offering_draft_mixed_types')
  uniqueIds(data)
  return {jsonapi:{version:'1.1'},data}
}

/** Opens published offerings in the same editor format, with host-owned publication context supplied later. */

/** Checks an editor entry for completeness before the host authorizes publication. */
export function validatePublicOfferingDraftResource(resource: PublicOfferingDraftResource): void {
  const {publisher, sector, demo, ...attributes} = resource.attributes
  if (publisher !== undefined) party(publisher)
  if (sector !== undefined) text(sector)
  if (demo !== undefined && typeof demo !== 'boolean') return invalid()
  readPublicOfferingCatalog([{...attributes,id:resource.id,type:resource.type,
    publisher:{id:'draft',name:'Draft publisher'},sector:'draft',demo:false}])
}

/** Reads one publisher's catalogue submission with scope resolved by the host. */
export function readPublicOfferingSubmission(document: unknown, scope: PublicOfferingPublicationScope): readonly PublicOffering[] {
  const entries = submissionEntries(document)
  const publisher = party(scope.publisher)
  const sector = text(scope.sector)
  return readPublicOfferingCatalog(entries.map(entry => {
    const offering = offeringDocumentEntry(entry)
    if (offering.publisher !== undefined) {
      const asserted = party(offering.publisher)
      if (asserted.id !== publisher.id || asserted.name !== publisher.name) return invalid()
    }
    if (offering.sector !== undefined && offering.sector !== sector) return invalid()
    if (offering.demo !== undefined && offering.demo !== scope.demo) return invalid()
    return {...offering, publisher, sector, demo: scope.demo}
  }))
}

/** Pure configuration reader. Real companies and territorial agreements stay in private host configuration. */

/** Matching means a public territorial offer exists. It never grants service access or certifies connectivity. */

/** Schema.org exchange output; the product is not misrepresented as a DCAT DataService. */
