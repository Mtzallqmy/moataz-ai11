import { complete, type LLMImage, type Msg, type Provider } from './llm.js';
import { AppError } from './errors.js';
import { redactText } from './redaction.js';

export type MultiAgentTrace = {
  provider: string;
  role: string;
  status: 'succeeded' | 'failed';
  output?: string;
  errorCode?: string;
};

const roles = [
  'Lead analyst: identify the core problem, constraints, and a precise solution.',
  'Critical reviewer: find hidden failure modes, security risks, and incorrect assumptions.',
  'Implementation engineer: propose concrete production-ready steps, code structure, and validation.'
] as const;

function priorConversation(messages: readonly Msg[]): string {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-12)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n');
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'agent_error';
}

export async function runMultiAgent(input: {
  providers: readonly Provider[];
  messages: readonly Msg[];
  userContent: string;
  images?: readonly LLMImage[];
}): Promise<{ answer: string; traces: MultiAgentTrace[] }> {
  const providers = input.providers.slice(0, 3);
  if (providers.length === 0) throw new AppError('provider_not_verified', 409);
  const context = priorConversation(input.messages);
  const assignments = providers.map((provider, index) => ({ provider, role: roles[index] ?? roles[0] }));
  const settled = await Promise.all(assignments.map(async ({ provider, role }): Promise<MultiAgentTrace> => {
    try {
      const output = await complete(provider, [
        {
          role: 'system',
          content: `${role}\nReply in the user's language. Be concise but technically exact. Do not claim to have run tools or changed external systems.`
        },
        {
          role: 'user',
          content: `${context ? `Conversation context:\n${context}\n\n` : ''}Current request:\n${input.userContent}`,
          ...(input.images?.length ? { images: input.images } : {})
        }
      ], provider.defaultModel);
      return { provider: provider.name, role, status: 'succeeded', output: output.slice(0, 12_000) };
    } catch (error) {
      return {
        provider: provider.name,
        role,
        status: 'failed',
        errorCode: errorCode(error),
        output: redactText(error instanceof Error ? error.message : String(error)).slice(0, 800)
      };
    }
  }));

  const successful = settled.filter((trace) => trace.status === 'succeeded' && trace.output);
  if (successful.length === 0) {
    throw new AppError('multi_agent_failed', 502, 'All selected agents failed.', { traces: settled });
  }
  if (successful.length === 1) return { answer: successful[0]!.output!, traces: settled };

  const lead = providers[0]!;
  const reports = successful.map((trace, index) => `Report ${index + 1} — ${trace.provider} (${trace.role}):\n${trace.output}`).join('\n\n');
  const answer = await complete(lead, [
    {
      role: 'system',
      content: 'You are the lead orchestrator. Synthesize the independent reports into one accurate, non-redundant answer in the user language. Resolve disagreements, preserve important warnings, and do not mention internal orchestration unless it is useful.'
    },
    { role: 'user', content: `Original request:\n${input.userContent}\n\nIndependent reports:\n${reports}` }
  ], lead.defaultModel);
  return { answer, traces: settled };
}
