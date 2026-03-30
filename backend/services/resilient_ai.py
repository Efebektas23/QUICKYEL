"""
Resilient AI Service Wrapper — Retry, Fallback, Circuit Breaker

Provides a centralized wrapper around Gemini API calls with:
- Exponential backoff retry (503, 429, 500) + jitter (reduces thundering herd)
- Model fallback chain (primary → fallback)
- Circuit breaker with sliding failure window + half-open probe (thread-safe)
- Per-call generate timeout + wall-clock budget for the whole operation
- Optional client retry hint (X-Client-Retry-Attempt) to cap backend attempts

Circuit breaker:
- Trips when >= CIRCUIT_BREAKER_THRESHOLD failures fall within CIRCUIT_BREAKER_WINDOW_SEC.
- Recovery: OPEN → CIRCUIT_BREAKER_RECOVERY → HALF_OPEN (one probe at a time).
- Success in CLOSED clears the failure window; success in HALF_OPEN closes the circuit.

Multi-instance: breaker, timeouts, and in-process caches are per process. For horizontal
scale with shared state, use Redis (or similar) for breaker + idempotency — not bundled here.

Observability: trace_id, model, attempts, total_attempts, circuit state, backoff seconds.
"""

import time
import logging
import uuid
import random
import threading
import contextvars
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, Any, List, Tuple
from enum import Enum

import google.generativeai as genai

logger = logging.getLogger(__name__)


# ============ CLIENT RETRY SCOPE (middleware sets this from X-Client-Retry-Attempt) ============

_client_retry_attempt: contextvars.ContextVar[int] = contextvars.ContextVar(
    "client_retry_attempt", default=0
)


def bind_client_retry_attempt(n: int) -> contextvars.Token:
    """Start of request: bind client retry count (0 = first try). Returns token for reset."""
    clamped = max(0, min(n, 8))
    return _client_retry_attempt.set(clamped)


def reset_client_retry_attempt(token: contextvars.Token) -> None:
    _client_retry_attempt.reset(token)


# ============ CONFIGURATION ============

class ModelTier(Enum):
    PRIMARY = "primary"
    FALLBACK = "fallback"


MODEL_CHAIN = [
    {"name": "gemini-2.0-flash", "tier": ModelTier.PRIMARY},
    {"name": "gemini-1.5-flash", "tier": ModelTier.FALLBACK},
]

MAX_RETRIES = 4
RETRY_DELAYS = [0, 2, 5, 10]
RETRY_JITTER_FRACTION = 0.35

# Circuit breaker — sliding window
CIRCUIT_BREAKER_THRESHOLD = 5
CIRCUIT_BREAKER_WINDOW_SEC = 60.0
CIRCUIT_BREAKER_RECOVERY = 60
CIRCUIT_BREAKER_HALF_OPEN_MAX = 1

# Single Gemini RPC must finish within this (seconds); avoids hung workers.
AI_GENERATE_TIMEOUT_SEC = 55.0
# Whole resilient_generate (all models × retries × backoff) must stay under this wall clock.
AI_OPERATION_DEADLINE_SEC = 118.0

RETRYABLE_STATUS_CODES = {429, 500, 502, 503}
RETRYABLE_ERROR_KEYWORDS = [
    "SERVICE_UNAVAILABLE",
    "UNAVAILABLE",
    "RESOURCE_EXHAUSTED",
    "MODEL_CAPACITY_EXHAUSTED",
    "INTERNAL",
    "DEADLINE_EXCEEDED",
    "rate limit",
    "quota",
    "capacity",
    "overloaded",
    "temporarily unavailable",
]


