import { NextResponse } from "next/server"
import { IMAGE_EXTS, readDesign, safeName, writeCartelera, type ImageExt } from "@/lib/carteleras-fs"

// El nombre va por query/body (no en la ruta) porque los ids de ramal pueden
// terminar en punto ("132A."), que en una URL se presta a confusiones.
export async function GET(request: Request) {
  const name = safeName(new URL(request.url).searchParams.get("name") ?? "")
  if (!name) return NextResponse.json({ error: "Nombre inválido" }, { status: 400 })
  return NextResponse.json({ design: readDesign(name) })
}

// Escribe la imagen en public/carteleras del sitio y el diseño editable en
// data/carteleras de este proyecto. Solo funciona corriendo el admin en local.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const name = safeName(typeof body?.name === "string" ? body.name : "")
  if (!name || !body || typeof body.design !== "object" || typeof body.image !== "string" || !IMAGE_EXTS.includes(body.ext)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }
  const buf = Buffer.from(body.image, "base64")
  if (buf.length === 0 || buf.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Imagen vacía o mayor a 8MB" }, { status: 400 })
  }
  const designName = safeName(typeof body.designName === "string" ? body.designName : "") ?? name
  writeCartelera(name, designName, body.ext as ImageExt, buf, body.design)
  return NextResponse.json({ ok: true, file: `${name}.${body.ext}` })
}
