import { NextResponse } from "next/server"
import { loadWaysFromTiles } from "@/lib/street-tiles"

// Solo lee de los archivos pre-bajados por partido (scripts/build-street-tiles.mjs)
// — nunca le pega a Overpass en vivo acá. Eso evita microcargas repetidas
// contra el servidor público cada vez que alguien mueve el mapa; Overpass
// se usa únicamente cuando vos corrés el script a mano para actualizar un
// partido.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bbox = searchParams.get("bbox") // "minLat,minLon,maxLat,maxLon"
  if (!bbox) return NextResponse.json({ error: "Falta bbox" }, { status: 400 })

  const [minLat, minLon, maxLat, maxLon] = bbox.split(",").map(Number)
  const ways = loadWaysFromTiles({ minLat, minLon, maxLat, maxLon })

  if (!ways) {
    return NextResponse.json(
      { ways: [], error: "Esta zona todavía no se bajó. Corré scripts/build-street-tiles.mjs para el partido correspondiente." },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  return NextResponse.json({ ways }, { headers: { "Cache-Control": "no-store" } })
}
