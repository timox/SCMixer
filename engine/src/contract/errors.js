export const codes = Object.freeze({
  VALIDATION: 400,
  NOT_FOUND: 404,
  CHANNEL_OVERLAP: 409,
  CHANNEL_LIMIT: 400,
  ENGINE_NOT_RUNNING: 409,
  ENGINE_BUSY: 409,
  MODEL_UNAVAILABLE: 409,
  TIMOXVASIO_NOT_READY: 409,
  SC_COMMAND_FAILED: 502,
});

export class ApiError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}
