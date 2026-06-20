export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}

export class EntityNotFoundError extends DomainError {}
export class EntityConflictError extends DomainError {}
export class InsufficientStockError extends DomainError {}
export class ForbiddenOperationError extends DomainError {}
export class InvalidOperationError extends DomainError {}
