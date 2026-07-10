export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  result?: unknown;
  error?: { code: string; message: string };
  startedAt?: string;
  finishedAt?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: ToolCall[];
};

export function reconcileMessageResponse(
  previous: ChatMessage[],
  temporaryId: string,
  persistedUserMessage: ChatMessage | undefined,
  assistantMessage: ChatMessage
): ChatMessage[] {
  const reconciledUser = previous.map((message) =>
    message.id === temporaryId ? (persistedUserMessage ?? message) : message
  );

  const assistantIndex = reconciledUser.findIndex((message) => message.id === assistantMessage.id);
  if (assistantIndex === -1) return [...reconciledUser, assistantMessage];

  return reconciledUser.map((message, index) => index === assistantIndex ? assistantMessage : message);
}
