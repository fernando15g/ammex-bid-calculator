/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Industrial / rebar-yard palette
        gunmetal: "#1C2024", // primary dark ink
        steel: "#2C333B", // panel headers
        slate2: "#3D4651", // secondary text on dark
        concrete: "#E6E3DD", // app background
        paper: "#F6F4EF", // card paper
        rebar: "#C2410C", // hero accent (safety amber-orange)
        rebarLite: "#EA7338",
        good: "#15803D",
        warn: "#B45309",
        bad: "#B91C1C",
        line: "#D8D4CB",
      },
      fontFamily: {
        display: ["var(--font-oswald)", "system-ui", "sans-serif"],
        sans: ["var(--font-plex)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        eyebrow: "0.18em",
      },
    },
  },
  plugins: [],
};
