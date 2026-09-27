import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
const projectId = "bondi-maps-4621d"

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]
  if (!clientEmail || !privateKey) throw new Error("Faltan credenciales de Firebase Admin")
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}

export const adminDb = getFirestore(getAdminApp())
