import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17211b",
        canvas: "#f5f7f2",
        panel: "#ffffff",
        line: "#dfe5dd",
        brand: {
          50: "#eef8f1",
          100: "#d8efdf",
          500: "#2b7a4b",
          600: "#21643c",
          700: "#194f30"
        },
        accent: "#e97b4a"
      },
      boxShadow: {
        card: "0 16px 45px rgba(31, 49, 39, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
