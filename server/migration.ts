import { constants } from 'node:fs'
import { access, copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

// Keep the old state intact; a prior install may still be running or be needed
// as a backup. Never replace state already written under the new name.
export async function migrateLegacyState(legacy: string, destination: string): Promise<boolean> {
  if (await access(destination).then(() => true, () => false)) return false
  if (await access(legacy).then(() => false, () => true)) return false
  await mkdir(path.dirname(destination), { recursive: true })
  try { await copyFile(legacy, destination, constants.COPYFILE_EXCL); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
}
