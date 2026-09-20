import { beforeEach, describe, expect, it } from "vitest";
import { configureApi } from "./api.ts";
import { useApiStatus } from "./api-status.ts";

/**
 * Présence de l'API (voir api-status.ts). Ce qui compte ici : la sonde n'est **optimiste** que
 * par défaut, et ne bascule que sur une preuve franche. Une installation qui a une API, ou un
 * téléphone hors ligne, ne doivent jamais se retrouver privés de l'offre de compte.
 */

const reply = (status: number, body: unknown) =>
  configureApi({
    base: "",
    fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })),
  });

beforeEach(() => {
  useApiStatus.setState({ presence: "unknown" });
});

describe("présence de l'API", () => {
  it("sans preuve : les comptes restent proposés", () => {
    expect(useApiStatus.getState().accountsPossible()).toBe(true);
  });

  it("404 api_unavailable : pas d'API, les comptes ne sont plus proposés", async () => {
    reply(404, { detail: "api_unavailable" });
    await useApiStatus.getState().probe();
    expect(useApiStatus.getState().presence).toBe("absent");
    expect(useApiStatus.getState().accountsPossible()).toBe(false);
  });

  it("sonde qui répond : l'API est là", async () => {
    reply(200, { status: "ok" });
    await useApiStatus.getState().probe();
    expect(useApiStatus.getState().presence).toBe("present");
    expect(useApiStatus.getState().accountsPossible()).toBe(true);
  });

  it("une panne passagère n'est pas une absence : on ne conclut rien", async () => {
    reply(500, { detail: "boom" });
    await useApiStatus.getState().probe();
    expect(useApiStatus.getState().presence).toBe("unknown");
    expect(useApiStatus.getState().accountsPossible()).toBe(true);
  });

  it("un 404 ordinaire non plus : seul `api_unavailable` fait foi", async () => {
    reply(404, { detail: "not found" });
    await useApiStatus.getState().probe();
    expect(useApiStatus.getState().accountsPossible()).toBe(true);
  });

  it("la sonde ne repart pas une fois la réponse connue", async () => {
    reply(404, { detail: "api_unavailable" });
    await useApiStatus.getState().probe();
    reply(200, { status: "ok" });
    await useApiStatus.getState().probe();
    expect(useApiStatus.getState().presence).toBe("absent");
  });
});
