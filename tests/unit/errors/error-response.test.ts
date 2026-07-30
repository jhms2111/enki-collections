import { describe, expect, it, vi } from "vitest";

import { toErrorResponse } from "@/shared/errors/error-response";

describe("toErrorResponse", () => {
  it("does not expose technical failure details", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = toErrorResponse(
      new Error(
        "postgresql://private-user:private-password@private-host/database",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(payload)).not.toContain("private-password");
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: "Error" }),
    );
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
      "private-password",
    );
    consoleSpy.mockRestore();
  });
});
