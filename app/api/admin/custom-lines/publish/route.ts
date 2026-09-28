import { NextResponse } from "next/server"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { gzipSync } from "zlib"
import { getAllLines, type CustomLine } from "@/lib/local-data"

// Apunta directo a la carpeta public/ del sitio público (proyecto separado),
// no a la de este proyecto de ruteo — así "publicar" deja el resultado listo
// para commitear/deployar sin pasos manuales de copiado.
const SITE_PUBLIC_DIR = "C:\\Users\\nicoc\\Desktop\\Nicolás\\Proyecto bondis\\Blog\\Página web 2\\public"
const VARIANTS_DIR = join(SITE_PUBLIC_DIR, "variants")

// Convierte las líneas guardadas de un mismo "ref" (línea general) al mismo
// formato que ya usan los archivos de variantes de OSM, para que
// route-sidebar.tsx no tenga que distinguir de dónde vino el archivo.
function toElements(linesForRef: CustomLine[]) {
  return linesForRef
    .filter((l) => typeof l.ramalRef === "string" && l.ramalRef.trim() !== "" && l.visible !== false && l.discontinued !== true)
    .sort((a, b) => {
      const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
      if (orderDiff !== 0) return orderDiff
      return (a.createdAt ?? 0) - (b.createdAt ?? 0)
    })
    .map((l) => ({
      type: "relation",
      id: l.ramalRef,
      tags: { name: l.name || l.ramalRef, colour: l.color },
      members: [
        {
          type: "way",
          geometry: l.points.map((p) => ({ lat: p.lat, lon: p.lon })),
        },
      ],
    }))
}

// NOTA: este endpoint escribe archivos en public/ del filesystem local — solo
// tiene efecto corriendo el admin con `npm run dev` (o similar) en tu
// máquina, nunca en Vercel (filesystem de solo lectura ahí). Después de
// publicar hay que commitear y deployar public/variants/*.json.gz como con
// cualquier otro archivo estático del repo.
//
// Lee de local-data/ (no de Firebase) — ver lib/local-data.ts.
//
// Body: { ref?: string } — con ref, republica solo esa línea (todos sus
// ramales juntos, porque el archivo es por línea, no por ramal individual);
// sin ref, republica TODAS las líneas que tengan al menos un ramal con
// ramalRef cargado.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const targetRef = typeof body.ref === "string" ? body.ref : null

  const allLines = targetRef ? getAllLines().filter((l) => l.ref === targetRef) : getAllLines()
  const refs = targetRef ? [targetRef] : [...new Set(allLines.map((l) => l.ref).filter(Boolean))]

  mkdirSync(VARIANTS_DIR, { recursive: true })

  let published = 0
  const publishedRefs: string[] = []
  const failed: { ref: string; error: string }[] = []
  for (const ref of refs) {
    // Una línea con datos corridos (ej. "points" vacío/roto de algún guardado
    // viejo) no debe tirar abajo la publicación de las otras 348 — antes un
    // solo error acá crasheaba todo el endpoint (500 sin JSON) y cortaba el
    // resto en seco, dejando publicadas solo las líneas ya escritas hasta
    // ese punto.
    try {
      const elements = toElements(allLines.filter((l) => l.ref === ref))
      if (elements.length === 0) continue
      writeFileSync(join(VARIANTS_DIR, `${ref}.json.gz`), gzipSync(JSON.stringify({ elements })))
      published++
      publishedRefs.push(ref)
    } catch (err) {
      failed.push({ ref, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ ok: true, published, refs: publishedRefs, failed })
}
