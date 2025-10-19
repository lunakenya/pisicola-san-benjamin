import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CRÍTICO: Indica a Next.js que genere el output en modo autónomo (standalone).
  // Esto es necesario para la optimización y despliegue dentro de un contenedor Docker.
  output: 'standalone', 
};

export default nextConfig;