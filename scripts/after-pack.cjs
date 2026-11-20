// electron-builder afterPack: the embedded Postgres ships each library three times (npm can't keep
// symlinks, so libfoo.dylib, libfoo.77.dylib and libfoo.77.1.dylib are full copies). Turn the copies
// back into symlinks: about 200 MB less, same files for the loader.
const { createHash } = require('node:crypto')
const { readdirSync, readFileSync, lstatSync, unlinkSync, symlinkSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(ctx) {
  const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  const lib = join(app, 'Contents/Resources/app/node_modules/@embedded-postgres/darwin-arm64/native/lib')
  let names
  try { names = readdirSync(lib) } catch { return }
  const byHash = new Map()
  for (const n of names) {
    const p = join(lib, n)
    const st = lstatSync(p)
    if (!st.isFile() || st.size < 64 * 1024) continue
    const h = createHash('sha1').update(readFileSync(p)).digest('hex')
    if (!byHash.has(h)) byHash.set(h, [])
    byHash.get(h).push(n)
  }
  let saved = 0
  for (const group of byHash.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => b.length - a.length) // the fully versioned name keeps the file
    for (const n of group.slice(1)) {
      saved += lstatSync(join(lib, n)).size
      unlinkSync(join(lib, n))
      symlinkSync(group[0], join(lib, n))
    }
  }
  console.log(`  • postgres libraries deduplicated  saved=${Math.round(saved / 1e6)}MB`)
}
