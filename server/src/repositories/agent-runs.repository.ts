import { and, eq, isNull, sql } from 'drizzle-orm';
import { database } from '../database/client.js';
import { agentRuns, agentSteps, attachments, messages, toolExecutions } from '../database/schema.js';

async function nextSequence(tx: Parameters<Parameters<typeof database.transaction>[0]>[0], chatId: string): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chatId}))`);
  const [row] = await tx.select({ next: sql<number>`COALESCE(MAX(${messages.sequence}), 0)::bigint + 1` })
    .from(messages).where(eq(messages.chatId, chatId));
  return Number(row?.next ?? 1);
}

export const agentRunsRepository = {
  async findRunning(chatId: string): Promise<{ id: string } | undefined> {
    const [row] = await database.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(eq(agentRuns.chatId, chatId), eq(agentRuns.status, 'running')))
      .limit(1);
    return row;
  },

  async begin(input: {
    runId: string;
    userId: string;
    chatId: string;
    providerId: string | null;
    model: string | null;
    userMessage: { id: string; content: string; idempotencyKey: string };
    attachmentIds: readonly string[];
  }): Promise<number> {
    return database.transaction(async (tx) => {
      const sequence = await nextSequence(tx, input.chatId);
      await tx.insert(messages).values({
        id: input.userMessage.id,
        chatId: input.chatId,
        userId: input.userId,
        sequence,
        role: 'user',
        content: input.userMessage.content,
        toolCalls: [],
        legacyToolCalls: '[]',
        idempotencyKey: input.userMessage.idempotencyKey
      });
      await tx.insert(agentRuns).values({
        id: input.runId,
        userId: input.userId,
        chatId: input.chatId,
        providerId: input.providerId,
        model: input.model,
        status: 'running',
        legacyLog: ''
      });
      for (const attachmentId of input.attachmentIds) {
        const rows = await tx.update(attachments).set({ messageId: input.userMessage.id })
          .where(and(
            eq(attachments.id, attachmentId),
            eq(attachments.chatId, input.chatId),
            eq(attachments.userId, input.userId),
            isNull(attachments.messageId)
          )).returning({ id: attachments.id });
        if (rows.length !== 1) throw new Error('attachment_binding_failed');
      }
      return sequence;
    });
  },

  async complete(input: {
    runId: string;
    userId: string;
    assistantMessage: {
      id: string;
      chatId: string;
      content: string;
      toolCalls: unknown[];
      idempotencyKey: string;
    };
    summary: Record<string, unknown>;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): Promise<number> {
    return database.transaction(async (tx) => {
      const sequence = await nextSequence(tx, input.assistantMessage.chatId);
      await tx.insert(messages).values({
        id: input.assistantMessage.id,
        chatId: input.assistantMessage.chatId,
        userId: input.userId,
        sequence,
        role: 'assistant',
        content: input.assistantMessage.content,
        toolCalls: input.assistantMessage.toolCalls,
        legacyToolCalls: JSON.stringify(input.assistantMessage.toolCalls),
        idempotencyKey: input.assistantMessage.idempotencyKey
      });
      await tx.update(agentRuns).set({
        status: 'completed',
        finishedAt: sql`CURRENT_TIMESTAMP`,
        legacyCompletedAt: sql`CURRENT_TIMESTAMP`,
        summary: input.summary,
        legacyLog: JSON.stringify(input.summary),
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        updatedAt: sql`CURRENT_TIMESTAMP`
      }).where(and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, input.userId)));
      return sequence;
    });
  },

  async fail(input: { runId: string; userId: string; errorCode: string; errorMessage?: string }): Promise<void> {
    await database.update(agentRuns).set({
      status: 'failed',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage?.slice(0, 1200),
      finishedAt: sql`CURRENT_TIMESTAMP`,
      legacyCompletedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`
    }).where(and(eq(agentRuns.id, input.runId), eq(agentRuns.userId, input.userId)));
  },

  async createStep(input: {
    id: string;
    agentRunId: string;
    stepNumber: number;
    type: string;
    status: string;
    inputMetadata?: Record<string, unknown>;
  }): Promise<void> {
    await database.insert(agentSteps).values({
      id: input.id,
      agentRunId: input.agentRunId,
      stepNumber: input.stepNumber,
      type: input.type,
      status: input.status,
      inputMetadata: input.inputMetadata ?? {}
    });
  },

  async finishStep(input: {
    id: string;
    status: string;
    outputMetadata?: Record<string, unknown>;
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await database.update(agentSteps).set({
      status: input.status,
      outputMetadata: input.outputMetadata ?? {},
      finishedAt: sql`CURRENT_TIMESTAMP`,
      durationMs: input.durationMs,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage?.slice(0, 1200)
    }).where(eq(agentSteps.id, input.id));
  },

  async createToolExecution(input: {
    id: string;
    agentRunId: string;
    agentStepId?: string;
    toolName: string;
    status: string;
    arguments: Record<string, unknown>;
  }): Promise<void> {
    await database.insert(toolExecutions).values({
      id: input.id,
      agentRunId: input.agentRunId,
      agentStepId: input.agentStepId,
      toolName: input.toolName,
      status: input.status,
      arguments: input.arguments
    });
  },

  async finishToolExecution(input: {
    id: string;
    status: string;
    resultMetadata?: Record<string, unknown>;
    durationMs?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await database.update(toolExecutions).set({
      status: input.status,
      resultMetadata: input.resultMetadata ?? {},
      finishedAt: sql`CURRENT_TIMESTAMP`,
      durationMs: input.durationMs,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage?.slice(0, 1200)
    }).where(eq(toolExecutions.id, input.id));
  }
};
