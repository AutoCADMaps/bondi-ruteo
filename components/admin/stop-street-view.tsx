"use client"

import { useEffect, useRef, useState } from "react"
import { Eye } from "lucide-react"
import { Button } from "@/components/ui/button"

// Visor de Street View dentro del diálogo de la parada, con la Maps JavaScript
// API: se apagan los nombres de las calles y el recuadro de la dirección (el
// logo y los derechos de autor de Google no se pueden sacar). Es solo para
// mirar mientras se carga la parada: las condiciones de uso no permiten
// guardar esas imágenes. La clave va en .env.local como
// NEXT_PUBLIC_GOOGLE_MAPS_KEY (clave de navegador, restringida por dominio).
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY

let loader: Promise<any> | null = null

function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("sin ventana"))
  const w = window as any
  if (w.google?.maps?.StreetViewPanorama) return Promise.resolve(w.google)
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    w.__initGoogleMaps = () => resolve(w.google)
    const s = document.createElement("script")
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY ?? "")}&v=weekly&callback=__initGoogleMaps`
    s.async = true
    s.onerror = () => { loader = null; reject(new Error("No se pudo cargar Google Maps")) }
    document.head.appendChild(s)
  })
  return loader
}

// Rumbo (0–360°) desde el punto A hacia el B, para que el visor mire a la parada.
function bearing(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = Math.PI / 180
  const y = Math.sin((bLng - aLng) * r) * Math.cos(bLat * r)
  const x = Math.cos(aLat * r) * Math.sin(bLat * r) - Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r)
  return ((Math.atan2(y, x) / r) + 360) % 360
}

export function StopStreetView({ lat, lng }: { lat: number; lng: number }) {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState(true)
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "nocover" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const panoRef = useRef<any>(null)

  useEffect(() => {
    if (!open || !KEY) return
    let cancelled = false
    setStatus("loading")
    setMessage(null)
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !boxRef.current) return
        new google.maps.StreetViewService().getPanorama(
          { location: { lat, lng }, radius: 60, source: google.maps.StreetViewSource.OUTDOOR },
          (data: any, st: string) => {
            if (cancelled || !boxRef.current) return
            if (st !== "OK" || !data?.location?.latLng) {
              setStatus("nocover")
              return
            }
            const here = data.location.latLng
            panoRef.current = new google.maps.StreetViewPanorama(boxRef.current, {
              pano: data.location.pano,
              pov: { heading: bearing(here.lat(), here.lng(), lat, lng), pitch: 0 },
              showRoadLabels: false,
              addressControl: false,
              linksControl: links,
              enableCloseButton: false,
              fullscreenControl: false,
              motionTracking: false,
              motionTrackingControl: false,
            })
            setStatus("ok")
          },
        )
      })
      .catch((e) => {
        if (cancelled) return
        setStatus("error")
        setMessage(e.message)
      })
    return () => {
      cancelled = true
      panoRef.current?.setVisible?.(false)
      panoRef.current = null
    }
    // links se aplica aparte, sin recrear el visor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lat, lng])

  useEffect(() => {
    panoRef.current?.setOptions?.({ linksControl: links })
  }, [links])

  if (!KEY) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Para ver Street View acá, poné tu clave de la Maps JavaScript API en <code>.env.local</code> como{" "}
        <code>NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> y reiniciá el servidor.
      </p>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          <Eye className="h-4 w-4" /> {open ? "Ocultar Street View" : "Ver Street View"}
        </Button>
        {open && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={links} onChange={(e) => setLinks(e.target.checked)} /> Flechas para moverse
          </label>
        )}
      </div>
      {open && (
        <>
          <div
            ref={boxRef}
            className="w-full overflow-hidden rounded border"
            style={{ height: 260, display: status === "ok" || status === "loading" ? "block" : "none" }}
          />
          {status === "loading" && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {status === "nocover" && <p className="text-xs text-muted-foreground">No hay Street View a menos de 60 m de esta parada.</p>}
          {status === "error" && <p className="text-xs text-destructive">{message ?? "No se pudo cargar Street View."}</p>}
          <p className="text-[10px] text-muted-foreground">Solo para consultar: no se guardan ni se reutilizan las imágenes.</p>
        </>
      )}
    </div>
  )
}
