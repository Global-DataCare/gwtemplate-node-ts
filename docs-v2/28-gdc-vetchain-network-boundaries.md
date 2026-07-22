# 28 GDC And VetChain Network Boundaries

This document is the normative deployment and source-ownership matrix for the
GDC human-health project and the separate VetChain Pets product.

## Funding and product boundary

GDC is the human-health data-space project documented by GW Core and
fabric-multicloud. The commercial Unified Cards for Human Health portal is a
GDC human-health adapter. VetChain Pets reuses generic GW Core technology but
is a separate animal-health product and Fabric trust domain.

Documentation must not count VetChain product scope as delivered GDC
human-health functionality. Conversely, generic security, transport, audit and
Fabric integration implemented in GW Core may be reused by both products.

## Staging and production topology

Staging uses one Kubernetes cluster when cost requires it, but two independent
Fabric networks:

| Network | Kubernetes namespace | Ordering/channel block 0 set | Product |
| --- | --- | --- | --- |
| GDC Human Health | staging-fabric-gdc-v3 | independent | GDC and Unified Cards for Human Health |
| VetChain Pets | staging-fabric-vetchain-pets-v3 | independent | VetChain Portal and PETD |

Production preserves the same split. Sharing a GKE cluster does not mean
sharing an orderer, per-channel block 0, MSP, peer ledger, CouchDB or chaincode
lifecycle.

## GDC Human Health channel matrix

| Channel | Region | Subject/data ownership | Provider index |
| --- | --- | --- | --- |
| identity-global | global | human persons, human individual organizations, controllers/members, personal device keys and governance identity | global human identity and governance permissions |
| health-care-eu | Europe | providers, professional employees and human clinical resources | permissions for the selected EU provider index |
| health-care-na | North America | same human-health contract | permissions for the selected NA provider index |
| health-care-asia | Asia, Middle East and India | same human-health contract | permissions for the selected Asia provider index |
| health-care-africa | Africa | same human-health contract | permissions for the selected Africa provider index |
| health-care-pacific | China, Japan, Korea, Australia and Pacific | same human-health contract | permissions for the selected Pacific provider index |
| health-care-latam | Latin America and Caribbean | same human-health contract | permissions for the selected LATAM provider index |

Clinical resource smart contracts are deployed per channel. A chaincode is a
Fabric namespace whose public world state is materialized as a separate
CouchDB database for that channel and chaincode. Vital signs, allergies and
conditions therefore remain separate chaincodes rather than document types in
one monolithic clinical chaincode.

## VetChain Pets channel matrix

| Channel | Region | Subject/data ownership | Provider index |
| --- | --- | --- | --- |
| animal-pet-eu | Europe | pet identity, animal individual organization, multiple ownerships, PETD and pet clinical resources | veterinary providers and permissions for EU |
| animal-pet-na | North America | same pet contract | veterinary providers and permissions for NA |
| animal-pet-asia | Asia, Middle East and India | same pet contract | veterinary providers and permissions for Asia |
| animal-pet-africa | Africa | same pet contract | veterinary providers and permissions for Africa |
| animal-pet-pacific | China, Japan, Korea, Australia and Pacific | same pet contract | veterinary providers and permissions for Pacific |
| animal-pet-latam | Latin America and Caribbean | same pet contract | veterinary providers and permissions for LATAM |

The target chaincode family inside each animal-pet channel is:

| Chaincode family | Purpose | Current status |
| --- | --- | --- |
| animalidentity-sc | pet/animal-individual-organization identity and identifiers | target contract |
| ownership-sc | one or more owners/controllers with history and authorization references | target contract |
| providerindexpermission-sc | veterinary provider-index permissions | target contract |
| petd-sc | Pet Emergency Travel Document state, evidence and lifecycle | target contract; not implemented |
| vitalsigns-sc | vital-sign observations | target resource-specific contract |
| allergyintolerance-sc | allergies and intolerances | target resource-specific contract |
| condition-sc | conditions and diagnoses | target resource-specific contract |
| medicationstatement-sc | medications | target resource-specific contract |
| immunization-sc | vaccinations and travel-relevant immunization | target resource-specific contract |
| diagnosticreport-sc | diagnostic reports | target resource-specific contract |
| documentreference-sc | hashes/references for documents kept off-chain | target resource-specific contract |
| digitaltwin-sc | bounded, versioned pet DigitalTwin state/references | partial GW capability; VetChain contract pending |

The same chaincode package may be committed independently on every regional
channel. Each channel-plus-chaincode pair has independent state, sequence,
endorsement policy and history.

## Research extension

Research is not part of the initial PETD MVP. If enabled later, use
research-pet-REGION channels in the VetChain network and deploy the required
resource-specific chaincodes there. Do not mix cattle, sheep, equine or porcine
subjects into pet channels; each future animal family receives its own
channel family and may reuse the same clinical chaincode packages.

## Temporary dual-subject GW UNID

GW UNID temporarily supports both domains through separate source adapters:

    src/subjects/human/
    src/subjects/animal/

Human routing resolves only to the GDC network. Animal routing resolves only to
the VetChain Pets network. Shared Fabric transport, gateway sessions, audit and
target validation stay in the generic blockchain layer. A request-supplied
channel or subject kind is never authorization.

The eventual split copies/removes one adapter without changing the generic
contract:

- GDC GW keeps the human adapter;
- VetChain GW keeps the animal adapter;
- VetChain Portal consumes only the animal facade;
- Unified Cards for Human Health consumes only the human facade.

## Current implementation truth

The channel tables are approved target topology. Existing staging channel
identity and current GW single-connection routing are legacy compatibility,
not proof that the split networks or PETD chaincode are deployed. Deployment
requires separate connection/MSP profiles, per-channel genesis bindings, chaincode
definitions and live smoke tests for both networks.
