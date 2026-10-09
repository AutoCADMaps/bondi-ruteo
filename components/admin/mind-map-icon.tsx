"use client"

// Dibuja un símbolo del mapa esquemático (ver lib/mind-map-icons.ts). Devuelve
// un <svg> propio, así sirve tanto suelto (HTML) como anidado dentro de otro
// <svg> (con x / y). Mismo estilo de trazo que los íconos de lucide.
//
// OJO: este archivo existe igual en los dos proyectos (Página web 2 y Ruteo).
import type { ComponentType, ReactNode, SVGProps } from "react"
import {
  Amphora,
  Anchor,
  BedDouble,
  Bird,
  Bus,
  Church,
  Drama,
  Factory,
  Footprints,
  Fuel,
  GraduationCap,
  Hospital,
  Landmark,
  Library,
  Orbit,
  Plane,
  Scale,
  School,
  Stamp,
  Store,
  Tractor,
  TrainFront,
  TreeDeciduous,
  Trophy,
} from "lucide-react"
import { MIND_MAP_ICONS } from "@/lib/mind-map-icons"

type LucideLike = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>

const LUCIDE: Record<string, LucideLike> = {
  Amphora, Anchor, BedDouble, Bird, Bus, Church, Drama, Factory, Footprints, Fuel, GraduationCap, Hospital, Landmark, Library, Orbit, Plane, Scale, School, Stamp, Store, Tractor, TrainFront, TreeDeciduous, Trophy,
}

