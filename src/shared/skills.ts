/** Skills a chat loads, and the custom agents a chat refines (an agent is instructions + skills, called with @handle). */

export type Skill = {
  id: string
  slug: string
  name: string
  description: string
  sourceUrl: string | null
  /** Folder on disk with SKILL.md and its files */
  dir: string
  files: number
  at: number
}

/** A skill as loaded in one chat, with where it came from. */
export type ChatSkill = Skill & { via: 'chat' | 'agent'; agent?: string; addedAt: number }

export type SkillsApi = {
  /** Skills loaded in a chat: attached to it, plus those of agents called in it. */
  forChat(workspaceId: string): Promise<ChatSkill[]>
  detach(workspaceId: string, skillId: string): Promise<void>
  body(skillId: string): Promise<string>
  /** Custom agents whose name or handle matches (for the @ menu), server side. */
  searchAgents(query: string): Promise<import('./types').Agent[]>
}
