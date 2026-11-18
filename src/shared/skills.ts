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

/** An installed skill, with the chats (branches) and agents that use it. */
export type LibrarySkill = Skill & { chats: string[]; agents: string[] }

export type SkillsApi = {
  /** Every installed skill (Settings → Skills) */
  list(): Promise<LibrarySkill[]>
  files(skillId: string): Promise<string[]>
  read(skillId: string, path: string): Promise<{ text: string; binary: boolean }>
  write(skillId: string, path: string, text: string): Promise<void>
  remove(skillId: string): Promise<void>
  /** Skills loaded in a chat: attached to it, plus those of agents called in it. */
  forChat(workspaceId: string): Promise<ChatSkill[]>
  detach(workspaceId: string, skillId: string): Promise<void>
  body(skillId: string): Promise<string>
  /** Custom agents whose name or handle matches (for the @ menu), server side. */
  searchAgents(query: string): Promise<import('./types').Agent[]>
}
