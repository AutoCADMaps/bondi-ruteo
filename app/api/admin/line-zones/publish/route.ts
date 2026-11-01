import { NextResponse } from "next/server"
import { readFileSync, writeFileSync } from "fs"
import { getLineZones, setLineZones } from "@/lib/local-data"
import { LINES_JSON_PATH, patchLineZones } from "@/lib/lines-json"

// POST { ref } -> escribe los partidos, localidades y descripción guardados de
// esa línea en public/lines.json del sitio, y la empresa (operator) y el grupo
// (owner) si se cambiaron en Ruteo. Si la línea no existe en lines.json no la
// crea (devuelve 404). Siempre responde JSON, con el motivo si falla.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body.ref !== "string") return NextResponse.json({ error: "Falta ref" }, { status: 400 })
    const zones = getLineZones(body.ref)
    if (!zones) return NextResponse.json({ error: "Esa línea no tiene zonas guardadas" }, { status: 400 })
    const text = readFileSync(LINES_JSON_PATH, "utf8")
    const patched = patchLineZones(text, body.ref, zones)
    if (patched === null) return NextResponse.json({ error: `La línea ${body.ref} no está en lines.json del sitio` }, { status: 404 })
    // Si quedó mal formado, o la línea no tiene lo que se esperaba, no se escribe.
    const check = (
      JSON.parse(patched) as Array<{ ref: string; partidos?: string[]; localidades?: string[]; description?: string; operator?: string; owner?: string }>
    ).find((l) => l.ref === body.ref)
    if (
      !check ||
      JSON.stringify(check.partidos) !== JSON.stringify(zones.partidos) ||
      JSON.stringify(check.localidades) !== JSON.stringify(zones.localidades) ||
      (zones.description !== undefined && check.description !== zones.description) ||
      (zones.operator !== undefined && check.operator !== zones.operator) ||
      (zones.owner !== undefined && check.owner !== zones.owner)
    ) {
      return NextResponse.json({ error: "La verificación previa a escribir falló; no se tocó lines.json" }, { status: 500 })
    }
    writeFileSync(LINES_JSON_PATH, patched)
    // Ya está en lines.json: se suelta lo guardado de empresa y grupo, así a
    // partir de ahora vuelve a mandar lines.json (y no queda un valor viejo).
    const companyPublished = zones.operator !== undefined || zones.owner !== undefined
    if (companyPublished) setLineZones(body.ref, { ...zones, operator: undefined, owner: undefined })
    return NextResponse.json({
      ok: true,
      partidos: zones.partidos.length,
      localidades: zones.localidades.length,
      description: Boolean(zones.description),
      company: companyPublished,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `No se pudo escribir lines.json: ${msg}` }, { status: 500 })
  }
}
