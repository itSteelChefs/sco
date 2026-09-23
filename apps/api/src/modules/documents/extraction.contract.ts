export type DocumentExtractionLine = {
  lineNumber?: string;
  pageReference?: string;
  sheetReference?: string;
  rawValue: Record<string, unknown>;
  description?: string;
  quantity?: number;
  unit?: string;
  brand?: string;
  manufacturer?: string;
  modelReference?: string;
  technicalSpecification?: Record<string, unknown>;
  extractionMetadata?: Record<string, unknown>;
};

export type DocumentExtractionResult = {
  provider: string;
  model?: string;
  lines: DocumentExtractionLine[];
};

/** Provider-agnostic boundary. Implementations return proposed data only. */
export interface DocumentExtractionProvider {
  extract(input: { filename: string; documentType: string; structuredLines?: DocumentExtractionLine[] }): Promise<DocumentExtractionResult>;
}
