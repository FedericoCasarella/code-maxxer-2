import { db } from '../db'

/** The language the models write to the user in. 'auto': the language the user writes in. */
export const LANGUAGES: Record<string, string> = {
  auto: 'Same as my messages',
  it: 'Italiano',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português'
}
const NAME: Record<string, string> = { it: 'Italian', en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese' }

const KEY = 'language:models'
export const modelLanguage = async () => (await db.getSetting<string>(KEY)) ?? 'auto'
export const setModelLanguage = (lang: string) => db.setSetting(KEY, LANGUAGES[lang] ? lang : 'auto')

/** The app's interface language, reported by the window. */
export const setUiLanguage = (lang: string) => db.setSetting('language:ui', NAME[lang] ? lang : 'en')

/**
 * For reviews written in the background (lessons, the strategist): there is no "latest message" to follow,
 * so 'auto' means the language of the interface.
 */
export async function reportLanguageRule(): Promise<string> {
  const l = await modelLanguage()
  const lang = l !== 'auto' && NAME[l] ? l : ((await db.getSetting<string>('language:ui')) ?? 'en')
  return `LANGUAGE: write everything the user reads in ${NAME[lang] ?? 'English'}, whatever language the request, the code or the files use.`
}

/** For every prompt that writes something the user reads. */
export async function languageRule(): Promise<string> {
  const l = await modelLanguage()
  if (l === 'auto' || !NAME[l])
    return 'LANGUAGE: always write to the user in the language of their latest message, whatever language the code, files or tools use.'
  return (
    `LANGUAGE: always write to the user in ${NAME[l]}, every time, whatever language their message, the code, the files or the tools use: ` +
    'replies, questions, plans, summaries, findings, lessons. Code, identifiers, file names and commands stay as they are.'
  )
}
