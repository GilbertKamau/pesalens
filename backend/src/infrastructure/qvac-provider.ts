import type { AiProvider, AiRequest, AiState, AiStatus } from '../application/ai-provider.ts';
import { AppError } from '../application/errors.ts';

type Sdk = typeof import('@qvac/sdk');

const MODEL = 'QWEN3_600M_INST_Q4';

export class QvacProvider implements AiProvider {
  private state: AiState = 'NOT_INITIALIZED';
  private device: string | null = null;
  private sdk: Sdk | null = null;
  private modelId: string | null = null;

  getStatus(): AiStatus {
    return { state: this.state, model: MODEL, device: this.device };
  }

  async initialize(): Promise<void> {
    if (this.state === 'INITIALIZING' || this.modelId) return;
    this.state = 'INITIALIZING';
    try {
      this.sdk = await import('@qvac/sdk');
      this.modelId = await this.sdk.loadModel({ modelSrc: this.sdk[MODEL], modelConfig: { ctx_size: 2048, device: 'cpu' } });
      this.device = 'cpu';
      this.state = 'READY';
    } catch (error) {
      this.state = 'ERROR';
      console.error('QVAC initialization failed:', (error as Error).name);
      throw new AppError('AI_INITIALIZATION_ERROR', 'The local AI model could not be loaded.');
    }
  }

  async generateResponse({ messages, maxTokens, timeoutMs, jsonSchema }: AiRequest): Promise<string> {
    if (this.state === 'BUSY') throw new AppError('AI_BUSY', 'The local AI is answering another question.');
    if (this.state !== 'READY' || !this.sdk || !this.modelId) throw new AppError('AI_INITIALIZATION_ERROR', 'The local AI is not ready.');
    const { sdk, modelId } = this;
    this.state = 'BUSY';
    let timer: NodeJS.Timeout | undefined;
    try {
      const run = sdk.completion({
        modelId, history: messages, stream: true,
        generationParams: { temp: 0, seed: 42, predict: maxTokens },
        ...(jsonSchema ? { responseFormat: { type: 'json_schema', json_schema: { name: 'intent', schema: jsonSchema } } } : {}),
      } as Parameters<Sdk['completion']>[0]);
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void sdk.cancel({ modelId, kind: 'completion' }).catch(() => undefined);
          reject(new AppError('AI_TIMEOUT', 'The local AI took too long to respond.'));
        }, timeoutMs);
      });
      const final = await Promise.race([run.final, timedOut]);
      const text = final.contentText?.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) throw new AppError('AI_INVALID_RESPONSE', 'The local AI returned an empty response.');
      return text;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('QVAC inference failed:', (error as Error).name);
      throw new AppError('AI_INFERENCE_ERROR', 'The local AI could not complete this request.');
    } finally {
      clearTimeout(timer);
      if (this.state === 'BUSY') this.state = 'READY';
    }
  }

  async shutdown(): Promise<void> {
    const { sdk, modelId } = this;
    this.state = 'SHUTTING_DOWN';
    this.modelId = null;
    if (sdk && modelId) await sdk.unloadModel({ modelId });
    this.state = 'NOT_INITIALIZED';
  }
}
