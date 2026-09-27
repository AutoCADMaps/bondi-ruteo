"use client"

import dynamic from "next/dynamic"

const LineEditor = dynamic(() => import("@/components/admin/line-editor").then((m) => m.LineEditor), {
  ssr: false,
})

export default function AdminPanelPage() {
  return <LineEditor />
}
