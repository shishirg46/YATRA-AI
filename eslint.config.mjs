import nextCoreWebVitals from "@next/eslint-plugin-next";

export default [
  nextCoreWebVitals.configs["core-web-vitals"],
  {
    ignores: [".next/**", "**/generated/**"],
  },
];
