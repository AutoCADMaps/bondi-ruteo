import { NextResponse } from "next/server"
import { listStopImages, readCredit } from "@/lib/stop-images"

// ids de las paradas que ya tienen foto (lee la carpeta, no Firebase).
export async function GET() {
  const ids = [...listStopImages()]
  return NextResponse.json({ ids, credits: Object.fromEntries(ids.map((id) => [id, readCredit(id)])) })
}
