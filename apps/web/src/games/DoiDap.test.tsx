import type { ContentIndex } from "@parlo/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "../account.ts";
import { usePrefs } from "../prefs.ts";
import { DoiDap } from "./DoiDap.tsx";

/** Đối đáp en étape de leçon : invité ou hors ligne → « Continuer sans jouer » (compatible avec les parcours e2e). */
describe("Đối đáp indisponible", () => {
  afterEach(() => {
    cleanup();
    useAccount.setState({ status: "loading", account: null });
  });

  it("invité : explique et propose de continuer sans jouer", () => {
    usePrefs.setState({ locale: "fr" });
    useAccount.setState({ status: "guest", account: null });
    const onSkip = vi.fn();
    render(<DoiDap content={{} as ContentIndex} onSkip={onSkip} resultActions={() => null} />);
    expect(screen.getByText("Pour discuter avec Cô Mai, il faut un compte.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Jouer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continuer sans jouer" }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("hors ligne avec un compte : même sortie", () => {
    usePrefs.setState({ locale: "fr" });
    useAccount.setState({ status: "signed_in", account: { email: "a@b.c", displayName: "A", locale: "fr", linkedAt: "2026-09-01T00:00:00Z" } });
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<DoiDap content={{} as ContentIndex} onSkip={() => undefined} resultActions={() => null} />);
    expect(screen.getByTestId("doi-dap").getAttribute("data-phase")).toBe("unavailable");
    expect(screen.getByRole("button", { name: "Continuer sans jouer" })).toBeTruthy();
    online.mockRestore();
  });
});
