import dotenv from "dotenv";

// Vitest não carrega .env.local sozinho como o Next.js faz — sem isso, os
// testes que precisam do projeto Supabase real rodariam sem as chaves.
dotenv.config({ path: ".env.local" });
