"""errors persistence; shared transactions stay with their owning domain."""
from __future__ import annotations




class TaskEventConflictError(Exception):
    pass


class TaskEventBatchValidationError(ValueError):
    pass


class RepositoryConflictError(ValueError):
    pass


class RepositoryNotFoundError(LookupError):
    pass


class RepositoryValidationError(ValueError):
    pass
