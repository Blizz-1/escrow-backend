import { divRound } from "../src/utils/rounding";
import { divideHalfEven } from "../src/utils/financial_report_math";
import { divideRoundHalfEven } from "../src/utils/conversion_rate_scraper";
import { roundIntegerDivision } from "../src/utils/tax_deduction_estimator";

describe("unified rounding (issue #670)", () => {
  const cases: Array<{
    n: bigint;
    d: bigint;
    mode: Parameters<typeof divRound>[2];
    want: bigint;
    label: string;
  }> = [
    { n: 5n, d: 2n, mode: "half-even", want: 2n, label: "half ties to even (5/2)" },
    { n: 7n, d: 2n, mode: "half-even", want: 4n, label: "half ties to even (7/2)" },
    { n: 3n, d: 2n, mode: "half-even", want: 2n, label: "half ties to even (3/2)" },
    { n: -5n, d: 2n, mode: "half-even", want: -2n, label: "negative half-even" },
    { n: 5n, d: 2n, mode: "half-up", want: 3n, label: "half-up rounds away" },
    { n: 7n, d: 3n, mode: "truncate", want: 2n, label: "truncate" },
    { n: -7n, d: 3n, mode: "floor", want: -3n, label: "floor negative" },
    { n: 7n, d: 3n, mode: "ceil", want: 3n, label: "ceil positive" },
    { n: 100n, d: 3n, mode: "half-even", want: 33n, label: "100/3 half-even" },
    { n: 200n, d: 3n, mode: "half-even", want: 67n, label: "200/3 half-even" },
  ];

  it.each(cases)("$label: divRound($n, $d, $mode) = $want", ({ n, d, mode, want }) => {
    expect(divRound(n, d, mode)).toBe(want);
  });

  it("throws on zero divisor", () => {
    expect(() => divRound(1n, 0n, "half-even")).toThrow(RangeError);
  });

  it("wrappers agree with the canonical implementation", () => {
    expect(divideHalfEven(5n, 2n)).toBe(divRound(5n, 2n, "half-even"));
    expect(divideRoundHalfEven(7n, 2n)).toBe(divRound(7n, 2n, "half-even"));
    expect(roundIntegerDivision(-5n, 2n, "half-even")).toBe(
      divRound(-5n, 2n, "half-even"),
    );
  });
});
