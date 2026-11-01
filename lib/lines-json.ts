// Edición puntual de public/lines.json del sitio (se mantiene a mano y tiene los
// arreglos en una sola línea): se reemplazan solo "partidos", "localidades" y
// "description" de UNA línea, sin volver a formatear el resto del archivo.
import { join } from "path"

// Barras normales: con barras invertidas sueltas JS las toma como escapes.
export const LINES_JSON_PATH = join("C:/Users/nicoc/Desktop/Nicolás/Proyecto bondis/Blog/Página web 2/public", "lines.json")

const inlineArray = (list: string[]) => `[${list.map((s) => JSON.stringify(s)).join(", ")}]`

// Devuelve el texto nuevo, o null si la línea no está en el archivo.
export function patchLineZones(
  text: string,
  ref: string,
  zones: { partidos: string[]; localidades: string[]; description?: string; operator?: string; owner?: string },
): string | null {
  const refKey = `"ref": ${JSON.stringify(ref)}`
  const start = text.indexOf(refKey)
  if (start === -1) return null
  const endMatch = /\n\s*\}/.exec(text.slice(start))
  if (!endMatch) return null
  const end = start + endMatch.index
  let block = text.slice(start, end)

  const setValue = (key: string, valueRegex: string, value: string) => {
    const re = new RegExp(`("${key}":\\s*)${valueRegex}`)
    if (re.test(block)) block = block.replace(re, (_, pre: string) => `${pre}${value}`)
    else block = `${block.replace(/\s*$/, "")},\n    "${key}": ${value}`
  }

  setValue("partidos", "\\[[^\\]]*\\]", inlineArray(zones.partidos))
  setValue("localidades", "\\[[^\\]]*\\]", inlineArray(zones.localidades))
  // Texto entre comillas con escapes (\" y \\) permitidos dentro.
  if (zones.description !== undefined) setValue("description", '"(?:[^"\\\\]|\\\\.)*"', JSON.stringify(zones.description))
  // Empresa y grupo: solo si se cambiaron en Ruteo. "owner" falta en muchas
  // líneas; setValue lo agrega al final del bloque cuando no existe.
  if (zones.operator !== undefined) setValue("operator", '"(?:[^"\\\\]|\\\\.)*"', JSON.stringify(zones.operator))
  if (zones.owner !== undefined) setValue("owner", '"(?:[^"\\\\]|\\\\.)*"', JSON.stringify(zones.owner))

  return text.slice(0, start) + block + text.slice(end)
}
