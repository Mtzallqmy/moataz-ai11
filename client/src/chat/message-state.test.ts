import { describe, expect, it } from 'vitest';
import { reconcileMessageResponse, type ChatMessage } from './message-state';

const temporary: ChatMessage = { id: 'temp-1', role: 'user', content: 'hello', tool_calls: [] };
const persisted: ChatMessage = { id: 'user-1', role: 'user', content: 'hello', tool_calls: [] };
const assistant: ChatMessage = { id: 'assistant-1', role: 'assistant', content: 'hi', tool_calls: [] };

describe('chat message reconciliation', () => {
  it('replaces the optimistic message instead of duplicating it', () => {
    const result = reconcileMessageResponse([temporary], temporary.id, persisted, assistant);
    expect(result.map((message) => message.id)).toEqual(['user-1', 'assistant-1']);
    expect(result.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('does not append the same assistant response twice', () => {
    const first = reconcileMessageResponse([temporary], temporary.id, persisted, assistant);
    const second = reconcileMessageResponse(first, temporary.id, persisted, assistant);
    expect(second.filter((message) => message.id === assistant.id)).toHaveLength(1);
  });
});
