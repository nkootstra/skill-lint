import { describe, expect, it, vi, beforeEach } from "vitest";
import { retryWithBackoff } from "../utils/retry.js";

// Suppress @actions/core logging during tests
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// Speed up tests by eliminating real delays
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("retryWithBackoff", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 3 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 errors and succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("429 status code (no body)"))
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on rate limit messages", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("rate limit exceeded"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500/502/503 server errors", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on error objects with status property", async () => {
    const error = Object.assign(new Error("Request failed"), { status: 429 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid API key"));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, initialDelayMs: 10 }),
    ).rejects.toThrow("Invalid API key");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429 status code (no body)"));

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, initialDelayMs: 10 }),
    ).rejects.toThrow("429 status code (no body)");

    // 1 initial + 2 retries = 3 attempts
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("caps delay at maxDelayMs", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10_000,
      maxDelayMs: 100,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("retries on overloaded errors", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("overloaded_error: the server is overloaded"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
