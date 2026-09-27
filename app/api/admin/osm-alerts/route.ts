import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"

const COLLECTION = "osm-alerts"

export async function GET(request: Request) {
  const snap = await adminDb.collection(COLLECTION).where("resolved", "==", false).get()
  const alerts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json({ alerts })
}
