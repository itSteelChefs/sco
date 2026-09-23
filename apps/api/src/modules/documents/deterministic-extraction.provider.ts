import { Injectable } from '@nestjs/common';
import type { DocumentExtractionProvider, DocumentExtractionResult } from './extraction.contract.js';

@Injectable()
export class DeterministicExtractionProvider implements DocumentExtractionProvider {
  async extract(input: { filename: string; documentType: string; structuredLines?: DocumentExtractionResult['lines'] }): Promise<DocumentExtractionResult> {
    return { provider: 'deterministic-test', model: 'structured-input-v1', lines: input.structuredLines ?? [] };
  }
}
