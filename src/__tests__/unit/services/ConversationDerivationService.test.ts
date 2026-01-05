import { describe, expect, it } from '@jest/globals';
import type { LLMProvider } from '../../../services/llm/LLMProvider';
import { ConversationDerivationService } from '../../../services/ai/ConversationDerivationService';

describe('ConversationDerivationService', () => {
  it('strips display from meta.tag when ledgerSafe=true', async () => {
    const mockProvider: LLMProvider = {
      generateJson: async <T>() =>
        ({
        anonymizedText: 'text',
        meta: {
          tag: [
            { id: 'Observation[0].code', system: 'SNOMED', code: '48694002', display: 'PII??', userSelected: true },
            { id: 'Observation[0].date-when', system: 'http://hl7.org/fhir/event-timing', code: 'NIGHT', display: 'Night' },
          ],
        },
        observations: [
          {
            type: 'Observation-form-v1.0',
            meta: {
              claims: { '@context': 'org.hl7.fhir.api' },
            },
          },
        ],
        } as unknown as T),
    };

    const service = new ConversationDerivationService(mockProvider);
    const result = await service.derive({
      model: 'gemma2:latest',
      text: 'hello',
      ledgerSafe: true,
    });

    expect(result.observations).toHaveLength(1);
    const tags = result.meta?.tag!;
    expect(tags).toEqual([
      { id: 'Observation[0].code', system: 'SNOMED', code: '48694002', userSelected: true },
      { id: 'Observation[0].date-when', system: 'http://hl7.org/fhir/event-timing', code: 'NIGHT' },
    ]);
  });
});
