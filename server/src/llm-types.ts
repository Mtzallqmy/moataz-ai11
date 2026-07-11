export type LLMToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LLMImage = {
  mimeType: string;
  dataBase64: string;
  name?: string;
};

export type Msg =
  | { role: 'system' | 'user'; content: string; images?: readonly LLMImage[] }
  | { role: 'assistant'; content: string; toolCalls?: readonly LLMToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export type AgentStep = {
  text: string;
  toolCalls: LLMToolCall[];
  model: string;
  requestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};