const CUSTOM: Record<string, ReactNode> = {
  Barrera: (
    <>
      <path d="M2.5 11 10 4.5 17.5 11"/>
      <path d="M4.5 9.5V20h8"/>
      <path d="M8 20v-5h3v5"/>
      <rect x="14" y="16" width="8" height="6" rx="1.2"/>
      <path d="M16 16v-1.8a2 2 0 0 1 4 0V16"/>
    </>
  ),
  Estadio: (
    <>
      <ellipse cx="12" cy="11" rx="9" ry="4"/>
      <ellipse cx="12" cy="11" rx="5.500" ry="1.800"/>
      <path d="M3 11v5c0 2.200 4 4 9 4s9-1.800 9-4v-5"/>
      <path d="M3 13.800c0 1.800 4 3.300 9 3.300s9-1.500 9-3.300"/>
      <path d="M10 19.800v-2.300a2 2 0 0 1 4 0v2.300"/>
      <rect x="8.500" y="1.500" width="7" height="3.500" rx=".5"/>
      <path d="M11 5v2"/>
      <path d="M13 5v2"/>
      <path d="M4.500 8.500V3"/>
      <path d="M4.500 3 2 3.800l2.500.9"/>
      <path d="M19.500 8.500V3"/>
      <path d="M19.500 3 22 3.800l-2.500.9"/>
    </>
  ),
  Rotonda: (
    <>
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 3v5"/>
      <path d="M12 16v5"/>
      <path d="M3 12h5"/>
      <path d="M16 12h5"/>
    </>
  ),
  Puente: (
    <>
      <path d="M2 18h20"/>
      <path d="M4 18c0-6 3.5-10 8-10s8 4 8 10"/>
      <path d="M8 18v-6.5"/>
      <path d="M12 18V8"/>
      <path d="M16 18v-6.5"/>
    </>
  ),
  Tunel: (
    <>
      <path d="M3 21h18"/>
      <path d="M5 21V11a7 7 0 0 1 14 0v10"/>
      <path d="M12 21v-3"/>
      <path d="M12 15v-2"/>
    </>
  ),
  ArcoBarrio: (
    <>
      <path d="M3 21C3 9 7 3 12 3s9 6 9 18h-4c0-8-2-13-5-13S7 13 7 21z"/>
    </>
  ),
  Cementerio: (
    <>
      <path d="M7 21V9a5 5 0 0 1 10 0v12"/>
      <path d="M4 21h16"/>
      <path d="M12 8v6"/>
      <path d="M9.5 10.5h5"/>
    </>
  ),
  CruceVial: (
    <>
      <path d="M12 2v20"/>
      <path d="M2 12h20"/>
      <circle cx="16" cy="8" r="4"/>
      <circle cx="8" cy="16" r="4"/>
    </>
  ),
  Rejas: (
    <>
      <path d="M5 3v18"/>
      <path d="M9.700 3v18"/>
      <path d="M14.300 3v18"/>
      <path d="M19 3v18"/>
      <path d="M3 7.500h18"/>
      <path d="M3 16.500h18"/>
    </>
  ),
  Policia: (
    <>
      <path d="M8.5 9 6.5 4h11L15.5 9z"/>
      <path d="M7 9h10"/>
      <path d="M8.5 9v2.2a3.5 3.5 0 0 0 7 0V9"/>
      <circle cx="12" cy="6.6" r="0.9"/>
      <path d="M4 21c0-3.8 3-6 8-6s8 2.2 8 6"/>
      <path d="M12 15.6V19"/>
    </>
  ),
  Hipodromo: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="5.5"/>
      <rect x="7" y="10" width="10" height="4" rx="2"/>
    </>
  ),
  Autodromo: (
    <>
      <path d="M3.5 18.500 5.500 7c.3-1.700 2-2.500 3.500-1.700l3.500 2c1 .6 2.300.2 2.800-.8l.8-1.600c.6-1.200 2.200-1.400 3.200-.4s.9 2.500-.2 3.300l-5.800 4.200c-1.200.9-1 2.600.3 3.200l3.200 1.500c1.500.7 1.300 2.800-.3 3.200L7 20c-1.800.3-3.200-.6-3.500-1.500z"/>
      <path d="M5.300 13.500l-2.500.4"/>
    </>
  ),
  Bomberos: (
    <>
      <path d="M4.5 15C4.5 8.8 7.8 5 12 5s7.5 3.800 7.500 10"/>
      <path d="M2.5 15h19"/>
      <path d="M2.5 15c0 2.500 1.500 4 4 4h11c2.500 0 4-1.500 4-4"/>
      <path d="M9.500 8.500h5v3.500c0 1.600-1.200 2.300-2.500 2.800-1.300-.5-2.500-1.200-2.500-2.800z"/>
    </>
  ),
  Lago: (
    <>
      <path d="M3.500 11.500C3.500 8 6.500 5.500 10.500 5.500c2.200 0 3.200 1 5 1 2.700 0 5 1.300 5 4.200 0 2.700-2.300 3.800-4.300 4.800-1.800.9-2.700 2.800-5.200 3.200C7 19.200 3.500 16 3.500 11.500z"/>
      <path d="M8.500 11c1 .8 2 .8 3 0s2-.8 3 0"/>
    </>
  ),
  Balneario: (
    <>
      <path d="M7 14a5 5 0 0 1 10 0"/>
      <path d="M12 5.500V4"/>
      <path d="M5.800 8.200 4.700 7.100"/>
      <path d="M18.200 8.200l1.100-1.100"/>
      <path d="M2.500 17.500c1.800-1.500 3.200-1.500 5 0s3.200 1.500 5 0 3.200-1.500 5 0 3.200 1.500 4.500 0"/>
      <path d="M2.500 21c1.800-1.500 3.200-1.500 5 0s3.200 1.500 5 0 3.200-1.500 5 0 3.200 1.500 4.500 0"/>
    </>
  ),
  Arroyo: (
    <>
      <path d="M6 2.5c6 .5 7.500 4 4 6.500s-2.500 5 2 6.500c3 1 5.500 2.500 6 6"/>
      <path d="M13.500 2.500c2 .5 3 1.500 3.500 3"/>
    </>
  ),
  Barrio: (
    <>
      <path d="M1.500 21h21"/>
      <path d="M6 21V9.500l3.500-3.500 3.500 3.500V21"/>
      <path d="M13 12.500l3-2.500 3 2.500V21"/>
      <path d="M8.500 12h2v2h-2z"/>
      <path d="M15 15h2v2h-2z"/>
      <path d="M3 6.500c-1.600 1.500-1.600 4.500 0 6.500 1.600-2 1.600-5 0-6.500z"/>
      <path d="M3 13v8"/>
      <path d="M21.500 10c-1.400 1.300-1.400 4 0 5.800 1.400-1.800 1.400-4.500 0-5.800z"/>
      <path d="M21.500 15.800V21"/>
    </>
  ),
  Palacio: (
    <>
      <path d="M2 21h20"/>
      <path d="M3 21v-7h18v7"/>
      <path d="M8 14V9.500h8V14"/>
      <path d="M9 9.500a3 3 0 0 1 6 0"/>
      <path d="M12 6.500V3"/>
      <path d="M12 3h2.500"/>
      <path d="M6 21v-4"/>
      <path d="M10 21v-4"/>
      <path d="M14 21v-4"/>
      <path d="M18 21v-4"/>
    </>
  ),
  Militar: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>
      <path d="M12 8.500l1.100 2.200 2.400.3-1.800 1.700.5 2.400L12 14l-2.200 1.100.5-2.400-1.800-1.700 2.400-.3z"/>
    </>
  ),
  ClubFutbol: (
    <>
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 8.300l3.200 2.300-1.200 3.700h-4l-1.200-3.700z"/>
      <path d="M12 8.300V3.200"/>
      <path d="M15.200 10.600l4.600-1.500"/>
      <path d="M14 14.300l2.800 3.800"/>
      <path d="M10 14.300l-2.800 3.800"/>
      <path d="M8.800 10.600 4.200 9.100"/>
    </>
  ),
  ClubBasquet: (
    <>
      <circle cx="12" cy="12" r="9"/>
      <path d="M3 12h18"/>
      <path d="M12 3v18"/>
      <path d="M5.500 5.500c3 3 3 10 0 13"/>
      <path d="M18.500 5.500c-3 3-3 10 0 13"/>
    </>
  ),
  ClubGolf: (
    <>
      <path d="M3 21h18"/>
      <path d="M9 21V3.500"/>
      <path d="M9 3.500l8 3-8 3"/>
      <circle cx="16.500" cy="19" r="1.600"/>
    </>
  ),
  ClubPadel: (
    <>
      <path d="M9.500 2.500c3.600 0 5.800 2.200 5.800 5.500 0 3.500-2.800 6-5.800 6S3.700 11.500 3.700 8C3.700 4.700 5.900 2.500 9.500 2.500z"/>
      <path d="M9.500 14l-.8 7"/>
      <circle cx="8" cy="6.500" r=".6"/>
      <circle cx="11" cy="6.500" r=".6"/>
      <circle cx="9.500" cy="9" r=".6"/>
      <circle cx="17.500" cy="17" r="2.800"/>
    </>
  ),
  ClubNatacion: (
    <>
      <circle cx="17" cy="6.500" r="2"/>
      <path d="M4 12.500c3-3.500 6-4 9.500-1.500l3 2.500"/>
      <path d="M2.500 17c1.800-1.500 3.200-1.500 5 0s3.200 1.500 5 0 3.200-1.500 5 0 3.200 1.500 4.500 0"/>
      <path d="M2.500 20.500c1.800-1.500 3.200-1.500 5 0s3.200 1.500 5 0 3.200-1.500 5 0 3.200 1.500 4.500 0"/>
    </>
  ),
  ClubScout: (
    <>
      <path d="M12 2.500c2.300 2.200 2.800 5.800 0 9.800-2.800-4-2.300-7.600 0-9.800z"/>
      <path d="M12 12.300c-2-4-6.500-4.300-7.500-1.300s2 5 5.500 4.500"/>
      <path d="M12 12.300c2-4 6.500-4.300 7.500-1.300s-2 5-5.500 4.500"/>
      <path d="M8 16h8"/>
      <path d="M10 16v2.500l2 3 2-3V16"/>
    </>
  ),
  Polideportivo: (
    <>
      <rect x="2.500" y="5" width="19" height="14" rx="1.500"/>
      <path d="M12 5v14"/>
      <circle cx="12" cy="12" r="2.800"/>
      <path d="M2.500 9h4v6h-4"/>
      <path d="M21.500 9h-4v6h4"/>
    </>
  ),
  Diversiones: (
    <>
      <circle cx="12" cy="9.500" r="6.500"/>
      <circle cx="12" cy="9.500" r="1"/>
      <path d="M12 3v13"/>
      <path d="M5.500 9.500h13"/>
      <path d="M7.400 4.900l9.200 9.200"/>
      <path d="M16.600 4.900l-9.200 9.200"/>
      <path d="M12 9.500 7.500 21"/>
      <path d="M12 9.500 16.500 21"/>
      <path d="M5 21h14"/>
    </>
  ),
  Autopista: (
    <>
      <path d="M8.500 3 4 21"/>
      <path d="M15.500 3 20 21"/>
      <path d="M12 4v3"/>
      <path d="M12 10v3.500"/>
      <path d="M12 17v4"/>
    </>
  ),
  Avenida: (
    <>
      <path d="M5 3v18"/>
      <path d="M19 3v18"/>
      <path d="M11 3v18"/>
      <path d="M13 3v18"/>
      <path d="M8 7v2"/>
      <path d="M8 13v2"/>
      <path d="M16 7v2"/>
      <path d="M16 13v2"/>
    </>
  ),
  Monumento: (
    <>
      <path d="M5.500 21h13"/>
      <path d="M6.500 21v-2.500h11V21"/>
      <path d="M8.500 18.500 9 11h6l.5 7.500"/>
      <path d="M7.500 11h9V8.500h-9z"/>
      <path d="M7.500 8.500V4.500h2.300v2h4.400v-2h2.300v4"/>
    </>
  ),
  Panuelo: (
    <>
      <path d="M3 17.500C3.500 11 6.500 5.500 11.500 3.500H15c2 0 3 3 3 6 0 2.500-.7 4.500-1.800 6.500L21.500 20.500 16 18l-2 4 .8-4.500C10.500 17.200 6.500 17 3 17.500z"/>
      <path d="M14.800 6.500c1 0 1.800 2 1.800 4s-.8 3-1.800 3-1.800-1.500-1.800-3.500.8-3.500 1.800-3.500z"/>
    </>
  ),
  Obelisco: (
    <>
      <path d="M12 2l2 5 1.200 13H8.800L10 7z"/>
      <path d="M10 7h4"/>
      <path d="M6 21h12"/>
    </>
  ),
  Cabildo: (
    <>
      <path d="M3 21h18"/>
      <path d="M4 21V12h16v9"/>
      <path d="M7 21v-3a1.500 1.500 0 0 1 3 0v3"/>
      <path d="M14 21v-3a1.500 1.500 0 0 1 3 0v3"/>
      <path d="M10 12V6.500h4V12"/>
      <path d="M10 6.500 12 3l2 3.500"/>
    </>
  ),
  Mate: (
    <>
      <path d="M8 7.500C5.200 8.500 4.500 11 4.500 14c0 4.800 3 8 7.500 8s7.500-3.200 7.500-8c0-3-.7-5.500-3.500-6.500z"/>
      <path d="M8 7.500h8"/>
      <path d="M5.800 10.200h12.400"/>
      <path d="M5 1.800c.8-.5 1.600-.2 2 .6l2.400 5.100"/>
      <circle cx="7" cy="4.800" r="1"/>
    </>
  ),
}

const SHAPE_BY_KEY = new Map(MIND_MAP_ICONS.map((i) => [i.key, i.shape]))

export function MindMapIcon({
  iconKey, size = 16, x, y, color = "currentColor", strokeWidth = 2,
}: {
  iconKey: string
  size?: number
  x?: number
  y?: number
  color?: string
  strokeWidth?: number
}) {
  const shape = SHAPE_BY_KEY.get(iconKey)
  if (!shape) return null
  const [kind, name] = shape.split(":")
  if (kind === "lucide") {
    const Icon = LUCIDE[name]
    return Icon ? <Icon size={size} x={x} y={y} color={color} strokeWidth={strokeWidth} /> : null
  }
  const body = CUSTOM[name]
  if (!body) return null
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" x={x} y={y} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    >
      {body}
    </svg>
  )
}
