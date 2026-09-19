/** Error carrying an HTTP status; the API layer serialises it as `{ error: message }`. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string) => new AppError(400, msg);
export const unauthorized = (msg = "Authentication required") => new AppError(401, msg);
export const forbidden = (msg = "Forbidden") => new AppError(403, msg);
export const notFound = (msg = "Not found") => new AppError(404, msg);
export const conflict = (msg: string) => new AppError(409, msg);
export const tooManyRequests = (msg = "Too many requests, please slow down") => new AppError(429, msg);