# ============ CIRCUIT BREAKER ============

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """
    Sliding-window failure counting + half-open probe. Thread-safe.
    """

    def __init__(
        self,
        name: str = "gemini",
        failure_threshold: int = CIRCUIT_BREAKER_THRESHOLD,
        failure_window_sec: float = CIRCUIT_BREAKER_WINDOW_SEC,
        recovery_timeout: int = CIRCUIT_BREAKER_RECOVERY,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.failure_window_sec = failure_window_sec
        self.recovery_timeout = recovery_timeout
        self._lock = threading.Lock()
        self.failure_times: deque = deque()
        self.state = CircuitState.CLOSED
        self.last_failure_time = 0.0
        self.half_open_requests = 0

    def _prune_failures(self, now: float) -> None:
        cutoff = now - self.failure_window_sec
        while self.failure_times and self.failure_times[0] < cutoff:
            self.failure_times.popleft()

    def enter_request(self) -> bool:
        with self._lock:
            if self.state == CircuitState.OPEN:
                elapsed = time.time() - self.last_failure_time
                if elapsed >= self.recovery_timeout:
                    self.state = CircuitState.HALF_OPEN
                    self.half_open_requests = 0
                    logger.info(
                        f"[CircuitBreaker:{self.name}] OPEN → HALF_OPEN after {elapsed:.0f}s"
                    )
                else:
                    return False

            if self.state == CircuitState.CLOSED:
                return True

            if self.state == CircuitState.HALF_OPEN:
                if self.half_open_requests >= CIRCUIT_BREAKER_HALF_OPEN_MAX:
                    return False
                self.half_open_requests += 1
                return True

            return False

    def record_success(self):
        with self._lock:
            if self.state == CircuitState.HALF_OPEN:
                logger.info(f"[CircuitBreaker:{self.name}] HALF_OPEN probe ok → CLOSED")
                self.state = CircuitState.CLOSED
                self.failure_times.clear()
                self.half_open_requests = 0
            elif self.state == CircuitState.CLOSED:
                self.failure_times.clear()

    def record_failure(self):
        with self._lock:
            now = time.time()
            self.last_failure_time = now

            if self.state == CircuitState.HALF_OPEN:
                logger.warning(
                    f"[CircuitBreaker:{self.name}] HALF_OPEN probe failed → OPEN "
                    f"({self.recovery_timeout}s)"
                )
                self.state = CircuitState.OPEN
                self.half_open_requests = 0
                return

            self.failure_times.append(now)
            self._prune_failures(now)
            if len(self.failure_times) >= self.failure_threshold:
                logger.error(
                    f"[CircuitBreaker:{self.name}] {len(self.failure_times)} failures in "
                    f"{self.failure_window_sec:.0f}s → OPEN ({self.recovery_timeout}s)"
                )
                self.state = CircuitState.OPEN

    @property
    def status(self) -> dict:
        with self._lock:
            now = time.time()
            self._prune_failures(now)
            return {
                "name": self.name,
                "state": self.state.value,
                "failures_in_window": len(self.failure_times),
                "window_sec": self.failure_window_sec,
                "threshold": self.failure_threshold,
                "recovery_seconds": self.recovery_timeout,
                "half_open_max": CIRCUIT_BREAKER_HALF_OPEN_MAX,
                "half_open_active": self.half_open_requests,
            }


_circuit_breaker = CircuitBreaker()


def _effective_max_retries(per_model_cap: int) -> int:
    """Fewer backend attempts when the client is already on a retry hop."""
    client = _client_retry_attempt.get()
    return max(1, min(per_model_cap, MAX_RETRIES - client))


def _execute_generate(model: Any, prompt: Any, timeout_sec: float) -> Any:
    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(model.generate_content, prompt)
        return fut.result(timeout=timeout_sec)


# ============ RETRY LOGIC ============

def is_retryable_ai_error(error: Exception) -> bool:
    return _is_retryable_error(error)


def map_gemini_exception_to_http(exc: Exception) -> Tuple[int, str]:
    msg = str(exc)
    lower = msg.lower()
    code = getattr(exc, "code", None)

    if isinstance(exc, TimeoutError):
        return (
            504,
            "AI request timed out or exceeded its time budget. Try a smaller file or retry later.",
        )

    if code == 400 or "invalid argument" in lower or "bad request" in lower:
        return (400, "Invalid request to AI (prompt or payload). Check input and try again.")
    if code == 401 or "api key invalid" in lower or "invalid api key" in lower:
        return (401, "Gemini API key is missing or invalid.")
    if code == 403 or "permission denied" in lower or "forbidden" in lower:
        return (403, "Gemini API access denied for this project or key.")
    if code == 404 or ("not found" in lower and "model" in lower):
        return (502, "Configured AI model is not available. Try again later.")
    if code == 504 or "deadline" in lower or "timeout" in lower or "timed out" in lower:
        return (
            504,
            "AI request timed out. Try again with a smaller file or when load is lower.",
        )
    if _is_retryable_error(exc):
        return (
            503,
            "AI service is temporarily overloaded. Please wait a moment and try again.",
        )
    return (500, "An unexpected error occurred while calling the AI service.")


def _is_retryable_error(error: Exception) -> bool:
    if isinstance(error, TimeoutError):
        return True
    error_str = str(error).lower()
    for keyword in RETRYABLE_ERROR_KEYWORDS:
        if keyword.lower() in error_str:
            return True
    for code in RETRYABLE_STATUS_CODES:
        if str(code) in error_str:
            return True
    if hasattr(error, "code"):
        c = getattr(error, "code", None)
        if c in RETRYABLE_STATUS_CODES:
            return True
    return False


def _generate_trace_id() -> str:
    return uuid.uuid4().hex[:12]


def _sleep_backoff_with_jitter(attempt_index: int) -> float:
    base = RETRY_DELAYS[min(attempt_index, len(RETRY_DELAYS) - 1)]
    if base <= 0:
        return 0.0
    jitter = base * RETRY_JITTER_FRACTION * random.random()
    total = base + jitter
    time.sleep(total)
    return total


def resilient_generate(
    model: Any,
    prompt: Any,
    operation_name: str = "ai_request",
    fallback_models: Optional[List[Any]] = None,
    max_retries: int = MAX_RETRIES,
) -> Any:
    trace_id = _generate_trace_id()
    per_model_attempts = _effective_max_retries(max_retries)

    all_models = [("primary", model)]
    if fallback_models:
        for i, fb in enumerate(fallback_models):
            all_models.append((f"fallback_{i+1}", fb))

    last_error = None
    total_attempts = 0
    deadline = time.monotonic() + AI_OPERATION_DEADLINE_SEC

    if not _circuit_breaker.enter_request():
        st = _circuit_breaker.status
        logger.warning(
            f"[{trace_id}] [{operation_name}] circuit blocked state={st}"
        )
        err = RuntimeError(
            "AI circuit breaker is open — too many recent failures. Retry later."
        )
        setattr(err, "ai_suggested_http_status", 503)
        raise err

    for model_label, current_model in all_models:
        if current_model is None:
            continue

        for attempt in range(per_model_attempts):
            if time.monotonic() > deadline:
                err = TimeoutError(
                    f"AI operation budget {AI_OPERATION_DEADLINE_SEC}s exceeded "
                    f"({operation_name})"
                )
                logger.error(f"[{trace_id}] [{operation_name}] deadline exceeded")
                raise err

            total_attempts += 1
            try:
                if attempt > 0:
                    slept = _sleep_backoff_with_jitter(attempt)
                    if time.monotonic() > deadline:
                        raise TimeoutError("AI operation deadline exceeded during backoff")
                    logger.info(
                        f"[{trace_id}] [{operation_name}] backoff model={model_label} "
                        f"attempt={attempt + 1}/{per_model_attempts} slept_s={slept:.2f}"
                    )
                else:
                    logger.info(
                        f"[{trace_id}] [{operation_name}] attempt model={model_label} "
                        f"idx={attempt + 1}/{per_model_attempts} "
                        f"client_retry={_client_retry_attempt.get()}"
                    )

                response = _execute_generate(
                    current_model, prompt, AI_GENERATE_TIMEOUT_SEC
                )

                _circuit_breaker.record_success()

                logger.info(
                    f"[{trace_id}] [{operation_name}] ok model={model_label} "
                    f"attempt={attempt + 1} total_attempts={total_attempts} "
                    f"circuit={_circuit_breaker.status['state']}"
                )

                return response

            except Exception as e:
                last_error = e
                is_last_attempt = attempt >= per_model_attempts - 1
                if not _is_retryable_error(e) or is_last_attempt:
                    _circuit_breaker.record_failure()

                if _is_retryable_error(e):
                    logger.warning(
                        f"[{trace_id}] [{operation_name}] retryable model={model_label} "
                        f"attempt={attempt + 1}/{per_model_attempts} "
                        f"{type(e).__name__}: {str(e)[:200]}"
                    )
                    continue
                logger.error(
                    f"[{trace_id}] [{operation_name}] non_retryable model={model_label} "
                    f"{type(e).__name__}: {str(e)[:200]}"
                )
                break

        if last_error:
            logger.warning(
                f"[{trace_id}] [{operation_name}] exhausted model={model_label} → next"
            )

    logger.error(
        f"[{trace_id}] [{operation_name}] FAIL total_attempts={total_attempts} "
        f"last={type(last_error).__name__}: {str(last_error)[:300]}"
    )
    raise last_error or RuntimeError("All AI models and retries exhausted")


class ResilientModelFactory:
    def __init__(self, api_key: str, primary_config: Optional[dict] = None):
        self.api_key = api_key
        self.primary_model = None
        self.fallback_model = None
        self._initialized = False
        self.primary_config = primary_config or {
            "temperature": 0.1,
            "top_p": 0.95,
            "max_output_tokens": 8192,
        }
        self._initialize()

    def _initialize(self):
        try:
            genai.configure(api_key=self.api_key)
            self.primary_model = genai.GenerativeModel(
                model_name="gemini-2.0-flash",
                generation_config=self.primary_config,
            )
            self.fallback_model = genai.GenerativeModel(
                model_name="gemini-1.5-flash",
                generation_config=self.primary_config,
            )
            self._initialized = True
            logger.info(
                "ResilientModelFactory initialized — "
                "primary: gemini-2.0-flash, fallback: gemini-1.5-flash"
            )
        except Exception as e:
            logger.error(f"Failed to initialize AI models: {e}")

    @property
    def is_available(self) -> bool:
        return self._initialized and self.primary_model is not None

    def generate(self, prompt: Any, operation_name: str = "ai_request") -> Any:
        if not self.is_available:
            raise RuntimeError("AI models not initialized")
        fallbacks = [self.fallback_model] if self.fallback_model else []
        return resilient_generate(
            model=self.primary_model,
            prompt=prompt,
            operation_name=operation_name,
            fallback_models=fallbacks,
        )

    @property
    def circuit_status(self) -> dict:
        return _circuit_breaker.status


def get_ai_health() -> dict:
    return {
        "circuit_breaker": _circuit_breaker.status,
        "models": {
            "primary": "gemini-2.0-flash",
            "fallback": "gemini-1.5-flash",
        },
        "config": {
            "max_retries_per_model": MAX_RETRIES,
            "retry_delays_sec": RETRY_DELAYS,
            "retry_jitter_fraction": RETRY_JITTER_FRACTION,
            "circuit_threshold": CIRCUIT_BREAKER_THRESHOLD,
            "circuit_window_sec": CIRCUIT_BREAKER_WINDOW_SEC,
            "circuit_recovery_seconds": CIRCUIT_BREAKER_RECOVERY,
            "circuit_half_open_max": CIRCUIT_BREAKER_HALF_OPEN_MAX,
            "ai_generate_timeout_sec": AI_GENERATE_TIMEOUT_SEC,
            "ai_operation_deadline_sec": AI_OPERATION_DEADLINE_SEC,
            "note_multi_instance": (
                "Breaker and caches are in-process; use Redis for shared state when scaling out."
            ),
        },
    }
