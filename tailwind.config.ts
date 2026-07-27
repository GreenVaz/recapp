import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f7f5",
        surface: "#ffffff",
        line: "#e8e8e4",
        ink: {
          DEFAULT: "#1c1c1a",
          soft: "#5c5c58",
          faint: "#94948e",
        },
        accent: {
          DEFAULT: "#3f6f5c",
          soft: "#eef3f0",
        },
        positive: "#2f7d5f",
        negative: "#c2554a",
        warning: "#c08a2e",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,28,26,0.04), 0 1px 12px rgba(28,28,26,0.03)",
        pop: "0 8px 32px rgba(28,28,26,0.10)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.24s ease-out",
        "scale-in": "scale-in 0.16s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
