export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  createdAt: string
}

export interface Provider {
  id: string
  name: string
  type: 'gemini' | 'openai-compatible' | 'anthropic' | 'nvidia' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'custom'
  apiKey: string
  baseUrl?: string
  model?: string
  isEnabled: boolean
  lastTested?: string
  status: 'connected' | 'error' | 'untested'
  errorMessage?: string
  models?: string[]
}

export interface Chat {
  id: string
  title: string
  providerId: string
  model: string
  mode: 'chat' | 'agent'
  createdAt: string
  updatedAt: string
  messageCount: number
  projectId?: string
}

export interface Message {
  id: string
  chatId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: string
  model?: string
  tokens?: number
  toolCalls?: ToolCall[]
  isStreaming?: boolean
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, any>
  result?: string
  status: 'pending' | 'success' | 'error'
}

export interface AgentStep {
  id: string
  step: number
  title: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'error'
  toolName?: string
  result?: string
  duration?: number
}

export interface Integration {
  id: string
  type: 'github' | 'telegram' | 'mcp'
  name: string
  connected: boolean
  config: Record<string, any>
  lastSync?: string
  status: string
}

export interface Project {
  id: string
  name: string
  description?: string
  createdAt: string
  chatCount: number
}
