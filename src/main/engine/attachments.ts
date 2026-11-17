import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Attachment } from '@shared/types'

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
/** Claude takes images up to 5 MB each. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Outside the worktree, so attachments never end up in a commit. */
export async function saveAttachment(workspaceId: string, name: string, data: ArrayBuffer): Promise<Attachment> {
  const clean = basename(name).replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file'
  const kind = IMAGE.has(extname(clean).toLowerCase()) ? 'image' : 'file'
  if (data.byteLength > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES))
    throw new Error(`${clean} is too large (max ${kind === 'image' ? '5' : '20'} MB)`)
  const dir = join(homedir(), '.code-maxxer-2', 'attachments', workspaceId.replace(/[^\w-]/g, ''), randomUUID().slice(0, 8))
  await mkdir(dir, { recursive: true })
  const path = join(dir, clean)
  await writeFile(path, Buffer.from(data))
  return { path, name: clean, kind, size: data.byteLength }
}
