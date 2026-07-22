# 28 GDC And VetChain Network Boundaries

This document is the normative deployment, organization-authorization and
source-ownership matrix for the human-health and animal-health trust domains.

## Funding and product boundary

The core funded project is the human-health data space documented by GW Core
and the Fabric infrastructure project. A human-health portal is a product
adapter. An animal-health portal reuses generic GW Core technology but belongs
to a separate animal-health Fabric trust domain.

Documentation must not count animal-product scope as delivered human-health
functionality. Generic security, transport, audit and Fabric integration may
be reused by both products.

## Authorization starts with the organization

Ledger permission is not granted because an individual is a veterinarian,
doctor, researcher, responder or crew member.

1. An ICA-issued organization VC establishes the legal organization,
   jurisdiction, regulated category and approved scope.
2. Host governance admits that organization and grants exact read/write
   operations over exact channel families.
3. GW then evaluates the authenticated actor's active employment or
   membership, licence, internal role, key binding and requested operation.

Both layers must pass. A request-supplied channel is never authority. Read and
write are separate grants, and direct peer membership is separate from API
access through a host GW.

## Staging and production topology

Staging may use one Kubernetes cluster for cost reasons, but the human-health
and animal-health ledgers remain independent Fabric trust domains:

| Network | Example namespace | Ordering/channel block 0 set | Scope |
| --- | --- | --- | --- |
| Human Health | `staging-fabric-human-v3` | independent | human health |
| Animal Health | `staging-fabric-animal-pets-v3` | independent | animal health, initially pets |

Production preserves the split. Sharing a GKE cluster does not mean sharing an
orderer, per-channel block 0, MSP, peer ledger, CouchDB or chaincode lifecycle.
A GW that supports both domains holds two explicit Fabric connections and may
bridge authorized API operations; it never treats the networks as one ledger.

`identity-global` is the authoritative natural-person/controller identity
plane used by both domains. In the MVP it may be reached through the human
identity connection by a dual-domain GW. That logical authority does not make
the animal and human clinical ledgers one Fabric network. Moving it later to a
dedicated identity trust domain is an explicit migration, not a silent channel
copy.

## People, professionals and animals

`identity-global` contains human natural persons acting as `ONSELF`,
controllers or members of human or animal individual organizations, plus
their personal device/key lifecycle. It contains no animal identities,
ownership records or clinical evidence.

A veterinarian is multi-species, not multi-sector. Register that professional
once in `identity-<jurisdiction>` as an employee of an accredited veterinary
organization. The
organization's ICA VC and host grants decide which animal-species channels it
may use. Pet, equine, bovine, ovine or other records reference the professional
identity; they do not duplicate the person for each species.

`identity-<jurisdiction>` stores jurisdictional professional identity,
employment, licences and professional device/key bindings that must be reused
across species. It grants no write to any species channel by itself.

The complete write decision is:

```text
organization VC and host channel grant
  + active employment or membership
  + active licence and internal role
  + active actor-key binding and key
  + permitted resource action
```

## Human-health operational channels

| Channel family | Region | Ownership |
| --- | --- | --- |
| `identity-global` | global | natural persons, controllers/members, personal keys and governance identity |
| `health-care-<jurisdiction>` | regional | admitted providers, employees/licences, human-health permissions and evidence |

The initial routing catalog is `eu`, `na`, `asia`, `africa`, `pacific` and
`latam`. Exact legal country/region remains in verified VC claims such as
`addressCountry` and `addressRegion`; a broad channel suffix does not replace
those claims.

Clinical resource smart contracts are deployed per channel. A chaincode is a
Fabric namespace whose public world state is materialized as a separate
CouchDB database for that channel and chaincode. Vital signs, allergies and
conditions therefore remain separate chaincodes rather than document types in
one monolithic clinical chaincode.

## Animal operational channels

The first animal family is `animal-pet-<jurisdiction>`. It owns pet/animal
individual-organization identity, multiple ownerships, PETD state, veterinary
provider-index permissions and pet clinical evidence for that jurisdiction.
Its evidence references the veterinary actor registered in
`identity-<jurisdiction>` and the organization grant resolved by the host.

Future equine, bovine, ovine, porcine or other families reuse chaincode
packages but receive separate channels only where peer membership,
confidentiality, residency or endorsement policy differs. A multi-species
professional does not automatically grant the employing organization access to
every species family.

The target pet chaincode family remains resource-specific:

