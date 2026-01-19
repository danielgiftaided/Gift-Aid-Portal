import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#304674", // deep blue
          accent: "#0C735C",  // teal/green
          surface: "#FCF8EF", // cream background
          ink: "#0F172A",     // readable text (optional)
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
