// Italian, one file per area of the app, merged in name order: zz-common.ts last, so its choices win.
const files = import.meta.glob<Record<string, string>>(['./*.ts', '!./index.ts'], { eager: true, import: 'default' })
export const it: Record<string, string> = Object.assign({}, ...Object.keys(files).sort().map((k) => files[k]))
