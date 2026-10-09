// Símbolos del mapa esquemático (mapa mental) y reglas para elegir el símbolo
// de una parada según el comienzo de su nombre. Sin React: lo usan tanto el
// servidor (lib/mind-map.ts) como los componentes que dibujan los íconos.
//
// OJO: este archivo existe igual en los dos proyectos (Página web 2 y Ruteo).
// Si se cambia una regla o un símbolo, cambiarlo en los dos.

export interface MindMapIconDef {
  key: string
  label: string
  // "lucide:Nombre" (ícono de lucide-react) o "custom:Nombre" (dibujo propio,
  // ver components/mind-map-icon.tsx).
  shape: string
  // true = se reconoce solo por el nombre de la parada; false = solo se
  // puede elegir a mano en Ruteo.
  auto: boolean
}

export const MIND_MAP_ICONS: MindMapIconDef[] = [
  { key: "estacion", label: "Estación", shape: "lucide:TrainFront", auto: true },
  { key: "teatro", label: "Teatro / Auditorio", shape: "lucide:Drama", auto: true },
  { key: "fabrica", label: "Fábrica / Empresa / Parque Industrial", shape: "lucide:Factory", auto: true },
  { key: "barrio_privado", label: "Barrio privado / Country / Estancia", shape: "custom:Barrera", auto: true },
  { key: "estadio", label: "Estadio", shape: "custom:Estadio", auto: true },
  { key: "escuela", label: "Escuela / Colegio", shape: "lucide:School", auto: true },
  { key: "terminal", label: "Centro de Trasbordo / Terminal de Ómnibus", shape: "lucide:Bus", auto: true },
  { key: "rotonda", label: "Rotonda", shape: "custom:Rotonda", auto: true },
  { key: "plaza", label: "Plaza / Plazoleta / Parque / Jardín Botánico / Bosque", shape: "lucide:TreeDeciduous", auto: true },
  { key: "reserva", label: "Reserva Natural / Ecológica", shape: "lucide:Bird", auto: true },
  { key: "puente", label: "Puente", shape: "custom:Puente", auto: true },
  { key: "tunel", label: "Túnel", shape: "custom:Tunel", auto: true },
  { key: "arco", label: "Arco", shape: "custom:ArcoBarrio", auto: true },
  { key: "cementerio", label: "Cementerio", shape: "custom:Cementerio", auto: true },
  { key: "cruce", label: "Cruce", shape: "custom:CruceVial", auto: true },
  { key: "hospital", label: "Hospital / Clínica / Sanatorio / Farmacia", shape: "lucide:Hospital", auto: true },
  { key: "puerto", label: "Astillero / Puerto", shape: "lucide:Anchor", auto: true },
  { key: "aeropuerto", label: "Aeropuerto / Aeródromo", shape: "lucide:Plane", auto: true },
  { key: "municipalidad", label: "Municipalidad", shape: "lucide:Landmark", auto: true },
  { key: "penal", label: "Penal / Unidad Penitenciaria", shape: "custom:Rejas", auto: true },
  { key: "comisaria", label: "Comisaría", shape: "custom:Policia", auto: true },
  { key: "hipodromo", label: "Hipódromo", shape: "custom:Hipodromo", auto: true },
  { key: "autodromo", label: "Autódromo", shape: "custom:Autodromo", auto: true },
  { key: "planetario", label: "Planetario", shape: "lucide:Orbit", auto: true },
  { key: "universidad", label: "Universidad / Facultad", shape: "lucide:GraduationCap", auto: true },
  { key: "tribunal", label: "Tribunal / Tribunales", shape: "lucide:Scale", auto: true },
  { key: "aduana", label: "Aduana", shape: "lucide:Stamp", auto: true },
  { key: "hotel", label: "Hotel / Motel", shape: "lucide:BedDouble", auto: true },
  { key: "bomberos", label: "Bomberos", shape: "custom:Bomberos", auto: true },
  { key: "iglesia", label: "Iglesia / Mezquita / Capilla / Parroquia / Catedral / Basílica / Sinagoga / Templo", shape: "lucide:Church", auto: true },
  { key: "lago", label: "Lago / Laguna", shape: "custom:Lago", auto: true },
  { key: "balneario", label: "Balneario", shape: "custom:Balneario", auto: true },
  { key: "arroyo", label: "Arroyo", shape: "custom:Arroyo", auto: true },
  { key: "granja", label: "Granja", shape: "lucide:Tractor", auto: true },
  { key: "shopping", label: "Shopping", shape: "lucide:Store", auto: true },
  { key: "peatonal", label: "Peatonal", shape: "lucide:Footprints", auto: true },
  { key: "barrio", label: "Barrio", shape: "custom:Barrio", auto: true },
  { key: "biblioteca", label: "Biblioteca", shape: "lucide:Library", auto: true },
  { key: "museo", label: "Museo", shape: "lucide:Amphora", auto: true },
  { key: "palacio", label: "Palacio", shape: "custom:Palacio", auto: true },
  { key: "militar", label: "Militar", shape: "custom:Militar", auto: false },
  { key: "gasolinera", label: "Gasolinera", shape: "lucide:Fuel", auto: false },
  { key: "club", label: "Club (genérico)", shape: "lucide:Trophy", auto: false },
  { key: "club_futbol", label: "Club de fútbol", shape: "custom:ClubFutbol", auto: false },
  { key: "club_basquet", label: "Club de básquet", shape: "custom:ClubBasquet", auto: false },
  { key: "club_golf", label: "Club de golf", shape: "custom:ClubGolf", auto: false },
  { key: "club_padel", label: "Club de pádel", shape: "custom:ClubPadel", auto: false },
  { key: "club_natacion", label: "Club de natación", shape: "custom:ClubNatacion", auto: false },
  { key: "club_scout", label: "Club scout", shape: "custom:ClubScout", auto: false },
  { key: "polideportivo", label: "Polideportivo", shape: "custom:Polideportivo", auto: false },
  { key: "diversiones", label: "Parque de diversiones", shape: "custom:Diversiones", auto: false },
  { key: "autopista", label: "Autopista", shape: "custom:Autopista", auto: false },
  { key: "avenida", label: "Avenida", shape: "custom:Avenida", auto: false },
  { key: "monumento", label: "Monumento", shape: "custom:Monumento", auto: false },
  { key: "memoria", label: "Memoria (Madres / desaparecidos)", shape: "custom:Panuelo", auto: false },
  { key: "obelisco", label: "Obelisco", shape: "custom:Obelisco", auto: false },
  { key: "cabildo", label: "Cabildo", shape: "custom:Cabildo", auto: false },
  { key: "mate", label: "Mate", shape: "custom:Mate", auto: false },
]

