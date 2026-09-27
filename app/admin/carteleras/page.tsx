"use client"

import dynamic from "next/dynamic"

const CartelEditor = dynamic(() => import("@/components/admin/cartelera-editor").then((m) => m.CartelEditor), {
  ssr: false,
})

export default function CartelerasPage() {
  return <CartelEditor />
}
