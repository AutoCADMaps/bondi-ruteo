// Acceso al disco para el editor de carteleras. Nada de esto usa Firebase:
// las líneas salen de public/variants (los trazados ya descargados) y las
// imágenes se exportan a public/carteleras, ambas en el proyecto del sitio.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { gunzipSync } from "zlib"

const SITE_PUBLIC_DIR = "C:/Users/nicoc/Desktop/Nicolás/Proyecto bondis/Blog/Página web 2/public"
export const VARIANTS_DIR = join(SITE_PUBLIC_DIR, "variants")
export const CARTELERAS_DIR = join(SITE_PUBLIC_DIR, "carteleras")
// Archivos editables (JSON) de cada cartelera. Van en el proyecto del sitio pero
// FUERA de public/, así se versionan junto a las imágenes sin publicarse.
export const DESIGNS_DIR = "C:/Users/nicoc/Desktop/Nicolás/Proyecto bondis/Blog/Página web 2/carteleras-editables"

export const IMAGE_EXTS = ["jpg", "png", "gif"] as const
export type ImageExt = (typeof IMAGE_EXTS)[number]

export interface RamalItem {
  id: string
  name: string
  color: string
}

export interface LineGroup {
  line: string
  ramales: RamalItem[]
}

// Nombre de archivo permitido: el id del ramal (ej. "132A", "1-B.", "100-1G").
export function safeName(name: string): string | null {
  return /^[A-Za-z0-9._-]{1,64}$/.test(name) ? name : null
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" })

let cache: { stamp: number; lines: LineGroup[] } | null = null

// Lee los trazados publicados. Es un poco pesado (unos 7 MB comprimidos), así
// que se guarda en memoria y solo se vuelve a leer si la carpeta cambió.
export function readLines(force = false): LineGroup[] {
  const stamp = statSync(VARIANTS_DIR).mtimeMs
  if (!force && cache && cache.stamp === stamp) return cache.lines
  const lines: LineGroup[] = []
  for (const file of readdirSync(VARIANTS_DIR)) {
    if (!file.endsWith(".json.gz")) continue
    try {
      const json = JSON.parse(gunzipSync(readFileSync(join(VARIANTS_DIR, file))).toString("utf-8"))
      const ramales: RamalItem[] = (json.elements ?? [])
        .filter((e: any) => e && e.type === "relation" && e.id !== undefined)
        .map((e: any) => ({ id: String(e.id), name: String(e.tags?.name ?? ""), color: String(e.tags?.colour ?? "#7F00FF") }))
      ramales.sort((a, b) => naturalCompare(a.id, b.id))
      if (ramales.length) lines.push({ line: file.replace(/\.json\.gz$/, ""), ramales })
    } catch {
      // archivo ilegible: se saltea
    }
  }
  lines.sort((a, b) => naturalCompare(a.line, b.line))
  cache = { stamp, lines }
  return lines
}

// Qué carteleras ya hay exportadas: id de ramal -> extensión.
export function existingCarteleras(): Record<string, ImageExt> {
  const out: Record<string, ImageExt> = {}
  if (!existsSync(CARTELERAS_DIR)) return out
  for (const f of readdirSync(CARTELERAS_DIR)) {
    const m = /^(.+)\.(jpg|png|gif)$/i.exec(f)
    if (m) out[m[1]] = m[2].toLowerCase() as ImageExt
  }
  return out
}

// Ramales que tienen archivo editable guardado.
export function existingDesigns(): string[] {
  if (!existsSync(DESIGNS_DIR)) return []
  return readdirSync(DESIGNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
}

export function readDesign(name: string): unknown | null {
  const file = join(DESIGNS_DIR, `${name}.json`)
  if (!existsSync(file)) return null
  try {
    const json = JSON.parse(readFileSync(file, "utf-8"))
    // El archivo envuelve el diseño ({ formato, ramal, design }); se aceptan
    // también archivos que sean directamente el diseño.
    return json && typeof json === "object" && "design" in json ? json.design : json
  } catch {
    return null
  }
}

// El diseño se guarda con el id del ramal (designName) aunque la imagen se
// exporte con otro nombre, así al volver a elegir el ramal se recupera.
export function writeCartelera(name: string, designName: string, ext: ImageExt, image: Buffer, design: unknown) {
  mkdirSync(CARTELERAS_DIR, { recursive: true })
  mkdirSync(DESIGNS_DIR, { recursive: true })
  // Borra versiones anteriores con otra extensión para que no queden dos
  // archivos del mismo ramal compitiendo.
  for (const e of IMAGE_EXTS) {
    if (e === ext) continue
    const old = join(CARTELERAS_DIR, `${name}.${e}`)
    if (existsSync(old)) unlinkSync(old)
  }
  writeFileSync(join(CARTELERAS_DIR, `${name}.${ext}`), image)
  writeFileSync(
    join(DESIGNS_DIR, `${designName}.json`),
    JSON.stringify({ formato: "ruteo-cartelera", version: 1, ramal: designName, imagen: `${name}.${ext}`, design }, null, 1),
  )
}
