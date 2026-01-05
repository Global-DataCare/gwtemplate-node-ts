import type { LLMProvider } from '../llm/LLMProvider.js';
import { toLedgerSafeMetaTags } from './metaTagSanitizer.js';

export type EntryWithMetaAndTags = {
  type: string;
  meta: {
    claims: Record<string, any>;
  };
  resource?: Record<string, any>;
};

export type DerivationResult = {
  anonymizedText: string;
  observations: EntryWithMetaAndTags[];
  meta?: {
    tag?: any[];
  };
};

export type ConversationDerivationParams = {
  model: string;
  text: string;
  policyPrompt?: string;
  ledgerSafe?: boolean;
};

export class ConversationDerivationService {
  constructor(private readonly llm: LLMProvider) {}

  async derive(params: ConversationDerivationParams): Promise<DerivationResult> {
    const prompt =
      `${params.policyPrompt ? `${params.policyPrompt.trim()}\n\n` : ''}` +
      `Task: Anonymize the user text and derive a JSON bundle of Observation entries.\n` +
      `Return ONLY valid JSON with this shape:\n` +
      `{\n` +
      `  "anonymizedText": string,\n` +
      `  "meta": { "tag": [{ "id": string, "system"?: string, "code"?: string, "version"?: string, "display"?: string, "userSelected"?: boolean }] },\n` +
      `  "observations": [{ "type": string, "meta": { "claims": object }, "resource"?: object }]\n` +
      `}\n\n` +
      `Rules:\n` +
      `- "meta.tag[].id" MUST be unique and SHOULD use an index per resource type, e.g. "Observation[0].code", "Observation[1].date-when".\n\n` +
      `User text:\n` +
      `${params.text}`;

    const raw = await this.llm.generateJson<DerivationResult>({
      model: params.model,
      prompt,
      temperature: 0.1,
      timeoutMs: 60_000,
    });

    const anonymizedText = typeof raw?.anonymizedText === 'string' ? raw.anonymizedText : '';
    const observations = Array.isArray(raw?.observations) ? raw.observations : [];
    const meta = raw?.meta && typeof raw.meta === 'object' ? raw.meta : undefined;

    if (!params.ledgerSafe) {
      return { anonymizedText, observations, meta };
    }

    const tag = toLedgerSafeMetaTags((meta as any)?.tag);
    const ledgerSafeMeta = meta ? { ...(meta as any), tag } : { tag };

    return { anonymizedText, observations, meta: ledgerSafeMeta };
  }
}