| Chaincode family | Purpose | Current status |
| --- | --- | --- |
| `animalidentity-sc` | animal identity and identifiers | target contract |
| `ownership-sc` | owners/controllers, history and authorization references | target contract |
| `providerindexpermission-sc` | veterinary provider-index permissions | target contract |
| `petd-sc` | Pet Emergency Travel Document state and evidence | target contract; not implemented |
| `vitalsigns-sc` | vital-sign observations | target resource-specific contract |
| `allergyintolerance-sc` | allergies and intolerances | target resource-specific contract |
| `condition-sc` | conditions and diagnoses | target resource-specific contract |
| `medicationstatement-sc` | medications | target resource-specific contract |
| `immunization-sc` | vaccinations and travel-relevant immunization | target resource-specific contract |
| `diagnosticreport-sc` | diagnostic reports | target resource-specific contract |
| `documentreference-sc` | hashes/references for off-ledger documents | target resource-specific contract |
| `digitaltwin-sc` | bounded, versioned animal DigitalTwin state/references | partial GW capability; product contract pending |

Each channel-plus-chaincode pair has independent state, sequence, endorsement
policy and history even when it uses the same package.

## Institutional channel families

These families are approved routing vocabulary, but are provisioned only when
their distinct peer visibility or endorsement boundary is needed:

| Family | Records owned | Explicit non-grant |
| --- | --- | --- |
| `research-health-<jurisdiction>` | human-health research institutions, researchers, employment and research-governance evidence | no human clinical writes |
| `research-animal-<jurisdiction>` | animal/One Health institutions, researchers, employment and research-governance evidence | no animal clinical writes |
| `health-it-<jurisdiction>` | health software/device organizations, employees and product/service attestations | no provider status |
| `animal-it-<jurisdiction>` | animal software/device organizations, employees and product/service attestations | no veterinary-provider status |
| `health-gov-<jurisdiction>` | municipal, regional or national health/emergency institutions and responders | no automatic provider status |
| `animal-gov-<jurisdiction>` | municipal, regional or national animal-health institutions and responders | no automatic veterinary-provider status |
| `health-travel-global` | global carriers and crew credentials for human emergency policy | no direct clinical-channel membership |
| `animal-travel-global` | global carriers and crew credentials for animal travel/emergency policy | no direct animal-channel membership |

Insurance channels are conditional. Create
`health-insurance-<jurisdiction>` or `animal-insurance-<jurisdiction>` only when
insurers require their own peer ledger, confidentiality or endorsement policy.
Otherwise an insurer uses exact GW read/evidence operations and receives no
direct membership of clinical channels.

## Emergency and travel classification

Classify responders by the accredited organization governing the operation,
not by title alone:

- personnel of an integrated regulated emergency-health provider may be
  registered in `health-care-<jurisdiction>`;
- municipal/civil-protection personnel outside that provider governance belong
  in `health-gov-<jurisdiction>`;
- animal-health public responders belong in
  `animal-gov-<jurisdiction>`;
- airline, rail, ship and other carrier personnel belong in the applicable
  global travel family.

Emergency viewing remains an explicit GW authorization, consent or break-glass
decision. Employment by a government institution or carrier is never blanket
ledger read access.

## One Health research boundary

A One Health institution can be admitted independently to
`research-health-<jurisdiction>` and `research-animal-<jurisdiction>`. Its
researchers may receive separately governed reads from both trust domains, but
research status alone never permits writes to provider-certified human or
animal records.

The shared Core scope includes registration and lifecycle of research
institutions, researchers, employment, credentials and research-governance
evidence. Product-specific clinical-research workflows belong to their owning
product contract.

## MVP staging profile

The target catalog is not a requirement to create every channel before the
MVP. The staging gate requires only channels exercised by a staging host:

- `identity-global` for controllers/members and personal keys;
- `identity-eu` for the initial multi-species veterinary professional,
  employment, licence and device/key lifecycle;
- `health-care-eu` for the initial human-health lifecycle;
- the required `animal-pet-<jurisdiction>` channels for the initial animal
  hosts and international PETD tests.

All research, IT, government, insurance and travel families remain typed and
fail-closed until a host and organization admission test actually needs them.
Adding one organization is an atomic governance change for that organization
and its exact grants; it must not require rewriting every existing host.

Minimum tests prove organization admission, actor role/licence enforcement,
independent reads, denial of request-supplied channels, multi-species
non-escalation, cross-network One Health read grants and revocation at every
layer.

## Temporary dual-domain GW

A temporary dual-domain GW keeps separate source adapters:

```text
src/subjects/human/
src/subjects/animal/
```

Human routing resolves only to the human-health connection. Animal routing
resolves only to the animal-health connection. Shared Fabric transport,
gateway sessions, audit and target validation stay in the generic blockchain
layer. A request-supplied subject kind, channel or organization category is
never authorization.

The eventual product split copies/removes one adapter without changing the
generic contract.

## Current implementation truth

The channel tables are an approved target taxonomy with an explicit MVP
subset. Existing staging channels and current GW routing do not prove that the
split networks, institutional channels or target animal chaincodes are
deployed. Deployment requires connection/MSP profiles, block-zero bindings,
chaincode definitions and live positive and denial smoke tests.
