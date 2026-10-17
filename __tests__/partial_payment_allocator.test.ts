import {
  MAX_SAFE_DIGITS,
  MAX_INTERMEDIATE_DIGITS,
  ERROR_CODES,
  validatePaymentAmount,
  allocatePartialPayment,
} from "../src/utils/partial_payment_allocator.js";

// Smallest amount outside the contract's i128 range (i128 max + 1).
const OVER_I128 = (2n ** 127n).toString();

describe("partial_payment_allocator overflow validation", () => {
  describe("validatePaymentAmount", () => {
    it("accepts values within the digit limit", () => {
      const result = validatePaymentAmount("123456789012345");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(123456789012345n);
      }
    });

    it("accepts bigint and number inputs within limits", () => {
      expect(validatePaymentAmount(999n).ok).toBe(true);
      expect(validatePaymentAmount(1000).ok).toBe(true);
    });

    it("rejects excessive digits with ALLOCATOR_EXCESSIVE_DIGITS", () => {
      const tooBig = OVER_I128;
      const result = validatePaymentAmount(tooBig);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.AMOUNT_OUT_OF_RANGE);
        expect(result.error).toMatch(/i128 amount range/i);
      }
    });

    it("rejects non-integer strings with ALLOCATOR_INVALID_AMOUNT", () => {
      const result = validatePaymentAmount("12.5");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.INVALID_AMOUNT);
      }
    });

    it("rejects non-finite numbers", () => {
      const result = validatePaymentAmount(Number.POSITIVE_INFINITY);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.INVALID_AMOUNT);
      }
    });
  });

  describe("allocatePartialPayment", () => {
    it("splits a total amount across equal shares correctly", () => {
      const result = allocatePartialPayment(1000, [1, 1, 1]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.allocations).toHaveLength(3);
        const sum = result.allocations.reduce((a, b) => a + b, 0n);
        expect(sum + result.remainder).toBe(1000n);
      }
    });

    it("splits across unequal weighted shares correctly", () => {
      const result = allocatePartialPayment(1000, [70, 20, 10]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.allocations).toEqual([700n, 200n, 100n]);
        const sum = result.allocations.reduce((a, b) => a + b, 0n);
        expect(sum + result.remainder).toBe(1000n);
      }
    });

    it("rejects an invalid total amount, propagating INVALID_AMOUNT", () => {
      const result = allocatePartialPayment("12.5", [1, 1]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.INVALID_AMOUNT);
      }
    });

    it("rejects a total amount with excessive digits, propagating EXCESSIVE_DIGITS", () => {
      const tooBig = OVER_I128;
      const result = allocatePartialPayment(tooBig, [1, 1]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.AMOUNT_OUT_OF_RANGE);
      }
    });

    it("rejects an empty shares array with ALLOCATOR_INVALID_SHARES", () => {
      const result = allocatePartialPayment(1000, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.INVALID_SHARES);
      }
    });

    it("rejects a shares array containing zero or negative values", () => {
      const zeroResult = allocatePartialPayment(1000, [1, 0]);
      expect(zeroResult.ok).toBe(false);
      if (!zeroResult.ok) {
        expect(zeroResult.code).toBe(ERROR_CODES.INVALID_SHARES);
      }

      const negativeResult = allocatePartialPayment(1000, [1, -5]);
      expect(negativeResult.ok).toBe(false);
      if (!negativeResult.ok) {
        expect(negativeResult.code).toBe(ERROR_CODES.INVALID_SHARES);
      }
    });

    it("rejects a shares array containing non-finite values", () => {
      const result = allocatePartialPayment(1000, [1, Number.POSITIVE_INFINITY]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(ERROR_CODES.INVALID_SHARES);
      }
    });

    it("allocates a total far beyond the old 15-digit cap exactly (#698)", () => {
      // The intermediate product (total * scaledNumerator) is bigint, so it
      // cannot overflow; each allocation is at most the total.
      const hugeTotal = (2n ** 127n - 1n).toString();
      const result = allocatePartialPayment(hugeTotal, [5_000_000_000, 1]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const sum = result.allocations.reduce((a: bigint, b: bigint) => a + b, 0n);
        expect(sum + result.remainder).toBe(BigInt(hugeTotal));
      }
    });

    it("never lets allocations + remainder drift from the original total", () => {
      const result = allocatePartialPayment(123457, [3, 3, 3, 1]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const sum = result.allocations.reduce((a, b) => a + b, 0n);
        expect(sum + result.remainder).toBe(123457n);
      }
    });

    it("exposes MAX_INTERMEDIATE_DIGITS as a wider bound than MAX_SAFE_DIGITS", () => {
      expect(MAX_INTERMEDIATE_DIGITS).toBeGreaterThan(MAX_SAFE_DIGITS);
    });
  });
});
