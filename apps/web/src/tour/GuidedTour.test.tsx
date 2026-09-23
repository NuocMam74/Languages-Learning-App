import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuidedTour, type TourStep } from "./GuidedTour.tsx";

/**
 * Visite en bulles (contrat phase26 §8) : chaque bulle se pose sur l'élément qu'elle explique, ou
 * au centre quand il manque ; on avance, on recule, on passe — et Échap ferme.
 */

const steps: TourStep[] = [
  { key: "path", target: '[data-tour="path"]', title: "Le parcours", body: "Ici, les niveaux." },
  { key: "missing", target: '[data-tour="absent"]', title: "Rien à montrer", body: "Au centre." },
  { key: "end", target: null, title: "Fin", body: "Bonne route." },
];

afterEach(cleanup);

function setup() {
  const target = document.createElement("div");
  target.dataset.tour = "path";
  target.getBoundingClientRect = () => ({ top: 100, left: 20, width: 200, height: 50, right: 220, bottom: 150, x: 20, y: 100, toJSON: () => ({}) });
  target.scrollIntoView = vi.fn();
  document.body.append(target);
  const onClose = vi.fn();
  render(<GuidedTour steps={steps} onClose={onClose} />);
  return { onClose, target };
}

describe("visite en bulles", () => {
  it("pose la bulle sur l'élément, avec un projecteur autour", () => {
    const { target } = setup();
    expect(screen.getByTestId("discovery-step").dataset.step).toBe("path");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("tour-spotlight")).toBeTruthy();
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });

  it("sans élément à montrer, pas de projecteur : la bulle se pose au centre", () => {
    const { target } = setup();
    fireEvent.click(screen.getByTestId("discovery-next"));
    expect(screen.getByTestId("discovery-step").dataset.step).toBe("missing");
    expect(screen.queryByTestId("tour-spotlight")).toBeNull();
    fireEvent.click(screen.getByTestId("discovery-back"));
    expect(screen.getByTestId("discovery-step").dataset.step).toBe("path");
    target.remove();
  });

  it("la dernière bulle ferme la visite ; « Passer » et Échap aussi", () => {
    const { onClose, target } = setup();
    fireEvent.click(screen.getByTestId("discovery-next"));
    fireEvent.click(screen.getByTestId("discovery-next"));
    expect(screen.getByTestId("discovery-step").dataset.step).toBe("end");
    fireEvent.click(screen.getByTestId("discovery-next"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("discovery-skip"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
    target.remove();
  });
});
