import cosyte from "@cosyte/eslint-config";

// The examples are programs that print, not library code with a public API, so every type-safety
// rule applies to them and the two library-only rules do not: they may call `console`, and they
// export nothing that would need JSDoc.
export default [
  ...cosyte(import.meta.dirname, { files: ["*.ts"] }),
  {
    files: ["*.ts"],
    rules: {
      "no-console": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-example": "off",
    },
  },
];
