export type AiState = 'NOT_INITIALIZED' | 'INITIALIZING' | 'READY' | 'BUSY' | 'UNAVAILABLE' | 'ERROR' | 'SHUTTING_DOWN';

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  maxTokens: number;
  timeoutMs: number;
  jsonSchema?: Record<string, unknown>;
}

export interface AiStatus {
  state: AiState;
  model: string;
  device: string | null;
}

export interface AiProvider {
  initialize(): Promise<void>;
  getStatus(): AiStatus;
  generateResponse(request: AiRequest): Promise<string>;
  shutdown(): Promise<void>;
}
