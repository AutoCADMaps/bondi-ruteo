import { NextResponse } from "next/server"

// Vista previa del orden del mapa esquemático. El esquema lo arma el sitio
// (lib/mind-map.ts), así que se le pregunta al sitio corriendo con `npm run dev`
// (ruta /api/mindmap-preview, solo de desarrollo). Se prueba SITE_DEV_URL si
// está definida y si no los puertos 3000 y 3001, salteando el de Ruteo.
export async function POST(request: Request) {
  const body = await request.text()
  const ownPort = new URL(request.url).port
  const candidates = [
    process.env.SITE_DEV_URL,
    ...["3000", "3001"].filter((p) => p !== ownPort).map((p) => `http://localhost:${p}`),
  ].filter((u): u is string => !!u)

  for (const base of candidates) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/mindmap-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      if (data && Array.isArray(data.rows)) return NextResponse.json(data)
    } catch {
      // probar el siguiente
    }
  }
  return NextResponse.json(
    {
      error:
        "Para ordenar el esquema tiene que estar prendido también el sitio (la carpeta Página web 2, con npm run dev), porque el esquema lo arma el sitio. Ahora solo está prendido Ruteo. Prendé el sitio y tocá Ocultar y Editar de nuevo.",
    },
    { status: 503 },
  )
}
