import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone: um server.js + só os node_modules necessários.
  // É o que o Dockerfile copia pra imagem final (VPS/EasyPanel). Não muda
  // nada no `npm run dev` nem num deploy na Vercel.
  output: "standalone",
};

export default nextConfig;
