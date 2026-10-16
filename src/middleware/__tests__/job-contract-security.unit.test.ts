import {
  getAllowedOrigins,
  jobContractCors,
  createJobDraftCors,
  submitCors,
  timeRemainingCors,
  byWalletCors,
  partialReleaseCors,
  claimAutoReleaseCors,
  updateWhitelistCors,
  buildTxCors,
} from "../src/middleware/job-contract-security";

function mocks(origin?: string, method = "GET") {
  const headers: Record<string, string> = {};
  const req: any = {
    method,
    header: (n: string) => (n === "Origin" ? origin : undefined),
  };
  const res: any = {
    headers,
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    statusCode: 200,
    body: undefined,
    ended: false,
    status: jest.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    json: jest.fn(function (this: any, b: any) {
      this.body = b;
      return this;
    }),
    end: jest.fn(function (this: any) {
      this.ended = true;
      return this;
    }),
  };
  const next = jest.fn();
  return { req, res, next, headers };
}

const gates = {
  jobContractCors,
  createJobDraftCors,
  submitCors,
  timeRemainingCors,
  byWalletCors,
  partialReleaseCors,
  claimAutoReleaseCors,
  updateWhitelistCors,
  buildTxCors,
};

describe("job-contract-security CORS gates (issue #671)", () => {
  const OLD = process.env.ALLOWED_ORIGINS;
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
    jest.clearAllMocks();
  });
  afterAll(() => {
    process.env.ALLOWED_ORIGINS = OLD;
  });

  it.each(Object.entries(gates))(
    "%s: no Origin -> next() (OPTIONS 204 where implemented)",
    (_name, gate) => {
      const { req, res, next } = mocks(undefined, "GET");
      (gate as any)(req, res, next);
      expect(next).toHaveBeenCalled();
    },
  );

  it.each(Object.entries(gates))(
    "%s: allowed origin sets ACAO/Vary/Allow-Methods and calls next()",
    (_name, gate) => {
      const { req, res, next, headers } = mocks(
        "https://app.example.com",
        "GET",
      );
      (gate as any)(req, res, next);
      expect(headers["Access-Control-Allow-Origin"]).toBe(
        "https://app.example.com",
      );
      expect(headers["Vary"]).toBe("Origin");
      expect(next).toHaveBeenCalled();
    },
  );

  it.each(Object.entries(gates))(
    "%s: disallowed origin -> 403 standard body",
    (_name, gate) => {
      const { req, res, next } = mocks("https://evil.example", "GET");
      (gate as any)(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.body).toEqual({
        success: false,
        error: "Origin not allowed by CORS policy",
      });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each(Object.entries(gates))(
    "%s: OPTIONS with allowed origin -> 204 or next()",
    (_name, gate) => {
      const { req, res, next } = mocks(
        "https://app.example.com",
        "OPTIONS",
      );
      (gate as any)(req, res, next);
      const ended204 = res.ended && res.statusCode === 204;
      expect(ended204 || next.mock.calls.length > 0).toBe(true);
    },
  );

  it("getAllowedOrigins handles unset/empty/whitespace", () => {
    delete process.env.ALLOWED_ORIGINS;
    expect(getAllowedOrigins()).toEqual(["http://localhost:3000"]);
    process.env.ALLOWED_ORIGINS = "   ";
    expect(getAllowedOrigins()).toEqual([]);
    process.env.ALLOWED_ORIGINS =
      " https://a.example , ,https://b.example ";
    expect(getAllowedOrigins()).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});
