/** Thrown by pure finance functions for invalid inputs; the API layer maps it to HTTP 400. */
export class FinanceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceInputError";
  }
}
