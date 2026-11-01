import { NextResponse } from "next/server"
import { getLineZones, setLineZones } from "@/lib/local-data"
import { getSiteCompanyOptions, getSiteLineZones } from "@/lib/zones"

// GET ?ref=275 -> zonas guardadas de esa línea. Si todavía no se guardó nada
// en Ruteo, parte de lo que ya tiene la línea en lines.json del sitio
// (source: "site"); si tampoco está ahí, vacío.
// Empresa (operator) y grupo (owner) salen siempre de lines.json, salvo que se
// hayan cambiado en Ruteo y todavía no se hayan publicado. Con `options` van las
// empresas y grupos que ya existen, para sugerirlos al escribir.
export async function GET(request: Request) {
  const ref = new URL(request.url).searchParams.get("ref")
  if (!ref) return NextResponse.json({ error: "Falta ref" }, { status: 400 })
  const saved = getLineZones(ref)
  const site = getSiteLineZones(ref)
  const company = {
    operator: saved?.operator ?? site?.operator ?? "",
    owner: saved?.owner ?? site?.owner ?? "",
    options: getSiteCompanyOptions(),
  }
  if (saved) return NextResponse.json({ ...saved, ...company, source: "saved" })
  if (site) return NextResponse.json({ ...site, ...company, source: "site" })
  return NextResponse.json({ partidos: [], localidades: [], description: "", ...company, source: "empty" })
}

const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []

// PUT { ref, partidos, localidades } -> guarda en local-data/line-zones.json.
// No filtra por los polígonos: hay localidades en lines.json (Ensenada,
// Punta Lara, Zárate...) que no tienen polígono propio y no deben perderse.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.ref !== "string" || !body.ref.trim()) {
    return NextResponse.json({ error: "Falta ref" }, { status: 400 })
  }
  // Sin "description" en el pedido se conserva la que ya había.
  const description = typeof body.description === "string" ? body.description : (getLineZones(body.ref)?.description ?? "")
  // Empresa y grupo: solo se guardan si difieren de lo que dice lines.json (si
  // son iguales no hay nada que cambiar, y así no se pisa con un valor viejo lo
  // que se edite a mano en lines.json). Sin el campo en el pedido se conserva
  // lo que ya había.
  const site = getSiteLineZones(body.ref)
  const previous = getLineZones(body.ref)
  const company = (key: "operator" | "owner"): string | undefined => {
    if (typeof body[key] !== "string") return previous?.[key]
    const value = body[key].trim()
    return value === (site?.[key] ?? "") ? undefined : value
  }
  const zones = {
    partidos: cleanList(body.partidos),
    localidades: cleanList(body.localidades),
    description,
    operator: company("operator"),
    owner: company("owner"),
  }
  setLineZones(body.ref, zones)
  return NextResponse.json(zones)
}
