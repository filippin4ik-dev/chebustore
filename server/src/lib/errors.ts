export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, code, message);
export const unauthorized = (message = "Требуется вход", code = "unauthorized") =>
  new HttpError(401, code, message);
export const forbidden = (message = "Недостаточно прав", code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message = "Не найдено", code = "not_found") => new HttpError(404, code, message);
export const conflict = (message: string, code = "conflict") => new HttpError(409, code, message);
export const tooMany = (message = "Слишком много попыток, попробуйте позже", code = "rate_limited") =>
  new HttpError(429, code, message);
