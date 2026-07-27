declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.css";

/** Metro-bundled TFLite assets (react-native-fast-tflite require()). */
declare module "*.tflite" {
  const asset: number;
  export default asset;
}