const ICON_KEYS = new Set(MIND_MAP_ICONS.map((i) => i.key))

export function isMindMapIconKey(key: unknown): key is string {
  return typeof key === "string" && ICON_KEYS.has(key)
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

// Se prueba en orden y gana la primera que coincide: las más específicas
// van antes ("Barrio Privado" antes que "Barrio", "Parque Industrial" antes
// que "Parque"). Solo cuenta el COMIENZO del nombre, como palabra entera.
const RULES: Array<[string, RegExp]> = [
  ["fabrica", /^parque industrial\b/],
  ["estacion", /^(?:estacion)\b/],
  ["teatro", /^(?:teatro|auditorio)\b/],
  ["fabrica", /^(?:fabrica|empresa)\b/],
  ["barrio_privado", /^(?:barrio privado|country|estancia)\b/],
  ["estadio", /^(?:estadio)\b/],
  ["escuela", /^(?:escuela|colegio)\b/],
  ["terminal", /^(?:centro de trasbordo|terminal de omnibus)\b/],
  ["rotonda", /^(?:rotonda)\b/],
  ["plaza", /^(?:plaza|plazoleta|parque|jardin botanico|bosque|bosques)\b/],
  ["reserva", /^(?:reserva natural|reserva ecologica)\b/],
  ["puente", /^(?:puente)\b/],
  ["tunel", /^(?:tunel)\b/],
  ["arco", /^(?:arco)\b/],
  ["cementerio", /^(?:cementerio)\b/],
  ["cruce", /^(?:cruce)\b/],
  ["hospital", /^(?:hospital|hospitales|farmacia|clinica|sanatorio)\b/],
  ["puerto", /^(?:astillero|puerto)\b/],
  ["aeropuerto", /^(?:aeropuerto|aerodromo)\b/],
  ["municipalidad", /^(?:municipalidad)\b/],
  ["penal", /^(?:penal|unidad penitenciaria)\b/],
  ["comisaria", /^(?:comisaria)\b/],
  ["hipodromo", /^(?:hipodromo)\b/],
  ["autodromo", /^(?:autodromo)\b/],
  ["planetario", /^(?:planetario)\b/],
  ["universidad", /^(?:universidad|facultad)\b/],
  ["tribunal", /^(?:tribunal|tribunales)\b/],
  ["aduana", /^(?:aduana)\b/],
  ["hotel", /^(?:hotel|motel)\b/],
  ["bomberos", /^(?:bomberos)\b/],
  ["iglesia", /^(?:iglesia|mezquita|capilla|parroquia|catedral|basilica|sinagoga|templo)\b/],
  ["lago", /^(?:lago|laguna)\b/],
  ["balneario", /^(?:balneario)\b/],
  ["arroyo", /^(?:arroyo)\b/],
  ["granja", /^(?:granja)\b/],
  ["shopping", /^(?:shopping)\b/],
  ["peatonal", /^(?:peatonal)\b/],
  ["barrio", /^(?:barrio)\b/],
  ["biblioteca", /^(?:biblioteca)\b/],
  ["museo", /^(?:museo)\b/],
  ["palacio", /^(?:palacio)\b/],
]

export function detectMindMapIcon(name: string): string | null {
  const n = normalizeName(name || "")
  if (!n) return null
  for (const [key, re] of RULES) if (re.test(n)) return key
  return null
}

// Símbolo final de una parada: el elegido a mano en Ruteo (si es válido) o,
// si no hay, el que sale del nombre.
export function resolveMindMapIcon(manual: unknown, name: string): string | null {
  if (isMindMapIconKey(manual)) return manual
  return detectMindMapIcon(name)
}
