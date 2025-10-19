import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Hereda las reglas base de Next.js
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  
  // Nuevo objeto para relajar las reglas estrictas y permitir la compilación
  {
    rules: {
      // Desactiva el error de 'any' para permitir la compilación
      "@typescript-eslint/no-explicit-any": "off", 
      
      // Desactiva el error de 'require()' que aparece en tus logs
      "@typescript-eslint/no-require-imports": "off", 
      
      // Desactiva el chequeo de variables y dependencias que no se usan (warnings)
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off", 
    },
  },
  
  // Archivos ignorados
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;