export class MissingNativeModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingNativeModuleError';
  }
}
