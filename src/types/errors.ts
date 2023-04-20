export class AppError extends Error {
    constructor(message: string) {
    super(message);
    this.name = Object.getPrototypeOf(this).constructor.name;
    Error.captureStackTrace(this, this.constructor);
    }
}

export class ConfigError extends Error {}
