import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: __dirname,
  },
  // Cada guardado de una línea/parada escribe en local-data/ (y crea archivos
  // temporales .tmp). Sin esto, el servidor de desarrollo (webpack) ve esos
  // archivos como "código que cambió" y recarga toda la página del editor,
  // perdiendo lo que se estaba haciendo en pantalla.
  webpack: (config, { dev }) => {
    if (dev) {
      // Una sola expresión regular (Next ya usa una para `ignored`; webpack no
      // acepta mezclar regex dentro de un arreglo).
      config.watchOptions = {
        ...config.watchOptions,
        ignored: /(^|[\\/])(local-data|\.git|\.next|node_modules)([\\/]|$)/,
      }
    }
    return config
  },
}

export default nextConfig
