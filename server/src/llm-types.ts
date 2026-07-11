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
  name?: string | undefined;
};

export type Msg =
  | { role: 'system' | 'user'; content: string; images?: readonly LLMImage[] | undefined }
  | { role: 'assistant'; content: string; toolCalls?: readonly LLMToolCall[] | undefined }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export type AgentStep = {
  text: string;
  toolCalls: LLMToolCall[];
  model: string;
  usage?: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    totalTokens?: number | undefined;
  } | undefined;
  upstreamRequestId?: string | undefined;
};
