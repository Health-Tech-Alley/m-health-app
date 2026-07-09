/**
 * Ambient module declarations for CSS imports.
 *
 * Metro / the Expo web bundler resolve `.css` and `.css` modules at build time, but TypeScript
 * doesn't know how to type them. These declarations let `tsc` understand:
 *   - side-effect imports: `import '@/global.css'`
 *   - CSS-module imports:  `import classes from './foo.module.css'`
 *
 * This is type-only plumbing — it does not affect runtime behavior.
 */

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css';
